# ADR-0086: Promote the Solid 2 × Effect Bridge to the Production Boundary

- Status: Accepted
- Date: 2026-09-12
- Amends: ADR-0072 only by promoting its implementation boundary
- Compatible with: ADR-0057, ADR-0085
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Decision map: [`./decision-map.md`](./decision-map.md)
> - Frontend architecture: [`../architecture/frontend.md`](../architecture/frontend.md)
> - Native Solid 2 and Effect integration: [`./0072-prefer-native-solid-reactivity-for-effect-integration.md`](./0072-prefer-native-solid-reactivity-for-effect-integration.md)
> - Production bridge: [`apps/web/src/shared/solid-effect.ts`](../../apps/web/src/shared/solid-effect.ts)
> - Runnable evidence harness: [`apps/web/src/experiments/solid-effect/`](../../apps/web/src/experiments/solid-effect/)

## Context

ADR-0072 selected native Solid 2 reactivity and Solid Context as RITSEI's default Effect
integration. Its runnable implementation was intentionally kept under an experiment path while the
Solid 2 and Effect v4 APIs were still being validated.

The experiment now covers the required runtime, read, action, cancellation, and service-scope
shapes. Keeping the adapter only under an excluded experiment path would leave production code with
no canonical implementation and would encourage feature-local runtime wiring.

## Decision

RITSEI promotes the native Solid 2 × Effect bridge to the production frontend boundary.

1. [`apps/web/src/shared/solid-effect.ts`](../../apps/web/src/shared/solid-effect.ts) is the
   canonical implementation of `RuntimeContext`, `createRuntime`, `runEffect`, and `effectAction`.
2. The existing session-scoped `ManagedRuntime` is provided through both `ApiRuntime` and
   `RuntimeContext`; production code must not construct a second runtime for the same session.
3. The bridge fails fast when used without `RuntimeContext`. There is no implicit global or default
   runtime fallback for production code.
4. `runEffect` is the production read adapter for component-local asynchronous work that needs
   Effect services, typed failure, scope, or interruption. TanStack Solid Query remains the owner
   of shared remote server-state caching, invalidation, and mutation coordination.
5. `effectAction` is an explicit opt-in for coordinated UI workflows. It does not replace domain
   commands, authorization, server transactions, or Query's server-state ownership.
6. The experiment under `apps/web/src/experiments/solid-effect/` remains a runnable evidence harness
   and re-exports the production adapter. It is not a second implementation or a public feature
   contract.
7. Production evidence includes focused adapter tests, production typechecking/build validation,
   and browser evidence for any feature that adopts the read or action path.

This ADR promotes the implementation boundary; it does not require every feature to use the bridge.
Feature teams still choose the smallest owner that matches the state: Solid for presentation state,
TanStack Query for shared remote state, and Effect through this bridge for scoped application
behavior.

## Alternatives Considered

### Keep the bridge under the experiment path

Rejected. It leaves the production application without a canonical implementation and permits
feature-local copies of runtime and cancellation policy.

### Create a second production adapter

Rejected. Two Solid × Effect bridges would create competing cancellation, error, and lifecycle
semantics.

### Replace TanStack Query with `runEffect`

Rejected. Query owns cache identity, invalidation, stale policy, deduplication, and server-state
coordination. The Effect bridge is not a cache engine.

### Make Effect Atom the production default

Rejected by ADR-0072. Atom remains an explicit opt-in for a shared or portable Effect-native
reactive graph and must not become a second owner for Query or Solid state.

## Consequences

### Positive

- Production code and the runnable evidence use one adapter implementation.
- Runtime scope follows the existing session owner and is available through one Solid Context.
- Missing provider composition errors are detected immediately instead of falling through to a
  global runtime.
- Read and action lifecycle policy is testable at a stable application boundary.
- Query, Solid, and Effect retain distinct state ownership responsibilities.

### Negative

- The bridge is now part of the production frontend surface and must track pinned Solid 2 and
  Effect v4 APIs.
- Feature teams must provide a scoped runtime before using `runEffect` or `effectAction`.
- Browser evidence is still required for each consequential action workflow; unit tests cannot
  prove all Solid action scheduling behavior.

### Risks

- Solid 2 prerelease behavior may change; the adapter remains behind the shared frontend boundary.
- Reading `isPending` can delay superseded iterator closure in the current Solid implementation;
  callers must not claim eager cancellation for externally consequential work without a browser
  regression test.
- Runtime disposal and compensation ordering must be covered before using `effectAction` for a
  consequential workflow.
- A feature may still misuse the bridge as a cache or business authority; Query and backend domain
  ownership rules remain binding.

## Validation

The decision is considered implemented when:

- the production adapter is typechecked with the application's pinned dependencies;
- the existing session runtime is provided through `RuntimeContext` without duplication;
- missing providers fail fast;
- the adapter tests cover R-channel propagation, Layer cleanup, and awaited interruption;
- the experiment imports the production adapter rather than copying it; and
- browser evidence covers cancellation, typed failure, cleanup, and compensation before a
  consequential feature adopts `effectAction`.

## Related Documents

- [`../architecture/frontend.md`](../architecture/frontend.md)
- [`./0072-prefer-native-solid-reactivity-for-effect-integration.md`](./0072-prefer-native-solid-reactivity-for-effect-integration.md)
- [`./0057-define-layered-tanstack-frontend-engine-boundaries.md`](./0057-define-layered-tanstack-frontend-engine-boundaries.md)
- [`./0085-separate-tanstack-adapters-from-semantic-ui-contracts.md`](./0085-separate-tanstack-adapters-from-semantic-ui-contracts.md)
