-- owner: party
-- reviewed: 2026-08-31
-- generated-by: drizzle-kit 1.0.0-rc.4 --custom
-- rationale: expose a bounded read projection of authoritative Party relationships
-- amended: 2026-10-18 — rewritten as relational views because upstream reverted
--   SQL/PGQ (property-graph DDL and graph pattern queries) from PostgreSQL 19
--   after beta 3; the same two-edge path semantics are preserved with plain joins.

CREATE VIEW "party"."legal_entity_organization_edges" AS
SELECT
  "tenant_id",
  "id" AS "legal_entity_id",
  "organization_party_id"
FROM "party"."legal_entities";

CREATE VIEW "party"."related_party_paths" AS
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
WHERE "relationship"."active";
