/**
 * Stream RecipeNLG-style full_dataset.csv(.gz) into Postgres via COPY.
 *
 * Usage:
 *   node src/importCsv.js [--truncate] [--limit N] [--file /data/full_dataset.csv.gz]
 *
 * Env:
 *   DATABASE_URL, RECIPES_CSV (default /data/full_dataset.csv.gz)
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { parse } from 'csv-parse';
import { from as copyFrom } from 'pg-copy-streams';
import { pool, query } from './db.js';
import { ingredientTokens, normalizeIngredient, scrub } from './normalize.js';

function parseArgs(argv) {
  const out = {
    truncate: false,
    limit: null,
    file: process.env.RECIPES_CSV || '/data/full_dataset.csv.gz',
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--truncate') out.truncate = true;
    else if (a === '--limit') out.limit = Number(argv[++i]);
    else if (a === '--file') out.file = argv[++i];
    else if (a.startsWith('--limit=')) out.limit = Number(a.slice('--limit='.length));
    else if (a.startsWith('--file=')) out.file = a.slice('--file='.length);
  }
  return out;
}

/** Postgres text/json reject U+0000 — strip from all COPY fields. */
function stripNulls(value) {
  return String(value).replace(/\u0000/g, '');
}

function escapeCopy(value) {
  if (value == null) return '\\N';
  return stripNulls(value)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

function parseJsonList(raw) {
  if (raw == null || raw === '') return [];
  try {
    const v = JSON.parse(stripNulls(raw));
    return Array.isArray(v) ? v.map((x) => stripNulls(x)) : [];
  } catch {
    return [];
  }
}

function hostnameFromLink(link) {
  if (!link) return null;
  try {
    const withProto = /^https?:\/\//i.test(link) ? link : `https://${link}`;
    return new URL(withProto).hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

function openInput(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing CSV at ${filePath}`);
  }
  const stream = fs.createReadStream(filePath);
  if (filePath.endsWith('.gz')) {
    return stream.pipe(zlib.createGunzip());
  }
  return stream;
}

async function ensureSchema() {
  const schema = fs.readFileSync(new URL('../sql/schema.sql', import.meta.url), 'utf8');
  await query(schema);
}

async function applyIndexes() {
  console.log('Building indexes…');
  const indexes = fs.readFileSync(new URL('../sql/indexes.sql', import.meta.url), 'utf8');
  await query(indexes);
  console.log('Indexes ready');
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

async function main() {
  const args = parseArgs(process.argv);
  console.log(`Import from ${args.file}${args.limit != null ? ` (limit ${args.limit})` : ''}`);

  await ensureSchema();

  if (args.truncate) {
    console.log('Truncating tables…');
    await query('TRUNCATE recipe_ingredients, ingredient_index, recipes');
  } else {
    const existing = await query('SELECT COUNT(*)::bigint AS n FROM recipes');
    if (Number(existing.rows[0].n) > 0) {
      throw new Error(
        `DB already has ${existing.rows[0].n} recipes. Re-run with --truncate to replace.`,
      );
    }
  }

  await query('ALTER TABLE recipes DROP CONSTRAINT IF EXISTS recipes_pkey');
  await query('DROP INDEX IF EXISTS idx_recipes_title');
  await query('DROP INDEX IF EXISTS idx_recipe_ingredients_recipe');
  await query('DROP INDEX IF EXISTS idx_ingredient_index_lookup');
  await query('DROP INDEX IF EXISTS idx_ingredient_index_token');
  await query('DROP INDEX IF EXISTS idx_recipe_ingredients_norm');

  // One COPY stream per connection (Postgres limitation)
  const recipeClient = await pool.connect();
  const ingClient = await pool.connect();
  const idxClient = await pool.connect();

  let count = 0;
  let skipped = 0;

  try {
    for (const c of [recipeClient, ingClient, idxClient]) {
      await c.query('SET synchronous_commit = off');
      await c.query("SET maintenance_work_mem = '768MB'");
    }

    const recipeCopy = recipeClient.query(
      copyFrom(
        `COPY recipes (id, title, image_url, minutes, servings, source_name, origin, category, cuisine, link, steps_json) FROM STDIN WITH (FORMAT text)`,
      ),
    );
    const ingCopy = ingClient.query(
      copyFrom(
        `COPY recipe_ingredients (recipe_id, name_raw, name_norm) FROM STDIN WITH (FORMAT text)`,
      ),
    );
    const idxCopy = idxClient.query(
      copyFrom(`COPY ingredient_index (token, recipe_id, ing_count) FROM STDIN WITH (FORMAT text)`),
    );

    const parser = parse({
      columns: true,
      relax_column_count: true,
      skip_empty_lines: true,
      max_record_size: 10 * 1024 * 1024,
    });

    const input = openInput(args.file).pipe(parser);
    let lastLog = Date.now();

    try {
      for await (const row of input) {
        if (args.limit != null && count >= args.limit) {
          break;
        }

        const index = row[''] ?? row.index ?? row.id;
        const title = (row.title || '').trim();
        if (index == null || index === '' || !title) {
          skipped += 1;
          continue;
        }

        const ingredients = parseJsonList(row.ingredients);
        const directions = parseJsonList(row.directions);
        const ner = parseJsonList(row.NER ?? row.ner);
        const link = (row.link || '').trim() || null;
        const id = `r${index}`;
        const steps = directions.map((instruction, i) => ({
          order: i + 1,
          instruction,
        }));
        const ingCount = ingredients.length;
        const tokenSources = ner.length ? ner : ingredients;
        const tokens = new Set();
        for (const term of tokenSources) {
          for (const t of ingredientTokens(term)) {
            if (t) tokens.add(t);
          }
        }

        await writeLine(
          recipeCopy,
          [
            escapeCopy(id),
            escapeCopy(title),
            '\\N',
            '\\N',
            '\\N',
            escapeCopy(hostnameFromLink(link) || row.source || null),
            escapeCopy('remote'),
            '\\N',
            '\\N',
            escapeCopy(link),
            escapeCopy(JSON.stringify(steps)),
          ].join('\t'),
        );

        for (const ing of ingredients) {
          const norm = normalizeIngredient(ing) || scrub(ing);
          if (!norm) continue;
          await writeLine(ingCopy, [escapeCopy(id), escapeCopy(ing), escapeCopy(norm)].join('\t'));
        }

        for (const token of tokens) {
          await writeLine(idxCopy, [escapeCopy(token), escapeCopy(id), String(ingCount)].join('\t'));
        }

        count += 1;
        if (count % 100000 === 0 || Date.now() - lastLog > 15000) {
          console.log(`… ${count.toLocaleString()} recipes`);
          lastLog = Date.now();
        }
      }
    } finally {
      input.destroy?.();
      parser.destroy?.();
    }

    await Promise.all([endCopy(recipeCopy), endCopy(ingCopy), endCopy(idxCopy)]);
    console.log(`COPY done — ${count.toLocaleString()} recipes (skipped ${skipped})`);
  } finally {
    recipeClient.release();
    ingClient.release();
    idxClient.release();
  }

  await applyIndexes();
  await query('ANALYZE recipes');
  await query('ANALYZE recipe_ingredients');
  await query('ANALYZE ingredient_index');

  const counts = await query(`
    SELECT
      (SELECT COUNT(*)::bigint FROM recipes) AS recipes,
      (SELECT COUNT(*)::bigint FROM recipe_ingredients) AS ingredients,
      (SELECT COUNT(*)::bigint FROM ingredient_index) AS tokens
  `);
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
