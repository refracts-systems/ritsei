# Architecture Enforcement

> **Status:** Canonical
>
> **Owns:** Automated enforcement of module and technical boundaries, schema ownership,
> forbidden cross-domain imports, dependency cycles, and the distinction between static
> checks and behavioral evidence.
>
> **Related documents**
>
> - Global architecture: [`./architecture-spec-v4.md`](./architecture-spec-v4.md)
> - Repository taxonomy: [`../decisions/0068-establish-foundation-modules-platform-runtime-taxonomy.md`](../decisions/0068-establish-foundation-modules-platform-runtime-taxonomy.md)
> - PostgreSQL ownership: [`./postgresql-19-architecture.md`](./postgresql-19-architecture.md)
> - Financial ledger: [`./financial-ledger.md`](./financial-ledger.md)
> - Testing strategy: [`../development/testing.md`](../development/testing.md)
> - Database roles: [`../operations/database-roles.md`](../operations/database-roles.md)
> - Logical database and physical placement:
>   [`../decisions/0067-separate-logical-database-and-physical-data-placement.md`](../decisions/0067-separate-logical-database-and-physical-data-placement.md)
> - Authorization: [`./authorization.md`](./authorization.md)
> - Identity and principals: [`./identity-and-principals.md`](./identity-and-principals.md)
> - HTTP API boundary: [`./api.md`](./api.md)
> - Design system and Visual Grammar: [`./design-system.md`](./design-system.md)
> - Cartographic renderer selection: [`../decisions/0070-select-vgpu-and-defer-typegpu.md`](../decisions/0070-select-vgpu-and-defer-typegpu.md)
> - Universal cartographic archetypes: [`../decisions/0071-adopt-universal-cartographic-archetypes.md`](../decisions/0071-adopt-universal-cartographic-archetypes.md)
> - Governed AI recommendation and agent boundary:
>   [`../decisions/0063-define-governed-ai-recommendation-and-agent-boundary.md`](../decisions/0063-define-governed-ai-recommendation-and-agent-boundary.md)
> - Documentation ownership: [`../documentation-boundaries.md`](../documentation-boundaries.md)

## Purpose

Architectural boundaries are not considered effective merely because they are
documented. The repository must enforce them through static checks, tests,
database privileges, deployment validation, and CI.

## Module Boundary Model

A business module may import:

- its own internal modules;
- public contracts exported by another business module;
- generic contracts from `foundation/`; and
- its owned `db/schema` tables where the ownership registry permits it.

A business module must not import:

- concrete adapters from `platform/`;
- application composition from `runtime/`;

- another domain's table definitions;
- another domain's repository implementations;
- another domain's internal services;
- another domain's migration files;
- another module's table definitions;
- another module's repository implementations;
- another module's internal services;
- another module's migration files;
- application entry points;
- server-only code from frontend packages.

## Business Surface and Generated Ergonomics

Concrete business objects do not create a second authority model. Enforcement must preserve the
following distinction:

- owner-local documents expose public commands, queries, schemas, errors, and layers;
- ordinary structural helpers may update only owner-approved ordinary fields;
- lifecycle and posting fields change only through the owning public action path;
- generated artifacts must not import private tables, repositories, or infrastructure types;
- cross-domain consequences use public contracts and typed transaction or financial-ledger ports;
- ORM hooks, subscribers, and generated callbacks must not become hidden cross-domain authority;
- generated API, form, audit, or event metadata must preserve the owning capability and scope.

Static rules can reject private imports, persistence re-exports, and forbidden package edges. The
transitional Accounting PostgreSQL ledger factory is the only current adapter-export exception; its
scope and removal path are documented in [`financial-ledger.md`](./financial-ledger.md). No other
provider, store, table, or repository implementation may be re-exported. Owner contract tests must
prove protected transitions, authorization, idempotency, correction, and consequence ownership. A
future generator must add its own rule tests before generated artifacts are accepted as a supported
public path.

## Allowed Dependency Direction

```text
foundation
  <- modules <- runtime
  <- platform <- runtime

module A
  -> module B public contract

module A
  -X-> platform adapter
  -X-> module B internal implementation

frontend
  -> module public contracts
  -X-> backend repositories or database schema
```

## Frontend Design-System Enforcement

The canonical frontend visual and interaction rules live in
[`./design-system.md`](./design-system.md). Once production UI activation begins, static and
contract checks must enforce the boundary rather than relying on review alone:

- Kobalte, Panda-generated artifacts, dnd-kit, chart adapters, Canvas, WebGPU, and `vgpu` imports
  (including `vgpu/node`, `vgpu/mock`, and `vgpu/scene`) are limited to the internal
  `apps/web/src/ui/` layer;
- feature UI consumes semantic RITSEI variants and approved recipes, not raw primitive colors,
  arbitrary spacing, broad style props, or hard-coded material intensity;
- cartographic projections declare their archetype and semantic material mapping; per-render random
  values must not define an entity's visual identity;
- renderer adapters expose semantic fallbacks and cannot become sources of business state,
  authorization, or workflow authority;
- cartographic projections pass typed visual intent to the renderer adapter rather than importing
  `vgpu` or raw WebGPU directly; and
- accessibility, reduced-motion, contrast, and renderer performance remain runtime/evidence checks,
  not claims inferred from static import boundaries;
- Fallow classifies `apps/web/src/ui/` into public leaf, stylesheet bootstrap, and internal zones:
  application and feature code may import only the allowlisted public leaf modules plus the bootstrap,
  while UI internals and tests may inspect the internal zone; and
- the small architecture checker retains the exact catch-all root-barrel prohibition, because Fallow
  zones enforce file-to-zone reachability rather than the semantic meaning of an individual export.

No current check claims that the exploratory frontend prototype has completed these activation gates.

## Module Boundary Manifest

Each business module should expose an explicit public `mod.ts` entry point.

Example:

```text
modules/inventory/
├── mod.ts
├── src/
│   ├── commands/
│   ├── queries/
│   ├── services/
│   ├── errors/
│   ├── schema/
│   └── internal/
└── tests/
```

Only exports reachable from `mod.ts` form the public contract.

The boundary checker must reject imports such as:

```ts
import { stockPosition } from "../inventory/src/internal/tables.ts"
```

and allow imports such as:

```ts
import { InventoryService } from "@ritsei/inventory"
```

The current scaffold deliberately uses only three enforcement layers:

- Fallow owns generic graph, dependency direction, circular-dependency, dead-code, duplication,
  health, and policy analysis through `.fallowrc.json` and
  [`../../tooling/fallow/rules/ritsei-static-policy.json`](../../tooling/fallow/rules/ritsei-static-policy.json);
- ast-grep owns syntax-level policies and their rule tests in
  [`../../sgconfig.yml`](../../sgconfig.yml) and [`../../tooling/ast-grep/`](../../tooling/ast-grep/);
- the small TypeScript checker at
  [`../../tooling/architecture.ts`](../../tooling/architecture.ts) owns only path-sensitive
  public-package, frontend, and AI/provider boundaries;
- [`../../tooling/schema-ownership.ts`](../../tooling/schema-ownership.ts) owns database schema,
  migration, and ownership-registry semantics.

Financial, authorization, Effect, workload, and other business claims are proven by owner-domain
contracts, tests, deployment checks, and operational evidence—not by another generic source scanner.

## Schema Ownership

Each PostgreSQL schema has exactly one owning module.

The owner may:

- define tables and constraints;
- write to its tables;
- expose transaction-aware services;
- publish facts derived from committed changes.

A non-owner must not issue direct writes against the schema.

Cross-domain consistency must use a public service contract inside the same transaction when
atomicity is required for a PostgreSQL-owned invariant. For a TigerBeetle-backed financial
invariant, use `FinancialLedgerPort` plus the durable intent/outcome/reconciliation protocol; do
not claim cross-store ACID or call the external engine while holding a PostgreSQL transaction open.

## Schema Ownership Registry

Maintain one machine-readable registry, for example:

```toml
[schemas]
identity = "modules/identity"
auth = "modules/auth"
sales = "modules/sales"
inventory = "modules/inventory"
accounting = "modules/accounting"
process = "modules/process"
billing = "modules/billing"
integration = "modules/integrations"
```

The active registry is [`../../db/ownership.toml`](../../db/ownership.toml). It is
validated by [`../../tooling/schema-ownership.ts`](../../tooling/schema-ownership.ts) and
consumed by architecture tests. Future migration and privilege tooling must use the same
registry instead of defining a second ownership map.

## SQL Ownership Checks

Static SQL checks should reject:

- writes to a schema not owned by the current module;
- migrations placed outside the owning module or central reviewed migration tree;
- unqualified table references where schema qualification is required;
- raw SQL that bypasses an approved domain service without an explicit exception.

Approved exceptions must be narrow, documented, and reviewed.

## No Cross-Domain Table Imports

Drizzle table definitions live under `db/schema/` for Drizzle Kit discovery but
remain private persistence infrastructure. A domain implementation may import
only tables owned by that domain according to `db/ownership.toml`.

The linter must detect:

- direct imports of another module's table definitions;
- re-exporting persistence tables through a public contract;
- shared generic repository abstractions that expose arbitrary table access;
- frontend imports of database types or table definitions.

Public DTOs must be separate from persistence models.

## External Identity and Authorization Provider Boundary

Configured identity and relationship providers are infrastructure adapters, not RITSEI domains or
sources of truth. ZITADEL is the recommended IdentityProvider adapter; SpiceDB is an optional
RelationshipEngine adapter. Provider-specific SDKs, tokens, claims, tuple formats, revisions,
credentials, and topology remain inside designated adapters or composition roots. Public contracts
expose only provider-neutral RITSEI principals and authorization results.

Business modules must not call an identity or relationship provider directly. Authentication goes
through the provider-neutral IdentityProvider boundary; relationship checks go through the
RelationshipEngine boundary. Membership, roles, capabilities, grants, scopes, SoD, policy, and tenant
isolation remain owned by RITSEI/PostgreSQL and the owning domains.

Provider projections, when selected, must be rebuildable from canonical RITSEI facts. Missing, stale,
or unknown selected-provider state fails closed for sensitive work and cannot silently become an allow
decision.

## AI and Recommendation Boundary

When AI or model-provider code is introduced, static and deployment checks must preserve ADR-0063:

- provider SDK imports are confined to approved adapters under `modules/integrations/`;
- AI/provider code cannot import `db/schema`, migrations, database clients, repositories, private
  domain modules, or private process services;
- cross-domain access, when justified, resolves through a public package entry point and typed
  read/draft contract, never a persistence implementation;
- proposal and recommendation code cannot issue direct business-fact writes or expose a generic
  command/tool executor;
- released Process IR rejects model calls, prompts, provider topology, dynamic capability
  references, arbitrary tools, and nondeterministic binding inputs; and
- AI workers and provider adapters receive no command-plane database credential or hidden primary
  fallback.

The executable evidence is intentionally layered: `tooling/architecture.ts` catches provider and
private-persistence import violations; Process IR and public-contract tests reject untyped or dynamic
proposals; authorization and owner-domain tests prove current capability, scope, relationship, SoD,
idempotency, transaction, and reconciliation checks; deployment tests prove credential and network
separation; and redaction/tenant tests prove safe context and disclosure. Static checks do not claim
to prove runtime mutation safety by themselves.

## Dependency-Cycle Detection

The package and module graphs must remain acyclic unless a documented framework edge is explicitly
exempted. Fallow owns generic circular-dependency and re-export-cycle detection and reports the
files and import paths involved.

Run it with:

```sh
deno task fallow:dead-code
deno task fallow:boundaries
```

`deno task boundary:lint` runs the Fallow boundary check and the two focused RITSEI checks. Fallow
owns generic dependency direction; `tooling/architecture.ts` adds only the stronger public-entry,
frontend, and AI/provider rules that need repository-specific path or syntax context.

## Workload-Isolation Enforcement

When the workload-isolation fabric is implemented, repository and deployment checks must distinguish
what can be proved statically from what requires runtime evidence.

Static and contract checks should reject:

- capability IDs containing cell, shard, priority, pool, region, or executor topology;
- public routes without owner-reviewed workload metadata;
- query composition roots resolving command database services;
- async lifecycle composition roots mutating core domain facts outside command admission;
- projection routes configured with a primary fallback;
- adaptive limiters without a physical hard ceiling;
- unbounded interactive queue or wait configuration;
- public DTOs, events, entity addresses, Process IR, URLs, or client configuration exposing
  WorkloadCell, shuffle-shard, or physical data placement.

Secret and deployment checks should reject:

- command credentials mounted into query processes;
- query network access to the primary where hard isolation is claimed;
- async lifecycle roles with broad domain mutation privileges;
- pool maxima whose sum consumes the reviewed command reserve;
- missing CPU, memory, in-flight, or connection hard limits named by the claim;
- simultaneous all-cell deployment where staggered cell isolation is required.

Load and fault-injection tests must prove the remaining behavioral claim. Static boundaries alone do
not prove CPU, memory, I/O, network, storage, or shared-control-plane isolation.

## Architecture Exceptions

An exception must include:

- affected packages;
- reason;
- risk;
- owner;
- expiration or removal condition;
- linked ADR when the exception changes architecture.

Permanent undocumented allowlists are forbidden.

## Required CI Checks

These are validation obligations, not a requirement to add a custom checker for each task. Reuse
existing checks and focused tests before extending enforcement; agent scope limits are defined in
[`AGENTS.md`](../../AGENTS.md#working-rules). Do not turn manual review into an automated approval
claim or expand unrelated gates to complete a bounded change.

The default branch must reject changes when any of these fail:

```text
Fallow generic graph, boundary, dead-code, and policy validation
ast-grep syntax policies and rule tests
RITSEI path-sensitive architecture and public-entry validation
schema-ownership and migration validation
Drizzle migration-graph validation
owner-domain and Effect-native HTTP tests
architecture tests
relative-link validation for documentation
workload-metadata and topology-leak validation when implemented
AI/provider import and mutation-boundary validation
```

## Suggested Repository Layout

```text
tooling/
├── ast-grep/
├── fallow/
├── architecture.ts
├── schema-ownership.ts
├── financial-gate.ts
└── focused operational scripts

tests/
└── architecture/

db/
└── ownership.toml
```

## Completion Criteria

Architecture enforcement is complete only when:

- every domain has a declared owner and public entry point;
- every PostgreSQL schema has one registered owner;
- forbidden imports fail locally and in CI;
- dependency cycles fail CI;
- cross-package imports resolve through public module contracts;
- architecture exceptions are explicit and reviewable;
- database privileges reinforce the same ownership model;
- query, async, and command composition roots cannot acquire one another's protected credentials;
- every published hard-isolation claim has executable overload evidence and explicit exclusions;
- AI/provider code has no private persistence or command-plane path, and every recommendation/action
  boundary has typed, authorization, redaction, idempotency, and reconciliation evidence before
  activation.
