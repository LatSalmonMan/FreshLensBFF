import fs from 'node:fs';
import { query } from './db.js';

export async function ensureProductsTable() {
  const schema = fs.readFileSync(new URL('../sql/schema.sql', import.meta.url), 'utf8');
  await query(schema);
  try {
    await query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_pkey') THEN
          ALTER TABLE products ADD CONSTRAINT products_pkey PRIMARY KEY (code);
        END IF;
      END $$;
    `);
  } catch (err) {
    console.warn('[products] primary key not ready:', err.message || err);
  }
}

function num(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function barcodeVariants(code) {
  const cleaned = String(code || '').replace(/\s+/g, '');
  if (!cleaned) return [];
  const stripped = cleaned.replace(/^0+/, '') || '0';
  return [...new Set([cleaned, stripped, stripped.padStart(12, '0'), stripped.padStart(13, '0')])];
}

function rowToProduct(row) {
  if (!row) return null;
  const additives = String(row.additives_tags || '')
    .split(/[,\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const nutriments = {};
  const kcal = num(row.energy_kcal_100g);
  const sugars = num(row.sugars_100g);
  const sat = num(row.saturated_fat_100g);
  const salt = num(row.salt_100g);
  const sodium = num(row.sodium_100g);
  const fiber = num(row.fiber_100g);
  const proteins = num(row.proteins_100g);
  const fat = num(row.fat_100g);
  const carbs = num(row.carbohydrates_100g);
  if (kcal != null) nutriments['energy-kcal_100g'] = kcal;
  if (sugars != null) nutriments.sugars_100g = sugars;
  if (sat != null) nutriments['saturated-fat_100g'] = sat;
  if (salt != null) nutriments.salt_100g = salt;
  if (sodium != null) nutriments.sodium_100g = sodium;
  if (fiber != null) nutriments.fiber_100g = fiber;
  if (proteins != null) nutriments.proteins_100g = proteins;
  if (fat != null) nutriments.fat_100g = fat;
  if (carbs != null) nutriments.carbohydrates_100g = carbs;

  return {
    code: row.code,
    product_name: row.product_name || undefined,
    brands: row.brands || undefined,
    ingredients_text: row.ingredients_text || undefined,
    additives_tags: additives.length ? additives : undefined,
    nutriscore_grade: row.nutriscore_grade || undefined,
    nova_group: row.nova_group != null ? Number(row.nova_group) : undefined,
    image_url: row.image_url || undefined,
    image_front_url: row.image_url || undefined,
    stores: row.stores || undefined,
    serving_size: row.serving_size || undefined,
    nutriments,
  };
}

export async function findProduct(barcode) {
  const variants = barcodeVariants(barcode);
  if (!variants.length) return null;
  const r = await query(
    `SELECT * FROM products WHERE code = ANY($1::text[]) LIMIT 1`,
    [variants],
  );
  return rowToProduct(r.rows[0]);
}

export async function upsertProduct(product) {
  const code = String(product?.code || '').trim();
  if (!code) return;
  const n = product.nutriments || {};
  await query(
    `INSERT INTO products (
      code, product_name, brands, ingredients_text, additives_tags, nutriscore_grade,
      nova_group, image_url, stores, serving_size, energy_kcal_100g, sugars_100g,
      saturated_fat_100g, salt_100g, sodium_100g, fiber_100g, proteins_100g, fat_100g,
      carbohydrates_100g
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
    )
    ON CONFLICT (code) DO UPDATE SET
      product_name = COALESCE(EXCLUDED.product_name, products.product_name),
      brands = COALESCE(EXCLUDED.brands, products.brands),
      ingredients_text = COALESCE(EXCLUDED.ingredients_text, products.ingredients_text),
      additives_tags = COALESCE(EXCLUDED.additives_tags, products.additives_tags),
      nutriscore_grade = COALESCE(EXCLUDED.nutriscore_grade, products.nutriscore_grade),
      nova_group = COALESCE(EXCLUDED.nova_group, products.nova_group),
      image_url = COALESCE(EXCLUDED.image_url, products.image_url),
      stores = COALESCE(EXCLUDED.stores, products.stores),
      serving_size = COALESCE(EXCLUDED.serving_size, products.serving_size),
      energy_kcal_100g = COALESCE(EXCLUDED.energy_kcal_100g, products.energy_kcal_100g),
      sugars_100g = COALESCE(EXCLUDED.sugars_100g, products.sugars_100g),
      saturated_fat_100g = COALESCE(EXCLUDED.saturated_fat_100g, products.saturated_fat_100g),
      salt_100g = COALESCE(EXCLUDED.salt_100g, products.salt_100g),
      sodium_100g = COALESCE(EXCLUDED.sodium_100g, products.sodium_100g),
      fiber_100g = COALESCE(EXCLUDED.fiber_100g, products.fiber_100g),
      proteins_100g = COALESCE(EXCLUDED.proteins_100g, products.proteins_100g),
      fat_100g = COALESCE(EXCLUDED.fat_100g, products.fat_100g),
      carbohydrates_100g = COALESCE(EXCLUDED.carbohydrates_100g, products.carbohydrates_100g)`,
    [
      code,
      product.product_name || null,
      product.brands || null,
      product.ingredients_text || null,
      Array.isArray(product.additives_tags) ? product.additives_tags.join(',') : product.additives_tags || null,
      product.nutriscore_grade || null,
      num(product.nova_group),
      product.image_front_url || product.image_url || null,
      product.stores || null,
      product.serving_size || null,
      num(n['energy-kcal_100g']),
      num(n.sugars_100g),
      num(n['saturated-fat_100g']),
      num(n.salt_100g),
      num(n.sodium_100g),
      num(n.fiber_100g),
      num(n.proteins_100g),
      num(n.fat_100g),
      num(n.carbohydrates_100g),
    ],
  );
}
