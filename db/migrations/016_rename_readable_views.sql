DO $$
BEGIN
  IF to_regclass('public.report_activity_readable') IS NOT NULL AND to_regclass('public.report_activity') IS NULL THEN ALTER VIEW public.report_activity_readable RENAME TO report_activity; END IF;
  IF to_regclass('public.users_readable') IS NOT NULL AND to_regclass('public.users_display') IS NULL THEN ALTER VIEW public.users_readable RENAME TO users_display; END IF;
  IF to_regclass('public.products_readable') IS NOT NULL AND to_regclass('public.products_display') IS NULL THEN ALTER VIEW public.products_readable RENAME TO products_display; END IF;
  IF to_regclass('public.product_variants_readable') IS NOT NULL AND to_regclass('public.product_variants_display') IS NULL THEN ALTER VIEW public.product_variants_readable RENAME TO product_variants_display; END IF;
  IF to_regclass('public.inventory_levels_readable') IS NOT NULL AND to_regclass('public.inventory_levels_display') IS NULL THEN ALTER VIEW public.inventory_levels_readable RENAME TO inventory_levels_display; END IF;
  IF to_regclass('public.sales_readable') IS NOT NULL AND to_regclass('public.sales_display') IS NULL THEN ALTER VIEW public.sales_readable RENAME TO sales_display; END IF;
  IF to_regclass('public.payments_readable') IS NOT NULL AND to_regclass('public.payments_display') IS NULL THEN ALTER VIEW public.payments_readable RENAME TO payments_display; END IF;
  IF to_regclass('public.sale_items_readable') IS NOT NULL AND to_regclass('public.sale_items_display') IS NULL THEN ALTER VIEW public.sale_items_readable RENAME TO sale_items_display; END IF;
  IF to_regclass('public.sale_returns_readable') IS NOT NULL AND to_regclass('public.sale_returns_display') IS NULL THEN ALTER VIEW public.sale_returns_readable RENAME TO sale_returns_display; END IF;
  IF to_regclass('public.inventory_movements_readable') IS NOT NULL AND to_regclass('public.inventory_movements_display') IS NULL THEN ALTER VIEW public.inventory_movements_readable RENAME TO inventory_movements_display; END IF;
END $$;
