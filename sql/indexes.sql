-- Post-load indexes for CSV / bulk import. Safe to re-run.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'recipes_pkey'
  ) THEN
    ALTER TABLE recipes ADD CONSTRAINT recipes_pkey PRIMARY KEY (id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_recipes_title ON recipes(title);
CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_recipe ON recipe_ingredients(recipe_id);
CREATE INDEX IF NOT EXISTS idx_ingredient_index_lookup ON ingredient_index(token, ing_count, recipe_id);
