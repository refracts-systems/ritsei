-- owners: product, inventory
-- reviewed: 2026-10-20
-- generated-by: drizzle-kit 1.0.0-rc.4 --custom
-- rationale: give every existing inventory item a stockable product with the same identity, so
--   product identity owns items created before the product module (ADR-0097); reads inventory,
--   writes only product

INSERT INTO "product"."products" ("id", "tenant_id", "code", "name", "type", "unit_of_measure")
SELECT "id", "tenant_id", "sku", "name", 'stockable', "unit_of_measure"
FROM "inventory"."items"
ON CONFLICT DO NOTHING;
