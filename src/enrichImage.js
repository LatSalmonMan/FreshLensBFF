/**
 * Lazy recipe image enrichment from source page og:image / twitter:image.
 * Results cached on recipes.image_url; image_checked prevents repeat fetches.
 */
import { query } from './db.js';

const FETCH_MS = 3500;

export async function ensureImageColumns() {
  await query(`ALTER TABLE recipes ADD COLUMN IF NOT EXISTS image_checked BOOLEAN NOT NULL DEFAULT false`);
}

function absoluteUrl(pageUrl, maybeRelative) {
  if (!maybeRelative) return null;
  try {
    return new URL(maybeRelative, pageUrl).href;
  } catch {
    return null;
  }
}

export function normalizePageUrl(link) {
  if (!link?.trim()) return null;
  const raw = link.trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw.replace(/^\/\//, '')}`;
}

function extractMetaImage(html, pageUrl) {
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) {
      const abs = absoluteUrl(pageUrl, m[1].trim());
      if (abs && /^https?:\/\//i.test(abs)) return abs;
    }
  }
  return null;
}

/** Stable food-ish placeholder when the source page has no image. */
export function placeholderImageUrl(recipeId, title) {
  const seed = String(recipeId || title || 'food')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 24) || 'food';
  const word = String(title || 'food')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 2)
    .join(',') || 'food';
  return `https://loremflickr.com/640/480/${encodeURIComponent(word)}/all?lock=${encodeURIComponent(seed)}`;
}

export async function fetchOgImage(link) {
  const pageUrl = normalizePageUrl(link);
  if (!pageUrl) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const res = await fetch(pageUrl, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'FreshLensBFF/1.0 (+recipe-preview)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    // Cap parse size
    return extractMetaImage(html.slice(0, 200_000), pageUrl);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve image for one recipe row; persists to DB.
 * @returns {Promise<string|null>}
 */
export async function enrichRecipeImage(row) {
  if (!row?.id) return null;
  if (row.image_url) return row.image_url;
  if (row.image_checked) {
    return placeholderImageUrl(row.id, row.title);
  }

  let url = null;
  if (row.link) {
    url = await fetchOgImage(row.link);
  }
  if (!url) {
    url = placeholderImageUrl(row.id, row.title);
  }

  try {
    await query(
      `UPDATE recipes SET image_url = $2, image_checked = true WHERE id = $1`,
      [row.id, url],
    );
  } catch (err) {
    console.warn('[image] cache failed', row.id, err.message);
  }
  return url;
}

/** Enrich several rows with limited concurrency (for search cards). */
export async function enrichRecipeImages(rows, { limit = 8, concurrency = 4 } = {}) {
  const need = rows.filter((r) => r && !r.image_url).slice(0, limit);
  const out = new Map();
  let i = 0;

  async function worker() {
    while (i < need.length) {
      const idx = i++;
      const row = need[idx];
      const url = await enrichRecipeImage(row);
      if (url) out.set(row.id, url);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, need.length) }, () => worker()));
  return out;
}
