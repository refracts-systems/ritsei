# RITSEI Architecture

RITSEI is an orthogonal modular monolith built around explicit
domain ownership, PostgreSQL-enforced integrity, Effect-based application
services, and independently deployable frontend infrastructure.

## Framework and ERP

RITSEI is an ERP framework (`framework/`) with a flagship ERP (`erp/`) built on it like any
third-party module; `extensions/` will hold modules from other developers. See
[ADR-0091](./docs/decisions/0091-adopt-framework-and-flagship-erp.md) and the
[framework reset proposal](./docs/proposals/framework-reset.md). Removed subsystems are gone from the
tree; their history is in git. TigerBeetle
([ADR-0092](./docs/decisions/0092-retain-tigerbeetle-as-designated-ledger-engine.md)), workload
isolation, the Stateful Entity Runtime, and the analytic plane
([ADR-0093](./docs/decisions/0093-retain-isolation-runtime-and-analytic-target-designs.md)) remain as
inactive target designs, each activated only by its own ADR.

## Canonical Specification

The authoritative architecture specification is:

[`docs/architecture/architecture-spec-v4.md`](./docs/architecture/architecture-spec-v4.md)

## Core Architecture

- Runtime: Node.js 24 LTS
- Package manager: pnpm 12
- Language: TypeScript strict
- Application model: Effect-based typed transitions, services, and commands
- Database: PostgreSQL 19+
- Query layer: Drizzle ORM + postgres.js
- Frontend renderer: Vite + SolidJS 2.0; JSX compiler isolated to `apps/web`
- Contracts: Effect Schema
- Identity / IAM: provider-neutral OIDC/OAuth2 `IdentityProvider`; ZITADEL is recommended
- Application AuthZ: RITSEI Authorization Kernel with canonical PostgreSQL policy facts
- Relationship AuthZ: native PostgreSQL `RelationshipEngine` by default; optional SpiceDB adapter
- Reports: SQL and materialized views in PostgreSQL (target: analytic plane, ADR-0093)
- Search: PostgreSQL only
- Financial ledger: PostgreSQL double-entry ledger (the only active financial authority);
  TigerBeetle is the designated future engine behind the ledger port
  ([ADR-0092](./docs/decisions/0092-retain-tigerbeetle-as-designated-ledger-engine.md))
- Process engine: deferred by ADR-0091 until the core ERP loops run end to end

Commands, events, outbox, jobs, and consistency are defined in
[`docs/architecture/state-and-consistency.md`](./docs/architecture/state-and-consistency.md).
The deferred Process Studio specification is
[`docs/architecture/process-studio.md`](./docs/architecture/process-studio.md).
The external connector profile is defined in
[`docs/architecture/integration-architecture.md`](./docs/architecture/integration-architecture.md).
Search authority and projections are defined in
[`docs/architecture/search-architecture.md`](./docs/architecture/search-architecture.md).
Identity, authentication, principal provenance, and revocation are defined in
[`docs/architecture/identity-and-principals.md`](./docs/architecture/identity-and-principals.md).
HTTP tenant context and API authorization order are defined in
[`docs/architecture/api.md`](./docs/architecture/api.md).
Authorization ownership, capability evaluation, object relationships, SoD, and decision evidence are
defined in [`docs/architecture/authorization.md`](./docs/architecture/authorization.md).
Procurement ownership, the Purchase Order lifecycle, and receipt activation gates are defined in
[`docs/architecture/procurement.md`](./docs/architecture/procurement.md).

## Repository taxonomy

- `framework/foundation/`: generic primitives and contracts;
- `framework/platform/`: concrete infrastructure adapters;
- `framework/modules/`: framework capabilities (auth, identity, authorization, messaging,
  integrations, catalog) with public `mod.ts` entries;
- `erp/modules/`: flagship ERP business modules with public `mod.ts` entries;
- `erp/runtime/`: ERP composition roots, API server, and workers;
- `extensions/`: modules from other developers, empty until one exists;
- `apps/web/`: the separate frontend application; and
- `db/`: schema and migration authority.

The dependency matrix and enforcement decision are in
[`docs/decisions/0068-establish-foundation-modules-platform-runtime-taxonomy.md`](./docs/decisions/0068-establish-foundation-modules-platform-runtime-taxonomy.md).

## Dependency Ownership

```text
             ┌─────────────────────┐
             │    package.json     │
             │                     │
             │ npm dependencies    │
             │ dev dependencies    │
             └──────────┬──────────┘
                        │
                        ▼
                  pnpm install
                        │
              ┌─────────┴─────────┐
              ▼                   ▼
         node_modules         pnpm-lock.yaml


             ┌─────────────────────┐
             │  package.json       │
             │                     │
             │ type check          │
             │ fmt (oxfmt)         │
             │ tasks               │
             └─────────────────────┘
