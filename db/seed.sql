-- Demo catalogue only. Create the first admin with npm run bootstrap-admin.

INSERT INTO products (id, name, status) VALUES
  (1, 'Coastal Linen Shirt', 'active'),
  (2, 'Studio Wide Leg Trouser', 'active'),
  (3, 'Everyday Rib Tank', 'active');
SELECT setval(pg_get_serial_sequence('products', 'id'), 3);

INSERT INTO product_variants (id, product_id, size, sku, barcode, qr_code, price_cents) VALUES
  (11, 1, 'S', 'CLS-S', '100001', 'QR-CLS-S', 4900),
  (12, 1, 'M', 'CLS-M', '100002', 'QR-CLS-M', 4900),
  (13, 1, 'L', 'CLS-L', '100003', 'QR-CLS-L', 4900),
  (21, 2, '28', 'SWT-28', '200001', 'QR-SWT-28', 6800),
  (22, 2, '30', 'SWT-30', '200002', 'QR-SWT-30', 6800),
  (31, 3, 'S', 'ERT-S', '300001', 'QR-ERT-S', 2600);
SELECT setval(pg_get_serial_sequence('product_variants', 'id'), 31);

INSERT INTO inventory_levels (variant_id, quantity, reorder_point) VALUES
  (11, 5, 3), (12, 8, 3), (13, 3, 3), (21, 2, 3), (22, 5, 3), (31, 0, 4);
