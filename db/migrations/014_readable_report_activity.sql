CREATE OR REPLACE VIEW report_activity_readable WITH (security_invoker = on) AS
SELECT
  'sale'::text AS type,
  s.id,
  s.id AS sale_id,
  u.name AS staff_name,
  s.created_at AS occurred_at_utc,
  to_char(s.created_at AT TIME ZONE 'Asia/Manila', 'FMMonth DD, YYYY "at" HH12:MI AM') AS occurred_at_ph,
  COALESCE(SUM(si.quantity), 0)::int AS units,
  (s.subtotal_cents::numeric / 100)::numeric(12, 2) AS gross_php,
  (s.discount_cents::numeric / 100)::numeric(12, 2) AS discount_php,
  0::numeric(12, 2) AS refund_php,
  (s.total_cents::numeric / 100)::numeric(12, 2) AS total_php
FROM sales s
LEFT JOIN users u ON u.id = s.staff_id
LEFT JOIN sale_items si ON si.sale_id = s.id
GROUP BY s.id, u.name, s.created_at, s.subtotal_cents, s.discount_cents, s.total_cents
UNION ALL
SELECT
  'refund'::text,
  r.id,
  r.sale_id,
  u.name,
  r.created_at,
  to_char(r.created_at AT TIME ZONE 'Asia/Manila', 'FMMonth DD, YYYY "at" HH12:MI AM'),
  r.quantity,
  0::numeric(12, 2),
  0::numeric(12, 2),
  (r.refund_cents::numeric / 100)::numeric(12, 2),
  (-r.refund_cents::numeric / 100)::numeric(12, 2)
FROM sale_returns r
LEFT JOIN users u ON u.id = r.created_by;
