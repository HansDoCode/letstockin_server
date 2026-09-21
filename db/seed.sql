-- Demo catalogue only. Create the first admin with npm run bootstrap-admin.

INSERT INTO products (id, name, status) VALUES
  (1, 'Coastal Linen Shirt', 'active'),
  (2, 'Studio Wide Leg Trouser', 'active'),
  (3, 'Everyday Rib Tank', 'active');
SELECT setval(pg_get_serial_sequence('products', 'id'), 3);

INSERT INTO product_variants (id, product_id, size, color, sku, price_cents) VALUES
  (11, 1, 'S', 'Sand', 'CLS-S', 4900),
  (12, 1, 'M', 'Sand', 'CLS-M', 4900),
  (13, 1, 'L', 'Sand', 'CLS-L', 4900),
  (21, 2, '28', 'Navy', 'SWT-28', 6800),
  (22, 2, '30', 'Navy', 'SWT-30', 6800),
  (31, 3, 'S', 'Ivory', 'ERT-S', 2600);
SELECT setval(pg_get_serial_sequence('product_variants', 'id'), 31);

INSERT INTO product_identifiers (variant_id, identifier_type, code) VALUES
  (11, 'barcode', '100001'), (11, 'qr', 'QR-CLS-S'),
  (12, 'barcode', '100002'), (12, 'qr', 'QR-CLS-M'),
  (13, 'barcode', '100003'), (13, 'qr', 'QR-CLS-L'),
  (21, 'barcode', '200001'), (21, 'qr', 'QR-SWT-28'),
  (22, 'barcode', '200002'), (22, 'qr', 'QR-SWT-30'),
  (31, 'barcode', '300001'), (31, 'qr', 'QR-ERT-S');

INSERT INTO inventory_levels (variant_id, quantity, reorder_point) VALUES
  (11, 5, 5), (12, 8, 5), (13, 3, 5), (21, 2, 5), (22, 5, 5), (31, 0, 5);
