# Frontend Architecture

> **Status:** Canonical and active, compacted to the rules that shape frontend code.
>
> **Owns:** frontend runtime shape, state ownership, routing, server state, contract validation, and
> presentation-layer constraints.
>
> **Related:** [`./design-system.md`](./design-system.md) · [`./authorization.md`](./authorization.md) ·
> [`./process-studio.md`](./process-studio.md) · [`../development/testing.md`](../development/testing.md) ·
> ADRs [0010](../decisions/0010-use-vite-solidjs-spa.md),
> [0024](../decisions/0024-adopt-effect-schema-as-canonical-contract-schema.md),
> [0048](../decisions/0048-define-effect-application-architecture-and-frontend-state-ownership.md),
> [0072](../decisions/0072-prefer-native-solid-reactivity-for-effect-integration.md),
> [0086](../decisions/0086-promote-solid-effect-bridge-to-production-boundary.md)

## Decision

The frontend is an API-first Vite and SolidJS 2.0 SPA, deployed separately from the backend, with a
router, TanStack Solid Query for selective server-state caching, Effect Schema contracts, an Effect
application model, and the RITSEI design system ([`design-system.md`](./design-system.md)).
Solid 2.0 moved server functions into the core, retired SolidStart, and has announced reactive Server
Components. None of that is adopted here today, and none of it is ruled out: adopt a server feature
when a concrete requirement needs it, and record it in an ADR. Whatever is adopted, the backend stays
the authority for authorization and domain state, and a server-side frontend layer is not a second
security boundary. The DOM owns semantics and interaction; no business value or action exists only in
pixels.

## Application architecture

Solid owns DOM projection and local ephemeral state, never business semantics or authorization. Effect
and Effect Schema are the application runtime and contract language; where a workflow needs explicit
coordination, use `Message → transition(Model, Message) → Command → result Message`. A browser Message
is not a backend domain event: a click requests a public command, and the owning domain authorizes and
commits the fact. Components never mutate authoritative state with local setters; they request the
command and render the result. The Solid 2 × Effect bridge is `apps/web/src/shared/solid-effect.ts`:
a Solid Context scopes one `ManagedRuntime` per active tenant session, disposal interrupts reads, and
actions keep typed failures and compensation.

| State | Owner |
|---|---|
| Authoritative domain state | Backend domain, PostgreSQL, or the ledger; the browser renders decoded projections |
| Workflow state | Effect Model and transitions |
| Remote server state | TanStack Solid Query; never mirrored into other stores |
| Presentation state | Solid signals, memos, stores, context |
| Shareable navigation state | Router plus Effect Schema |

## Boundaries

The browser must not connect directly to PostgreSQL, and no frontend code imports backend internals:
`apps/web` uses shared public contracts, features, infrastructure, and the public API, never repositories,
Drizzle tables, transaction services, backend-only Layers, or worker code. Everything entering the
frontend from an API, storage, plugin, import, or third party is untrusted and decoded through shared
Effect Schema contracts, including typed route search. Solid Router is the default; the route layer
parses input, invokes a feature query or command, and renders, with no business validation or
authorization.

## Server state, forms, and structure

Use Solid async composition for simple reads and TanStack Solid Query for cache-worthy state (lookups,
large filtered collections, shared details, multi-query invalidation). Query keys are deterministic,
tenant-aware, and built from validated input via `createServerQuery`; each connected route owns its query
client for the active tenant session. TanStack Solid Form sits behind RITSEI fields (`Form`,
`MoneyField`, `QuantityField`, `PartyField`, `FieldArray`) and owns no business invariant; client
validation never replaces server validation. Code is organized by capability under `apps/web/src/`
(`app/`, `routes/`, `features/<domain>/`, `shared/`, and shared UI in `ui/`). Components render state,
collect input, invoke commands, and show typed failures; accounting, pricing, authorization, transaction,
inventory, workflow-durability, and idempotency rules belong to the backend.

## Situation-oriented operational UI

RITSEI favors a role-aware, situation-oriented UI over a launcher with CRUD screens: the user sees what
needs attention and which authorized command can advance it. A situation is a frontend composition of
related objects, process state, evidence, and eligible commands, never a domain entity. The shell
composes stable landmarks with a route-selected capability and Product Pattern
([Design System §3](./design-system.md#3-shell-and-navigation)). Each module's
`apps/web/src/app/modules/<module>.workspace.ts` sidecar declares its navigation, and
`pnpm run ritsei gen` emits `routes.gen.ts` (ADR-0094); framework pages stay in `shell.tsx`. State that
must survive a deep link is typed router state; ephemeral selection stays in Solid.

### Frontend agent entry

Worth settling before building a screen: the domain and user task, the nearest Product Pattern
([Design System §2](./design-system.md#2-product-patterns)), which state is shareable, remote, or
ephemeral, and the command path and what the user sees after acting. Reuse the shell and patterns where
they fit; where they do not, build what the screen needs and say why in the change.

## Process Studio, authorization, and errors

Process Studio screens are features over public contracts that inherit the shell
([`process-studio.md`](./process-studio.md)); they do not hard-code domain capabilities or run process
semantics in the browser, and every drag action has a keyboard alternative. Hiding or disabling controls
from a permission summary is UX only: the backend repeats every check, hidden controls and route guards
are not security boundaries, and tenant switching invalidates tenant-scoped caches. Show a safe denial's
typed explanation, never provider tuples, policies, credentials, SQL, or object-existence signals.
Distinguish validation, 401, 403, safe 404, business and concurrency conflict, transport failure, and
defects rather than one generic toast, and treat a stale permission decision as unavailable, not allowed.

## Accessibility, performance, and testing

Core workflows have semantic HTML, keyboard navigation, visible focus, labels, accessible validation,
reduced-motion support, and text alternatives for visualizations
([Design System §7](./design-system.md#7-accessibility)). Optimize from measurements, with server-side
filtering and pagination and route-level splitting. Test with the smallest useful mix of unit, schema,
component, accessibility, integration, and end-to-end tests that assert visible behavior and public
contracts.
