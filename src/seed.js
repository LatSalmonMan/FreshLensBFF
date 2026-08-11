import fs from 'node:fs';
import { query, pool } from './db.js';
import { ingredientTokens, normalizeIngredient, parseSourceMeta, scrub } from './normalize.js';

const CATALOG_PATH = process.env.RECIPES_JSON || '/data/recipes.json';

async function ensureSchema() {
  const schema = fs.readFileSync(new URL('../sql/schema.sql', import.meta.url), 'utf8');
  await query(schema);
  const indexes = fs.readFileSync(new URL('../sql/indexes.sql', import.meta.url), 'utf8');
  await query(indexes);
}

async function seed() {
  await ensureSchema();

  const countRes = await query('SELECT COUNT(*)::int AS n FROM recipes');
  if (countRes.rows[0].n > 0) {
    console.log(`DB already has ${countRes.rows[0].n} recipes — skip seed`);
    return;
  }

  if (!fs.existsSync(CATALOG_PATH)) {
    throw new Error(`Missing catalog at ${CATALOG_PATH}`);
  }

  const raw = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const recipes = raw.recipes || raw;
  if (!Array.isArray(recipes) || !recipes.length) {
    throw new Error('Catalog has no recipes array');
  }

  console.log(`Seeding ${recipes.length} recipes from ${CATALOG_PATH}…`);

  await query('BEGIN');
  try {
    for (const r of recipes) {
      const meta = parseSourceMeta(r.sourceName);
      const ingredients = r.ingredients || [];
      const ingCount = ingredients.length;

      await query(
        `INSERT INTO recipes
          (id, title, image_url, minutes, servings, source_name, origin, category, cuisine, link, steps_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
         ON CONFLICT (id) DO NOTHING`,
        [
          r.id,
          r.title,
          r.imageUrl || null,
          r.minutes ?? 30,
          r.servings ?? 4,
          r.sourceName || null,
          r.origin || 'local',
          meta.category || null,
          meta.cuisine || null,
          r.link || null,
          JSON.stringify(r.steps || []),
        ],
      );

      const tokens = new Set();
      for (const ing of ingredients) {
        const norm = normalizeIngredient(ing) || scrub(ing);
        if (!norm) continue;
        await query(
          `INSERT INTO recipe_ingredients (recipe_id, name_raw, name_norm) VALUES ($1,$2,$3)`,
          [r.id, ing, norm],
        );
        for (const token of ingredientTokens(ing)) {
          if (token) tokens.add(token);
        }
      }
      for (const token of tokens) {
        await query(
          `INSERT INTO ingredient_index (token, recipe_id, ing_count) VALUES ($1,$2,$3)`,
          [token, r.id, ingCount],
        );
      }
    }
    await query('COMMIT');
  } catch (err) {
    await query('ROLLBACK');
    throw err;
  }

  const after = await query('SELECT COUNT(*)::int AS n FROM recipes');
  console.log(`Seed complete — ${after.rows[0].n} recipes`);
}

seed()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
