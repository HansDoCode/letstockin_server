DO $$
BEGIN
  CREATE TYPE product_status AS ENUM ('active', 'archived');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS status product_status NOT NULL DEFAULT 'active';

CREATE INDEX IF NOT EXISTS products_status_idx ON products(status);
