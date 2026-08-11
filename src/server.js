import express from 'express';
import { query } from './db.js';
import { ownedByPantry, scrub } from './normalize.js';

const app = express();
const PORT = Number(process.env.PORT || 3080);

app.use(express.json({ limit: '1mb' }));

app.get('/health', async (req, res) => {
  try {
    const exact = req.query.exact === '1' || req.query.exact === 'true';
    if (exact) {
      const r = await query('SELECT COUNT(*)::bigint AS n FROM recipes');
      return res.json({ ok: true, recipes: Number(r.rows[0].n), exact: true });
    }
    // Fast estimate — avoids full scan of multi‑million row tables
    const r = await query(`
      SELECT COALESCE(c.reltuples, 0)::bigint AS n
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = 'recipes' AND n.nspname = 'public'
    `);
    res.json({
      ok: true,
      recipes: Number(r.rows[0]?.n ?? 0),
      exact: false,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

/**
 * GET /recipes/search?ingredients=chicken,rice,onion&limit=100
 * Body alternative: POST { ingredients: string[] }
 */
async function searchHandler(req, res) {
  try {
    const fromQuery = String(req.query.ingredients || '')
      .split(',')
      .map((s) => scrub(s))
      .filter(Boolean);
    const fromBody = Array.isArray(req.body?.ingredients)
      ? req.body.ingredients.map((s) => scrub(s)).filter(Boolean)
      : [];
    const kitchen = [...new Set([...fromQuery, ...fromBody])];
    if (!kitchen.length) {
      return res.status(400).json({
        error: 'Pass ingredients as ?ingredients=a,b,c or JSON body { ingredients: [] }',
      });
    }

    const limit = Math.min(Number(req.query.limit || req.body?.limit || 150), 300);
    const pantry = new Set(kitchen);

    // Capped LATERAL: each pantry token contributes the easiest-to-finish recipes
    const cand = await query(
      `WITH toks AS (SELECT DISTINCT unnest($1::text[]) AS token),
       hits AS (
         SELECT c.recipe_id, c.ing_count
         FROM toks
         JOIN LATERAL (
           SELECT ii.recipe_id, ii.ing_count
           FROM ingredient_index ii
           WHERE ii.token = toks.token
           ORDER BY ii.ing_count
           LIMIT 3000
         ) c ON TRUE
       )
       SELECT recipe_id, COUNT(*)::int AS matched
       FROM hits
       GROUP BY recipe_id
       ORDER BY COUNT(*)::float / GREATEST(MIN(ing_count), 1) DESC, COUNT(*) DESC
       LIMIT 600`,
      [kitchen],
    );

    let ids = cand.rows.map((r) => r.recipe_id);
    // Only pad when the index found nothing (not when sparse)
    if (!ids.length) {
      const fallback = await query(`SELECT id FROM recipes ORDER BY title LIMIT 200`);
      ids = fallback.rows.map((r) => r.id);
    }
    if (!ids.length) {
      return res.json({ cards: [], pantryUsed: kitchen, zeroMissingCount: 0 });
    }

    const recipes = await query(
      `SELECT id, title, image_url, minutes, servings, source_name, category, cuisine, link
       FROM recipes WHERE id = ANY($1::text[])`,
      [ids],
    );
    const ings = await query(
      `SELECT recipe_id, name_raw, name_norm
       FROM recipe_ingredients WHERE recipe_id = ANY($1::text[])`,
      [ids],
    );

    const byRecipe = new Map();
    for (const row of ings.rows) {
      const list = byRecipe.get(row.recipe_id) || [];
      list.push(row.name_raw);
      byRecipe.set(row.recipe_id, list);
    }

    const cards = recipes.rows
      .map((r) => {
        const ingredients = byRecipe.get(r.id) || [];
        const used = ingredients.filter((n) => ownedByPantry(n, pantry));
        const missed = ingredients.filter((n) => !ownedByPantry(n, pantry));
        return {
          id: `server:${r.id}`,
          source: 'local',
          externalId: r.id,
          title: r.title,
          imageUrl: r.image_url || undefined,
          minutes: r.minutes ?? undefined,
          servings: r.servings ?? undefined,
          usedCount: used.length,
          missedCount: missed.length,
          usedIngredients: used,
          missedIngredients: missed,
          category: r.category || undefined,
          cuisine: r.cuisine || undefined,
          sourceUrl: r.link || undefined,
        };
      })
      .sort((a, b) => {
        if (a.missedCount !== b.missedCount) return a.missedCount - b.missedCount;
        return b.usedCount - a.usedCount;
      })
      .slice(0, limit);

    res.json({
      cards,
      pantryUsed: kitchen,
      zeroMissingCount: cards.filter((c) => c.missedCount === 0).length,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err.message || err) });
  }
}

app.get('/recipes/search', searchHandler);
app.post('/recipes/search', searchHandler);

app.get('/recipes/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const r = await query(
      `SELECT id, title, image_url, minutes, servings, source_name, origin, category, cuisine, link, steps_json
       FROM recipes WHERE id = $1`,
      [id],
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Not found' });
    const row = r.rows[0];
    const ings = await query(
      `SELECT name_raw FROM recipe_ingredients WHERE recipe_id = $1 ORDER BY name_raw`,
      [id],
    );
    res.json({
      id: row.id,
      title: row.title,
      imageUrl: row.image_url || undefined,
      minutes: row.minutes ?? 30,
      servings: row.servings ?? 4,
      sourceName: row.source_name || undefined,
      origin: row.origin,
      category: row.category || undefined,
      cuisine: row.cuisine || undefined,
      link: row.link || undefined,
      ingredients: ings.rows.map((i) => i.name_raw),
      steps: row.steps_json || [],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`FreshLens recipe API on :${PORT}`);
});
