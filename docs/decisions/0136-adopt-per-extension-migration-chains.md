# ADR-0136: Adopt Per-Extension Migration Chains

- Status: Accepted
- Date: 2026-11-25
- Amends: None
- Compatible with: ADR-0091, ADR-0094
- Supersedes: None
- Superseded by: None
- Changes: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Framework, ERP, and extensions: [`./0091-adopt-framework-and-flagship-erp.md`](./0091-adopt-framework-and-flagship-erp.md)
> - Module manifest: [`./0094-adopt-module-manifest-registry-and-generator.md`](./0094-adopt-module-manifest-registry-and-generator.md)
> - Persistence rules: [`../../db/AGENTS.md`](../../db/AGENTS.md)
> - Extensions: [`../../extensions/README.md`](../../extensions/README.md)

## Context

Extensions are modules from other developers and customers (ADR-0091). ADR-0132 builds the first
one, Helpdesk, and keeps its tables in the core migration chain: `db/schema/` and `db/migrations/`
are one Drizzle Kit snapshot graph, and `db/ownership.toml` assigns each PostgreSQL schema to a
module directory.

One chain is fine while every author is a maintainer. It does not hold for public extensions:

- The snapshot graph is linear. Two branches that each add a migration fork it; this already
  happened between two core pull requests and needed a repair change.
- An outside author's SQL would sit in the same chain as core SQL, ordered by it, reviewed in the
  same place, and impossible to leave out when the extension is not installed.
- Nothing stops an extension migration from altering a core table, adding a trigger on one, or
  creating objects in a core schema.
- Removing an extension cannot remove its migrations from the core history.

## Decision

1. **Each extension owns its migrations.** An extension keeps its schema in
   `extensions/<name>/db/schema.ts` and its migrations in `extensions/<name>/db/migrations/`, each a
   `migration.sql` with a sibling `snapshot.json`, with its own Drizzle Kit configuration and its own
   snapshot chain. ERP modules and the framework stay in `db/`.
2. **The core chain runs first, then each installed extension's chain**, in the order of the
   extensions' `dependsOn` and then by name. A core migration never depends on an extension.
3. **Each chain has its own journal.** Core keeps `system.schema_migrations`. An extension records its
   migrations in its own table `system.extension_migrations_<name>` (the shape Drizzle's migrator
   writes), so one extension's history can be read, checked, or detached without touching
   another's.
4. **An extension writes only to its own schemas.** Its schemas are the ones its manifest declares and
   `db/ownership.toml` (or the extension's own ownership entry) assigns to it. A check scans every
   extension migration and fails on DDL that creates, alters, drops, grants on, or attaches a trigger
   to an object outside those schemas, on `CREATE EXTENSION`, and on a schema name already owned by
   another module.
5. **References to core are by stable identifier, not by constraint.** An extension row may store a
   core id (a tenant, a legal entity, a user account) and checks it through the core module's public
   contract. A database foreign key into a core schema is not allowed, so core can change its tables
   without breaking extensions and an extension can be removed without blocking core.
6. **Tenant isolation is the extension's to declare and the framework's to check.** Every table an
   extension creates carries a `tenant_id` column, as core tables do; the migration check fails on a
   table without one. Core tables use no row-level security today, so none is required of extensions
   until core adopts it.
7. **The first-party Helpdesk extension moves to its own chain** in a follow-up change once this ADR
   is accepted, with the migration rewritten as the first migration of its chain. Until then it stays
   in `db/`, which ADR-0132 accepted.
8. **Installing is explicit.** The set of installed extensions comes from the generated module list
   (ADR-0094). An extension that is not installed has no schema in the database and no row in the
   journal.

## Alternatives Considered

- **Keep one chain for everything.** Rejected for public extensions: ordering, review, and removal
  all stay coupled to core. Kept, for now, for first-party extensions until the follow-up change.
- **One chain, but extension migrations in a separate directory.** Rejected: the snapshot graph
  would still be one, so forks and ordering stay shared.
- **Extensions run their own database or connection.** Rejected: it breaks the single-transaction
  invariants and the outbox that PostgreSQL gives core, and adds an operations burden with no
  measured need.
- **Allow foreign keys into core.** Rejected by decision 5: it ties core changes to every extension
  and blocks uninstalling.

## Consequences

### Positive

- An outside author changes only their extension; core history stays core's.
- An uninstalled extension leaves no objects behind, and its migrations can be reviewed alone.
- The scan makes the boundary a check instead of a review habit.

### Negative

- A second migration runner path, a second journal table, and a migration check to build.
- No database-level referential integrity from extension rows to core rows; the extension must
  tolerate a missing core row.
- Uninstalling still needs a defined way to drop an extension's schema; it is not automatic.

### Risks

- A migration check that is too weak lets an extension reach into core. Mitigation: the check parses
  the SQL statements, not file names, and is tested with fixtures of each forbidden shape.
- Ordering bugs between chains when extensions depend on each other. Mitigation: decision 2 orders by
  `dependsOn`, and the runner fails on a cycle.

## Owner decisions (2026-11-25)

The owner accepted the recommendations:

1. A database foreign key from an extension into core is never allowed (decision 5); extensions
   tolerate a missing core row.
2. Uninstalling an extension stops loading it and keeps its data. Dropping its schema is a separate,
   explicit command that asks for confirmation and writes an audit record.
3. The migration check runs on every pull request, not only those that touch `extensions/`.

## Validation

- Core migrates cleanly with no extension installed, and with each extension installed.
- Two extensions' chains evolve independently; adding a migration to one never forks the other.
- A fixture migration that alters a core table, creates a trigger on one, or writes into a schema it
  does not own fails the check, as does a table without tenant column and row-level security.
- Removing an extension from the module list leaves the core chain and journal unchanged.
