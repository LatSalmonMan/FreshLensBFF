/**
 * Stream the Open Food Facts TSV dump into Postgres for instant barcode scans.
 *
 * Usage (TrueNAS app shell):
 *   node src/importOff.js --download
 *
 *   node src/importOff.js --truncate --file /data/en.openfoodfacts.org.products.csv.gz
 *
 * Env:
 *   POSTGRES_* / DATABASE_URL
 *   OFF_CSV  default /data/en.openfoodfacts.org.products.csv.gz
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parse } from 'csv-parse';
import { from as copyFrom } from 'pg-copy-streams';
import { pool, query } from './db.js';
import { ensureProductsTable } from './products.js';

const OFF_DUMP_URL =
  'https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz';
const USER_AGENT = 'FreshLens/1.0 (https://freshlens.ai)';

function parseArgs(argv) {
  const out = {
    truncate: false,
    download: false,
    allCountries: false,
    limit: null,
    file: process.env.OFF_CSV || '/data/en.openfoodfacts.org.products.csv.gz',
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--truncate') out.truncate = true;
    else if (a === '--download') out.download = true;
    else if (a === '--all-countries') out.allCountries = true;
    else if (a === '--limit') out.limit = Number(argv[++i]);
    else if (a === '--file') out.file = argv[++i];
    else if (a.startsWith('--limit=')) out.limit = Number(a.slice('--limit='.length));
    else if (a.startsWith('--file=')) out.file = a.slice('--file='.length);
  }
  return out;
}

function stripNulls(value) {
  return String(value).replace(/\u0000/g, '');
}

function escapeCopy(value) {
  if (value == null || value === '') return '\\N';
  return stripNulls(value)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

function numOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : null;
}

function keepCountry(row) {
  const tags = `${row.countries_tags || ''} ${row.countries || ''}`.toLowerCase();
  if (!tags.trim()) return true;
  return /united[- ]states|\ben:us\b|\busa\b|world/.test(tags);
}

function usableRow(row) {
  const name = String(row.product_name || '').trim();
  if (!name) return false;
  const ingredients = String(row.ingredients_text || '').trim();
  return Boolean(
    row['energy-kcal_100g'] ||
      row.sugars_100g ||
      row['saturated-fat_100g'] ||
      row.salt_100g ||
      ingredients.length >= 8,
  );
}

function openInput(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing OFF dump at ${filePath}. Re-run with --download.`);
  }
  const stream = fs.createReadStream(filePath);
  if (filePath.endsWith('.gz')) return stream.pipe(zlib.createGunzip());
  return stream;
}

async function downloadDump(dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 20_000_000) {
    console.log(`Using existing dump ${dest} (${(fs.statSync(dest).size / 1e9).toFixed(2)} GB)`);
    return;
  }
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  console.log(`Downloading Open Food Facts dump (~0.9 GB) → ${dest}`);
  const res = await fetch(OFF_DUMP_URL, {
    headers: { 'User-Agent': USER_AGENT },
    redirect: 'follow',
  });
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: HTTP ${res.status}`);
  }
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
  fs.renameSync(tmp, dest);
  console.log(`Download complete (${(fs.statSync(dest).size / 1e9).toFixed(2)} GB)`);
}

async function writeLine(stream, line) {
  if (!stream.write(`${line}\n`)) {
    await new Promise((resolve) => stream.once('drain', resolve));
  }
}

function endCopy(stream) {
  return new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
    stream.end();
  });
}

async function applyIndexes() {
  console.log('Building product index…');
  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_pkey') THEN
        ALTER TABLE products ADD CONSTRAINT products_pkey PRIMARY KEY (code);
      END IF;
    END $$;
  `);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.download) {
    try {
      fs.accessSync(path.dirname(args.file), fs.constants.W_OK);
    } catch {
      args.file = '/tmp/en.openfoodfacts.org.products.csv.gz';
      console.log(`/data not writable — downloading to ${args.file}`);
    }
    await downloadDump(args.file);
  }

  console.log(`Import products from ${args.file}${args.limit != null ? ` (limit ${args.limit})` : ''}`);
  await ensureProductsTable();

  if (args.truncate) {
    console.log('Truncating products…');
    await query('TRUNCATE products');
  } else {
    const existing = await query('SELECT COUNT(*)::bigint AS n FROM products');
    if (Number(existing.rows[0].n) > 0) {
      throw new Error(
        `DB already has ${existing.rows[0].n} products. Re-run with --truncate --download to replace.`,
      );
    }
  }

  await query('ALTER TABLE products DROP CONSTRAINT IF EXISTS products_pkey');

  const client = await pool.connect();
  let count = 0;
  let skipped = 0;
  const seen = new Set();

  try {
    await client.query('SET synchronous_commit = off');
    await client.query("SET maintenance_work_mem = '768MB'");
    const copy = client.query(
      copyFrom(
        `COPY products (
          code, product_name, brands, ingredients_text, additives_tags, nutriscore_grade,
          nova_group, image_url, stores, serving_size, energy_kcal_100g, sugars_100g,
          saturated_fat_100g, salt_100g, sodium_100g, fiber_100g, proteins_100g, fat_100g,
          carbohydrates_100g
        ) FROM STDIN WITH (FORMAT text)`,
      ),
    );

    const parser = parse({
      columns: true,
      delimiter: '\t',
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: true,
      bom: true,
      max_record_size: 20 * 1024 * 1024,
    });
    const input = openInput(args.file).pipe(parser);
    let lastLog = Date.now();

    try {
      for await (const row of input) {
        if (args.limit != null && count >= args.limit) break;

        const code = String(row.code || '').replace(/\s+/g, '');
        if (code.length < 8 || seen.has(code) || !usableRow(row)) {
          skipped += 1;
          continue;
        }
        if (!args.allCountries && !keepCountry(row)) {
          skipped += 1;
          continue;
        }

        seen.add(code);
        const nova = numOrNull(row.nova_group || row['nova-group']);
        await writeLine(
          copy,
          [
            escapeCopy(code),
            escapeCopy(String(row.product_name || '').trim()),
            escapeCopy(row.brands || null),
            escapeCopy(row.ingredients_text || null),
            escapeCopy(row.additives_tags || row.additives || null),
            escapeCopy(row.nutriscore_grade || row.nutrition_grade_fr || null),
            nova == null ? '\\N' : nova,
            escapeCopy(row.image_url || row.image_small_url || null),
            escapeCopy(row.stores || null),
            escapeCopy(row.serving_size || null),
            escapeCopy(numOrNull(row['energy-kcal_100g'])),
            escapeCopy(numOrNull(row.sugars_100g)),
            escapeCopy(numOrNull(row['saturated-fat_100g'])),
            escapeCopy(numOrNull(row.salt_100g)),
            escapeCopy(numOrNull(row.sodium_100g)),
            escapeCopy(numOrNull(row.fiber_100g)),
            escapeCopy(numOrNull(row.proteins_100g)),
            escapeCopy(numOrNull(row.fat_100g)),
            escapeCopy(numOrNull(row.carbohydrates_100g)),
          ].join('\t'),
        );

        count += 1;
        if (count % 50000 === 0 || Date.now() - lastLog > 15000) {
          console.log(`… ${count.toLocaleString()} products (skipped ${skipped.toLocaleString()})`);
          lastLog = Date.now();
        }
      }
    } finally {
      input.destroy?.();
      parser.destroy?.();
    }

    await endCopy(copy);
    console.log(`COPY done — ${count.toLocaleString()} products (skipped ${skipped.toLocaleString()})`);
  } finally {
    client.release();
  }

  await applyIndexes();
  await query('ANALYZE products');
  const counts = await query('SELECT COUNT(*)::bigint AS products FROM products');
  console.log('Counts:', counts.rows[0]);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
