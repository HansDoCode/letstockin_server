ALTER VIEW public.report_activity_readable SET (security_invoker = on);

CREATE OR REPLACE VIEW public.users_readable WITH (security_invoker = on) AS
SELECT id, name, email, role,
  to_char(created_at AT TIME ZONE 'Asia/Manila', 'FMMonth DD, YYYY "at" HH12:MI AM') AS created_at_ph
FROM public.users;

CREATE OR REPLACE VIEW public.products_readable WITH (security_invoker = on) AS
SELECT id, name, status,
  to_char(created_at AT TIME ZONE 'Asia/Manila', 'FMMonth DD, YYYY "at" HH12:MI AM') AS created_at_ph
FROM public.products;

CREATE OR REPLACE VIEW public.product_variants_readable WITH (security_invoker = on) AS
SELECT id, product_id, size, color, sku,
  (price_cents::numeric / 100)::numeric(12, 2) AS price_php
FROM public.product_variants;

CREATE OR REPLACE VIEW public.inventory_levels_readable WITH (security_invoker = on) AS
SELECT variant_id, quantity, reorder_point,
  to_char(updated_at AT TIME ZONE 'Asia/Manila', 'FMMonth DD, YYYY "at" HH12:MI AM') AS updated_at_ph
FROM public.inventory_levels;

CREATE OR REPLACE VIEW public.sales_readable WITH (security_invoker = on) AS
SELECT id, staff_id,
  (subtotal_cents::numeric / 100)::numeric(12, 2) AS subtotal_php,
  (discount_cents::numeric / 100)::numeric(12, 2) AS discount_php,
  (total_cents::numeric / 100)::numeric(12, 2) AS total_php,
  payment_method,
  to_char(created_at AT TIME ZONE 'Asia/Manila', 'FMMonth DD, YYYY "at" HH12:MI AM') AS created_at_ph
FROM public.sales;

CREATE OR REPLACE VIEW public.payments_readable WITH (security_invoker = on) AS
SELECT id, sale_id,
  (amount_cents::numeric / 100)::numeric(12, 2) AS amount_php,
  method, status,
  to_char(created_at AT TIME ZONE 'Asia/Manila', 'FMMonth DD, YYYY "at" HH12:MI AM') AS created_at_ph
FROM public.payments;

CREATE OR REPLACE VIEW public.sale_items_readable WITH (security_invoker = on) AS
SELECT id, sale_id, variant_id, quantity,
  (unit_price_cents::numeric / 100)::numeric(12, 2) AS unit_price_php,
  (discount_cents::numeric / 100)::numeric(12, 2) AS discount_php,
  (total_cents::numeric / 100)::numeric(12, 2) AS total_php,
  discount_reason
FROM public.sale_items;

CREATE OR REPLACE VIEW public.sale_returns_readable WITH (security_invoker = on) AS
SELECT id, sale_id, sale_item_id, quantity,
  (refund_cents::numeric / 100)::numeric(12, 2) AS refund_php,
  reason, created_by,
  to_char(created_at AT TIME ZONE 'Asia/Manila', 'FMMonth DD, YYYY "at" HH12:MI AM') AS created_at_ph
FROM public.sale_returns;

CREATE OR REPLACE VIEW public.inventory_movements_readable WITH (security_invoker = on) AS
SELECT id, variant_id, quantity_delta, reason, reference_type, reference_id, created_by,
  to_char(created_at AT TIME ZONE 'Asia/Manila', 'FMMonth DD, YYYY "at" HH12:MI AM') AS created_at_ph
FROM public.inventory_movements;
