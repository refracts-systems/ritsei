---
name: change-schema
description: "Use when changing RITSEI persistence: files under db/schema, tables, columns, constraints, indexes, triggers, RLS policies, backfills, or Drizzle migrations; also when choosing between direct-write-and-map-error, pre-validation, or in-transaction validation for relational or concurrency-sensitive data."
---

# Purpose

Change persistence through the owning domain, the Drizzle schema graph, reviewed migrations, and
database-level invariants. PostgreSQL constraints are the final correctness boundary.

# Do Not Use When

- only a DTO or API representation changes;
- the package is not the registered schema owner (`db/ownership.toml`);
- the request would rewrite an applied migration.

# Workflow

1. **Inspect.** Confirm the owner in `db/ownership.toml`; read the owner's schema file, service
   write path, constraint-to-error mappings, PostgreSQL tests, and the latest migration snapshots.
2. **Decide.** Choose the minimum structural change. Decide which guarantee belongs in Effect Schema,
   domain logic, a transaction, and PostgreSQL. Concurrency-sensitive state validates and mutates
   atomically. For the validation strategy trade-offs read
   [`references/constraint-validation-strategy.md`](./references/constraint-validation-strategy.md).
3. **Implement.**
   1. Edit only the owner's `db/schema/<schema>.ts`; export it from `db/schema/index.ts` if new.
   2. `pnpm run db:generate --name=<short_name>`; for unsupported DDL (RLS, triggers, partitioning,
      deferred constraints, `ltree`, SQL/PGQ) use `--custom` and edit the SQL.
   3. Add owner, review-date, and generator headers; keep the generated directory name and its
      `snapshot.json`.
   4. Map specific constraint names to tagged domain errors in the owning service.
   5. Add a PostgreSQL invariant test when the guarantee cannot be proved by the in-memory layer.
4. **Validate.** Review generated SQL and snapshot ancestry (linear, schema-qualified), then:

```sh
pnpm run db:check
pnpm run boundary:lint
pnpm run check
pnpm run test
```

Rehearse against a disposable database when `DATABASE_URL` is set. Use `pnpm run db:migrate` only
against an explicitly selected database; never run destructive or production migrations without the
existing review controls. Database rules: [`db/AGENTS.md`](../../../db/AGENTS.md).

# Stop and report when

The target package is not the owner, a migration would need rewriting, generated SQL touches another
domain's objects without declared co-owners, or no safe backfill/rollback is defined.

# Related

[`cross-domain-and-transactions`](../cross-domain-and-transactions/SKILL.md),
[`create-domain-module`](../create-domain-module/SKILL.md). References: ADR-0012,
`docs/architecture/postgresql-19-architecture.md`, `docs/operations/database-roles.md`,
`framework/platform/postgres/tests/migrations.test.ts`.
