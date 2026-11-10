# ADR-0057: Define Layered TanStack Frontend Engine Boundaries

- Status: Accepted
- Date: 2026-08-26
- Amends: ADR-0010 only by clarifying frontend engine roles and adoption scope
- Compatible with: ADR-0009, ADR-0010, ADR-0048, ADR-0049, ADR-0056
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Frontend architecture: [`../architecture/frontend.md`](../architecture/frontend.md)
> - Design system architecture:
>   [`../architecture/design-system.md`](../architecture/design-system.md)
> - Vite and SolidJS SPA: [`./0010-use-vite-solidjs-spa.md`](./0010-use-vite-solidjs-spa.md)
> - Frontend state ownership:
>   [`./0048-define-effect-application-architecture-and-frontend-state-ownership.md`](./0048-define-effect-application-architecture-and-frontend-state-ownership.md)

## Context

RITSEI is an ERP frontend with large collections, complex forms, repeated lookups, cross-screen
server state, bulk operations, and long-lived interactive workspaces. SolidJS 2.0 supplies the
reactive language and async composition, but it does not need to own every cache, table model, form
engine, or pacing policy.

The TanStack family provides useful headless engines, but adopting the family as one
undifferentiated application framework would create state duplication and expose vendor APIs as
accidental RITSEI contracts. RITSEI needs a role for each engine and an explicit boundary between
business semantics, client state, server cache, and rendering mechanics.

## Decision

RITSEI uses TanStack modules selectively by problem. SolidJS remains the reactive presentation
runtime; Effect and Effect Schema remain the application and contract boundaries; backend domains
and the approved financial ledger remain authoritative.

```text
SolidJS 2.0
  -> local presentation state and async composition

TanStack Solid Query
  -> selective remote server-cache policy

TanStack Solid Table
  -> headless table behavior

TanStack Solid Virtual
  -> measured rendering-window optimization

TanStack Solid Form
  -> current default ERP form interaction engine

TanStack Solid Pacer
  -> optional client interaction pacing

TanStack Solid DB
  -> research-only normalized client projections
```

### Server-state cache

TanStack Solid Query is a caching layer, not the RITSEI data layer or domain model. Use it when the
application needs shared server snapshots, cache identity, staleness, invalidation, background
refresh, paginated collections, or mutation-driven refresh across views.

Simple route- or component-local asynchronous composition may use SolidJS 2.0 async primitives
without introducing a shared query cache. Query data must not be copied into unrelated signals,
application models, or client collections merely to make it reactive.

### Tables and virtualization

TanStack Solid Table is the core headless table model for structured ERP collections. It may own
sorting, filtering, grouping, selection, column behavior, expansion, and pagination state, but never
business policy or authorization.

TanStack Solid Virtual is core infrastructure for measured row, column, tree, timeline, feed, and
other large-list rendering. It only controls what is rendered in the DOM. It does not replace
server-side filtering, sorting, cursor pagination, or bounded/infinite loading.

Large collection flows should follow:

```text
server-side filter/sort/cursor pagination
        -> query cache or bounded client window
        -> table/list/tree model
        -> virtualized rendering
```

### Forms

TanStack Solid Form is the current default form engine for ERP workflows. It is used behind
RITSEI-owned form contracts and fields, not exposed as a domain or public API contract. Effect
Schema remains the canonical boundary schema; backend domains remain authoritative for business
validation, authorization, uniqueness, concurrency, and transaction invariants.

Formisch is not selected for the core implementation at this stage. Its schema-first model remains a
valid alternative to evaluate after SolidJS 2.0 compatibility, Effect Schema integration, and a
migration path for RITSEI field contracts are demonstrated.

### Pacing and client collections

TanStack Solid Pacer is optional utility infrastructure for debounce, throttle, queue, and batch
behavior around client interaction and request initiation. It must not own business retry,
idempotency, authorization, or transaction policy.

TanStack Solid DB is research-only. If evaluated, it may provide normalized client-side projections,
reactive reads, or safe optimistic interaction above server-backed data. It is never a source of
truth for sales, inventory, accounting, authorization, process, or financial state.

### Explicit non-defaults

- Solid signals, stores, memos, context, and the Effect application model remain the
  local/application state choices; TanStack Store is not a default second reactive core.
- Solid Router remains the default router; TanStack Solid Router is optional behind the existing
  routing abstraction.
- TanStack Start is not selected and does not alter the separate Vite SPA/backend boundary.
- TanStack Ranger is feature-specific and requires a proven range-control need.
- TanStack Devtools is development-only diagnostic tooling.

### RITSEI ownership boundary

Feature and domain code must not import TanStack APIs as business contracts. RITSEI-owned wrappers
and contracts should expose semantic capabilities such as:

```text
RitseiQuery
RitseiTable
RitseiVirtualList
RitseiForm
MoneyField
QuantityField
PartyField
LineArray
```

The wrappers own semantic formatting, accessibility, permission-aware presentation, stable identity,
error mapping, and migration boundaries. TanStack engines remain replaceable implementation details.

## Alternatives Considered

### Put every asynchronous read in Query

Rejected. SolidJS 2.0 can compose local asynchronous work without a shared cache, while Query is
valuable specifically where cache policy and cross-screen server-state reuse are needed.

### Build custom table, virtualizer, and form engines

Rejected for the initial implementation. These are complex, well-bounded infrastructure concerns;
RITSEI should own the semantic wrapper and contract rather than reimplement every engine.

### Use TanStack DB as the default client data model

Rejected. A client collection layer cannot become a second ERP authority. It may be evaluated later
for bounded, rebuildable projections and optimistic interaction.

### Use Formisch as the core form engine

Not selected now. The schema-first model is attractive, but core adoption waits for compatibility
and contract integration evidence. The RITSEI form boundary keeps this choice replaceable.

## Consequences

### Positive

- ERP-heavy table, form, and virtualization needs use mature headless engines without dictating
  visual language.
- SolidJS remains the single reactive presentation model instead of being combined with an unrelated
  global reactive store.
- Query cache policy is explicit and does not become domain state.
- Server-side data loading and client-side DOM virtualization remain correctly separated.
- RITSEI can evolve from TanStack Form to another engine without changing field contracts or visual
  grammar.

### Negative

- RITSEI must maintain wrappers and integration tests around several engines.
- Selective Query use requires teams to make an explicit cache-policy decision.
- Form and table abstractions add initial design-system work.
- TanStack DB remains unavailable as a production shortcut for relational client state.

### Risks

- A wrapper may accidentally expose vendor types or recreate a generic technical abstraction.
- Query cache snapshots may be mistaken for current authorization or authoritative business state.
- Virtualization may be used to hide an unbounded network response instead of fixing server queries.
- Pacer may be misused for business retry or idempotency.
- TanStack DB may drift into a second source of truth.

## Validation

Activation requires:

- no direct TanStack imports in backend, domain, projection, or public contract packages;
- RITSEI wrappers preserve semantic field, table, interaction, and accessibility contracts;
- query keys are validated, tenant-aware, scope-aware, and deterministic;
- large collections use server-side filtering, sorting, and bounded loading before virtualization;
- table and form behavior remains keyboard-accessible and permission-safe;
- command results and failures return through owning public backend contracts;
- Formisch remains replaceable unless a later decision proves a better SolidJS 2.0 and Effect Schema
  integration;
- TanStack DB experiments remain isolated from production authority and are rebuildable from backend
  facts or committed events.

## Related Documents

- [`../architecture/frontend.md`](../architecture/frontend.md)
- [`../architecture/design-system.md`](../architecture/design-system.md)
- [`./0010-use-vite-solidjs-spa.md`](./0010-use-vite-solidjs-spa.md)
- [`./0048-define-effect-application-architecture-and-frontend-state-ownership.md`](./0048-define-effect-application-architecture-and-frontend-state-ownership.md)
- [`./0056-adopt-ritsei-semantic-frontend-design-system.md`](./0056-adopt-ritsei-semantic-frontend-design-system.md)
