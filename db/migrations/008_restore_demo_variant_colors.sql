BEGIN;

-- Migration 007 preserved old variants with a placeholder color. Restore the
-- colors for the demo catalog using its stable SKU prefixes.
UPDATE product_variants
SET color = CASE
  WHEN sku LIKE 'CLS-%' THEN 'Sand'
  WHEN sku LIKE 'SWT-%' THEN 'Navy'
  WHEN sku LIKE 'ERT-%' THEN 'Ivory'
END
WHERE color = 'Unspecified'
  AND (sku LIKE 'CLS-%' OR sku LIKE 'SWT-%' OR sku LIKE 'ERT-%');

COMMIT;
