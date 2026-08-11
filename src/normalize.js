/** Lightweight ingredient normalization for seed + search (keep in sync with app pantryNormalize). */

export const STAPLES = new Set([
  'salt',
  'pepper',
  'black pepper',
  'water',
  'oil',
  'olive oil',
  'vegetable oil',
  'butter',
  'garlic',
  'onion',
  'flour',
  'sugar',
  'eggs',
  'egg',
  'milk',
  'rice',
  'pasta',
]);

export function scrub(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeIngredient(raw) {
  const cleaned = scrub(raw);
  if (!cleaned) return null;
  const parts = cleaned.split(' ').filter((w) => w.length > 2);
  if (parts.length === 1) return parts[0];
  if (parts.length >= 2) return parts.slice(-2).join(' ');
  return cleaned.length >= 2 ? cleaned : null;
}

export function ingredientTokens(raw) {
  const norm = normalizeIngredient(raw) || scrub(raw);
  if (!norm) return [];
  const tokens = new Set([norm]);
  for (const part of norm.split(' ')) {
    if (part.length >= 3) tokens.add(part);
  }
  return [...tokens];
}

export function isStaple(name) {
  const n = scrub(name);
  if (!n) return true;
  for (const s of STAPLES) {
    if (n === s || n.includes(s) || s.includes(n)) return true;
  }
  return false;
}

export function ownedByPantry(ingredientName, pantry) {
  const n = scrub(ingredientName);
  if (!n || isStaple(n)) return true;
  const norm = normalizeIngredient(ingredientName) || n;
  for (const p of pantry) {
    if (!p) continue;
    if (n === p || n.includes(p) || p.includes(n) || norm === p || norm.includes(p) || p.includes(norm)) {
      return true;
    }
  }
  return false;
}

export function parseSourceMeta(sourceName) {
  if (!sourceName?.trim()) return {};
  const parts = sourceName.split('·').map((p) => p.trim()).filter(Boolean);
  const cuisineHints = new Set([
    'american',
    'british',
    'canadian',
    'chinese',
    'french',
    'greek',
    'indian',
    'irish',
    'italian',
    'jamaican',
    'japanese',
    'mexican',
    'polish',
    'spanish',
    'thai',
    'turkish',
    'vietnamese',
    'united states',
    'france',
    'india',
  ]);
  let category;
  let cuisine;
  for (const part of parts) {
    const key = part.toLowerCase();
    if (cuisineHints.has(key)) {
      if (!cuisine) cuisine = part;
    } else if (!category) {
      category = part;
    } else if (!cuisine) {
      cuisine = part;
    }
  }
  return { category, cuisine };
}
