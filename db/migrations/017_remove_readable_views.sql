-- Projects that applied the earlier rename can have both the old and new view names.
DO $$
DECLARE
  old_view text;
  new_view text;
BEGIN
  FOR old_view, new_view IN
    SELECT * FROM (VALUES
      ('report_activity_readable', 'report_activity'),
      ('users_readable', 'users_display'),
      ('products_readable', 'products_display'),
      ('product_variants_readable', 'product_variants_display'),
      ('inventory_levels_readable', 'inventory_levels_display'),
      ('sales_readable', 'sales_display'),
      ('payments_readable', 'payments_display'),
      ('sale_items_readable', 'sale_items_display'),
      ('sale_returns_readable', 'sale_returns_display'),
      ('inventory_movements_readable', 'inventory_movements_display')
    ) AS names(old_view, new_view)
  LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = old_view AND c.relkind = 'v'
    ) THEN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = new_view
      ) THEN
        EXECUTE format('ALTER VIEW public.%I RENAME TO %I', old_view, new_view);
      ELSE
        EXECUTE format('DROP VIEW public.%I', old_view);
      END IF;
    END IF;
  END LOOP;
END $$;
