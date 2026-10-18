-- owner: party
-- reviewed: 2026-09-01
-- generated-by: drizzle-kit 1.0.0-rc.4 --custom
-- rationale: enforce the non-reflexive related-party projection invariant at the view boundary
-- amended: 2026-10-18 — rewritten as a relational view because upstream reverted
--   SQL/PGQ (property-graph DDL and graph pattern queries) from PostgreSQL 19
--   after beta 3; the non-reflexive invariant and read-only projection are preserved.

CREATE OR REPLACE VIEW "party"."related_party_paths" AS
SELECT
  "relationship"."tenant_id",
  "relationship"."party_id" AS "source_party_id",
  "ownership"."organization_party_id" AS "target_party_id",
  "ownership"."legal_entity_id",
  "relationship"."id" AS "relationship_id",
  "relationship"."kind" AS "relationship_kind",
  2::integer AS "depth"
FROM "party"."party_relationships" AS "relationship"
JOIN "party"."legal_entity_organization_edges" AS "ownership"
  ON "ownership"."tenant_id" = "relationship"."tenant_id"
 AND "ownership"."legal_entity_id" = "relationship"."legal_entity_id"
WHERE "relationship"."active"
  AND "relationship"."party_id" <> "ownership"."organization_party_id";
