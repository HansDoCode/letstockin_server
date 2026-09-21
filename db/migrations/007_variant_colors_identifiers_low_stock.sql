BEGIN;

ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS color TEXT NOT NULL DEFAULT 'Unspecified';

DO $$
BEGIN
  CREATE TYPE product_identifier_type AS ENUM ('barcode', 'qr');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS product_identifiers (
  id BIGSERIAL PRIMARY KEY,
  variant_id BIGINT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  identifier_type product_identifier_type NOT NULL,
  code TEXT NOT NULL UNIQUE,
  UNIQUE (variant_id, identifier_type)
);

CREATE INDEX IF NOT EXISTS product_identifiers_variant_idx ON product_identifiers(variant_id);

INSERT INTO product_identifiers (variant_id, identifier_type, code)
SELECT id, 'barcode'::product_identifier_type, barcode
FROM product_variants
WHERE barcode IS NOT NULL AND barcode <> ''
ON CONFLICT (variant_id, identifier_type) DO NOTHING;

INSERT INTO product_identifiers (variant_id, identifier_type, code)
SELECT id, 'qr'::product_identifier_type, qr_code
FROM product_variants
WHERE qr_code IS NOT NULL AND qr_code <> ''
ON CONFLICT (variant_id, identifier_type) DO NOTHING;

ALTER TABLE product_variants DROP COLUMN IF EXISTS barcode;
ALTER TABLE product_variants DROP COLUMN IF EXISTS qr_code;

UPDATE inventory_levels SET reorder_point = 5 WHERE reorder_point < 5;
ALTER TABLE inventory_levels ALTER COLUMN reorder_point SET DEFAULT 5;
ALTER TABLE inventory_levels DROP CONSTRAINT IF EXISTS inventory_levels_reorder_point_check;
ALTER TABLE inventory_levels ADD CONSTRAINT inventory_levels_reorder_point_check CHECK (reorder_point >= 5);

COMMIT;
