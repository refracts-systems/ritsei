# db rules

Persistence-specific rules; repository-wide rules are in the root [`AGENTS.md`](../AGENTS.md).
Related: [`state-and-consistency.md`](../docs/architecture/state-and-consistency.md),
[`database-roles.md`](../docs/operations/database-roles.md), `ownership.toml`.

## Database

- PostgreSQL 19+ is the minimum; `platform/postgres` rejects `server_version_num` below `190000`.
- Critical invariants need transactions and database constraints; application validation improves
  errors but does not replace constraints.
- Generate every migration with pinned Drizzle Kit `1.0.0-rc.4`. Use `drizzle-kit generate --custom`
  for RLS, locking, deferred constraints, partitioning, `ltree`, SQL/PGQ, triggers, and unsupported
  features. Generated SQL is review-required.
- Each migration directory contains `migration.sql` and a sibling `snapshot.json`, and the file
  carries owner, review-date, and generator headers. The snapshot graph is authoritative for order.
- Never rewrite an applied migration; add a new one.

## Drizzle integration

- `db/schema/index.ts` is the Drizzle Kit entry point. A domain implementation imports only its owned
  tables; public package entry points never re-export tables or Drizzle query types.
- Use Drizzle query builders for application reads and writes. Raw SQL in a domain implementation is
  forbidden; unsupported DDL goes in a reviewed custom migration.
- Run every invariant-sensitive mutation through the foundation database contract's typed
  transaction service (implemented by `platform/postgres/`). Domains never construct a driver client.
- Keep the driver, client lifecycle, transaction boundary, and infrastructure-error mapping inside
  `foundation/` contracts and `platform/postgres/` adapters.
- Map constraint failures to tagged domain errors in the owning domain; never expose raw PostgreSQL
  or Drizzle errors.
- Adapt integration examples to this repository's `DatabaseLayer`; do not copy them verbatim.
