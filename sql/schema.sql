-- Tables only (indexes applied after bulk import via indexes.sql).
-- Safe to re-run: CREATE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS recipes (
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  image_url TEXT,
  minutes INTEGER,
  servings INTEGER,
  source_name TEXT,
  origin TEXT NOT NULL DEFAULT 'local',
  category TEXT,
  cuisine TEXT,
  link TEXT,
  steps_json JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS recipe_ingredients (
  recipe_id TEXT NOT NULL,
  name_raw TEXT NOT NULL,
  name_norm TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ingredient_index (
  token TEXT NOT NULL,
  recipe_id TEXT NOT NULL,
  ing_count SMALLINT NOT NULL DEFAULT 0
);

ALTER TABLE recipes ADD COLUMN IF NOT EXISTS link TEXT;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS image_checked BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE ingredient_index ADD COLUMN IF NOT EXISTS ing_count SMALLINT NOT NULL DEFAULT 0;

-- Open Food Facts barcode cache (instant first scans on LAN)
CREATE TABLE IF NOT EXISTS products (
  code TEXT NOT NULL,
  product_name TEXT,
  brands TEXT,
  ingredients_text TEXT,
  additives_tags TEXT,
  nutriscore_grade TEXT,
  nova_group SMALLINT,
  image_url TEXT,
  stores TEXT,
  serving_size TEXT,
  energy_kcal_100g REAL,
  sugars_100g REAL,
  saturated_fat_100g REAL,
  salt_100g REAL,
  sodium_100g REAL,
  fiber_100g REAL,
  proteins_100g REAL,
  fat_100g REAL,
  carbohydrates_100g REAL
);
