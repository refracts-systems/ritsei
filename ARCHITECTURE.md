# RITSEI Architecture

RITSEI is an orthogonal modular monolith built around explicit
domain ownership, PostgreSQL-enforced integrity, Effect-based application
services, and independently deployable frontend infrastructure.

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
- Stateful ownership: optional vendor-neutral Stateful Entity Runtime
- Overload isolation: workload planes, reserved command capacity, and topology-private WorkloadCells
- Source/derived non-interference: source-of-truth critical paths remain independent of derived capabilities
- Analytics: domain-owned facts, versioned metrics, rebuildable projections, and no primary fallback
- Search: PostgreSQL-first, rebuildable, and provider-replaceable
- Native compute: optional Zig through typed FFI bindings
- Process composition target: typed catalogs, deterministic Process IR, and a
  governed Process Studio

Stateful ownership, routing, recovery, and consistency are defined in
[`docs/architecture/runtime-architecture.md`](./docs/architecture/runtime-architecture.md)
and
[`docs/architecture/state-and-consistency.md`](./docs/architecture/state-and-consistency.md).
The canonical Process Studio target and staged 0.8–1.0 roadmap are defined in
[`docs/architecture/process-studio.md`](./docs/architecture/process-studio.md).
The external connector profile is defined in
[`docs/architecture/integration-architecture.md`](./docs/architecture/integration-architecture.md).
Source-of-truth versus derived-capability non-interference, workload planes, resource admission,
WorkloadCells, shuffle sharding, and their proof obligations are defined in
[`docs/architecture/workload-isolation.md`](./docs/architecture/workload-isolation.md) and
[ADR-0083](./docs/decisions/0083-enforce-non-interference-between-source-of-truth-and-derived-capabilities.md).
Analytic facts, metrics, freshness, semantic queries, and provider gates are defined in
[`docs/architecture/analytics-architecture.md`](./docs/architecture/analytics-architecture.md).
Search authority, projections, provider gates, and search-specific workload safety are defined in
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

- `foundation/`: generic primitives and contracts;
- `modules/`: business capabilities with public `mod.ts` entries;
- `platform/`: concrete infrastructure adapters;
- `runtime/`: application composition roots and transport workers;
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
