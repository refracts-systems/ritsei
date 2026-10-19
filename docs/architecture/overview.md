# Architecture Overview

> **Status:** Canonical summary
>
> **Target versus current ([ADR-0091](../decisions/0091-adopt-framework-and-flagship-erp.md),
> [ADR-0092](../decisions/0092-retain-tigerbeetle-as-designated-ledger-engine.md),
> [ADR-0093](../decisions/0093-retain-isolation-runtime-and-analytic-target-designs.md)):** the
> system shape below is the target design. Today it runs as:
>
> ```text
> Principal -> API pool --+-> PostgreSQL: domain state, authorization, audit, outbox, job table
>                         `-> FinancialLedgerPort -> PostgreSQL ledger
> Worker pool -> outbox delivery, job table, integrations
> Reports     -> module-owned SQL views and materialized views
> ```
>
> WorkloadCells and workload planes ([`workload-isolation.md`](./workload-isolation.md)), the
> Stateful Entity Runtime ([`runtime-architecture.md`](./runtime-architecture.md)), the query plane
> and OLAP providers ([`analytics-architecture.md`](./analytics-architecture.md)), and the TigerBeetle
> adapter are inactive target designs, each activated only by its own ADR.
>
> **Related documents**
>
> - Full specification: [`./architecture-spec-v4.md`](./architecture-spec-v4.md)
> - PostgreSQL design: [`./postgresql-19-architecture.md`](./postgresql-19-architecture.md)
> - Logical database and physical placement:
>   [`../decisions/0067-separate-logical-database-and-physical-data-placement.md`](../decisions/0067-separate-logical-database-and-physical-data-placement.md)
> - Search architecture: [`./search-architecture.md`](./search-architecture.md)
> - State and consistency: [`./state-and-consistency.md`](./state-and-consistency.md)
> - Financial ledger: [`./financial-ledger.md`](./financial-ledger.md)
> - Frontend architecture: [`./frontend.md`](./frontend.md)
> - Identity and principals: [`./identity-and-principals.md`](./identity-and-principals.md)
> - HTTP API boundary: [`./api.md`](./api.md)
> - Authorization: [`./authorization.md`](./authorization.md)
> - Design system architecture: [`./design-system.md`](./design-system.md)
> - Skeleton architecture: [`./skeleton.md`](./skeleton.md)
> - Document rendering architecture: [`./document-rendering.md`](./document-rendering.md)
> - Communication platform architecture: [`./communication.md`](./communication.md)
> - Process Studio architecture: [`./process-studio.md`](./process-studio.md)
> - External integration surface: [`./integration-architecture.md`](./integration-architecture.md)
> - Architecture enforcement: [`./architecture-enforcement.md`](./architecture-enforcement.md)
> - Database roles: [`../operations/database-roles.md`](../operations/database-roles.md)
> - ADR index: [`../decisions/README.md`](../decisions/README.md)

## System Shape

```text
Human and machine principals
  |
OIDC/OAuth2 IdentityProvider (ZITADEL recommended)
  |
RITSEI auth boundary -> validated Principal
  |
Edge / thin workload router
  |
WorkloadCell placement (topology-private)
  |
  +--> Command plane --> command pool --> PostgreSQL control plane
  |         |
  |         +--> FinancialLedgerPort --> trusted TigerBeetle adapter --> TigerBeetle
  |         `--> optional Stateful Entity Runtime for approved aggregates
  |
  +--> Query plane --> semantic/query gateway --> rebuildable projection store
  |                                              |
  |                                              `--> optional OLAP/historical provider
  |
  `--> Async plane --> PgQue / jobs / workflows / integrations
                              |
                              `--> projection builders, rebuilds, and financial reconciliation

PostgreSQL 19 remains canonical for non-ledger transactional domain state, metadata,
RITSEI membership and authorization facts, audit, outbox, and durable work. A replaceable
relationship evaluator may support object checks but is not a second authorization or business
authority. TigerBeetle is canonical for accepted financial transfers, balances, and transfer history
in the activated ledger profile.
```

The API, worker, event relay, and migrator remain separate processes in one application family. They
share domain packages and target a logical PostgreSQL database contract; the current deployment may
still use one physical placement. WorkloadCell and data placement must preserve every accepted
cross-domain PostgreSQL transaction boundary; splitting one requires a superseding consistency
decision. The processes are not independent microservices. Minimal deployments may colocate workload
roles; hard-isolation claims require actual reserved resources, credentials, pools, and tested failure
boundaries.

## Runtime

```text
Backend:
TypeScript strict
+ Effect
+ Deno
+ @effect/platform
+ Drizzle ORM
+ postgres.js

Frontend SPA:
Vite
+ SolidJS 2.0 renderer and presentation runtime
+ Solid JSX/compiler lowering inside `apps/web`
+ Effect-based application model and typed transitions
+ Solid Router or an adapted TanStack Solid Router
+ TanStack Solid Query
+ TanStack Solid Table
+ TanStack Solid Virtual
+ TanStack Solid Form
+ Effect Schema
+ RITSEI Design System
+ RITSEI Skeleton boundary with static geometry artifacts
+ Kobalte behind RITSEI-owned components
+ constrained Panda CSS
```

Effect handles typed failures, dependency injection, lifecycle, concurrency,
retry, streams, and telemetry. In the frontend, it also coordinates explicit
application transitions and effects; SolidJS remains the renderer and owner of
presentation-local state. The JSX/compiler transform stays below that boundary.
Drizzle handles typed schema and queries.
PostgreSQL remains responsible for control-plane transactions and non-ledger
business invariants. The FinancialLedgerPort sends accepted financial movements
to TigerBeetle; the optional Stateful Entity Runtime may own active serialization
and hot state for explicitly approved aggregates, but it does not become financial
authority.

## Boundaries

Each domain owns its PostgreSQL schema and internal implementation. Cross-domain
interaction occurs through typed Effect services, commands, queries, and events.

A Sales operation may call `InventoryService.reserveStock` in the same
transaction, but Sales must not import or mutate Inventory tables directly.

## Identity and Authorization

The configured IdentityProvider answers identity and authentication for human and machine
principals; ZITADEL is recommended but not required. RITSEI identity maps external subjects to
internal `UserAccount` records, while RITSEI Authorization owns tenant membership, roles,
capabilities, grants, scopes, SoD, and final decision evidence. The precomputed permission matrix is
the coarse gate; the replaceable RelationshipEngine uses native PostgreSQL by default and may use
SpiceDB as an optional high-scale adapter. Domain policy and tenant isolation remain RITSEI-owned.

Every protected operation follows:

```text
Identity -> Capability -> Scope -> Object Relationship -> Domain Policy -> SoD -> Audit
```

Provider outage, stale revocation, missing tenant context, or unknown relationship state fails closed.

## Consistency

- Direct PostgreSQL transaction: non-ledger invariant required before request success.
- Financial ledger protocol: durable PostgreSQL intent, TigerBeetle acceptance, projection, and reconciliation.
- Stateful Entity Runtime: optional active ownership and identity-local serialization.
- PgQue: committed fact and fan-out.
- Job table: single-consumer work with lease and lifecycle.
- `pg_durable`: checkpointed multi-step workflow after compatibility approval.
- Analytic stores, search indexes, and caches: rebuildable projections.

Document rendering is a proposed output platform rather than a business authority. Owner-local
snapshots feed a versioned Document AST; renderer families remain replaceable and browser rendering
is an explicit compatibility path. See [`./document-rendering.md`](./document-rendering.md) and
[ADR-0081](../decisions/0081-adopt-document-ast-rendering-platform.md). The proposal is not active
until its contract, security, determinism, workload, and dependency gates pass.

Communication is an intent-driven platform boundary. Domains publish business facts through
Messaging; application-level communication policies derive intents, while explicit user or process
requests may create them directly. The platform resolves recipients, versioned contexts, channel
message models, immutable artifacts, and delivery attempts behind provider adapters. The Activity
Timeline is a federated, rebuildable projection over separate audit, note, attachment, workflow,
document, and communication records, not a universal `chatter_messages` authority. See
[`./communication.md`](./communication.md) and
[ADR-0082](../decisions/0082-adopt-communication-platform-boundaries.md).

## Non-Interference

Class A source-of-truth reads and writes use only their owner-local critical dependencies. Class B
operational capabilities and Class C projections consume committed facts asynchronously and may lag,
retry, degrade, or be unavailable without making the source fact unreadable or uncommitted. Core
screens and APIs compose timeline, documents, communications, workflow, search, and analytics through
independent failure boundaries.

Commands, projection queries, and asynchronous work have separate workload metadata and bounded
admission. A deployment claiming hard query-to-command isolation reserves command ingress,
executors, and connection capacity that projection-query and async lifecycle work cannot acquire.
Projection-query executors hold no primary credential. Async infrastructure may use a separate,
narrow primary-backed lifecycle budget, but async-triggered business commands must re-enter the
command path. Projection failure degrades or rejects reads; it does not silently fall back to
reserved command resources.

WorkloadCells and optional tenant-aware shuffle sharding narrow deployment blast radius without
changing domain ownership, public identity, authorization, or PostgreSQL truth. See
./workload-isolation.md,
[ADR-0034](../decisions/0034-adopt-non-interference-overload-isolation.md), and
[ADR-0083](../decisions/0083-enforce-non-interference-between-source-of-truth-and-derived-capabilities.md).

## Analytics

Source domains publish versioned Business Fact Contracts through public facts, committed events, or
owner-approved rebuild exports. Versioned metric contracts define grain, dimensions, aggregation,
time, exact arithmetic, authorization, and freshness without exposing provider topology.

Analytic reads remain bounded query work; ingestion, rebuild, backfill, and export remain async work.
PostgreSQL projections are the baseline. External OLAP or historical providers require measured need
and conformance evidence. A hard-isolated analytic route has no primary credential or fallback; it
serves declared stale data or typed unavailability when no eligible projection satisfies the
contract.

See ./analytics-architecture.md.

## Search

Exact and structured PostgreSQL queries remain the default. Domain-local search reads only owned
data. Global search consumes published facts into a tenant-scoped, rebuildable projection and returns
candidate references that are revalidated through the owning domain before sensitive use or action.
PostgreSQL-native BM25 and vector search remain gated by PostgreSQL 19 compatibility and workload
evidence; external search remains a later deployment optimization.

See [`./search-architecture.md`](./search-architecture.md).

## External Integration Surface

External integrations use a typed connector boundary. HTTPS + JSON + OpenAPI is
the default action surface; CloudEvents over HTTPS and AsyncAPI describe external
events; OAuth 2.0 and stable Problem Details protect and normalize the surface.
Connector protocols such as Kafka, gRPC, SOAP, or OData remain adapters and do
not enter domain contracts or Process IR.

See [`./integration-architecture.md`](./integration-architecture.md).

## Process Composition

The planned Process Studio composes versioned typed actions and events through a
small deterministic Process IR. It is catalog-first and runtime-first: domain
capability metadata, compensation, idempotency, correlation, and durable
headless execution mature before the visual designer. Published definitions are
immutable, running instances remain version-pinned, and every command executes
through its owning public domain contract.

See [`./process-studio.md`](./process-studio.md) for the canonical target and
[`../roadmap/process-studio.md`](../roadmap/process-studio.md) for delivery gates.

## Extensions

Preferred order:

1. core module;
2. declarative tenant extension;
3. trusted compiled plugin;
4. sandboxed plugin after contracts stabilize.
