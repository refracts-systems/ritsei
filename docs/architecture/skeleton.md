# RITSEI Skeleton Architecture

> **Status:** Canonical design target; runtime activation is implementation-gated
>
> **Owns:** Solid-native skeleton presentation, static skeleton geometry, artifact registry,
> build/runtime separation, loading-state semantics, and skeleton accessibility.
>
> **Related documents**
>
> - Frontend architecture: [`./frontend.md`](./frontend.md)
> - Design system: [`./design-system.md`](./design-system.md)
> - Native Solid 2 and Effect integration: [`../decisions/0072-prefer-native-solid-reactivity-for-effect-integration.md`](../decisions/0072-prefer-native-solid-reactivity-for-effect-integration.md)
> - Skeleton boundary decision: [`../decisions/0080-adopt-solid-native-boneyard-skeleton-boundary.md`](../decisions/0080-adopt-solid-native-boneyard-skeleton-boundary.md)
> - Upstream Solid adapter proposal: [`../proposals/boneyard-js-solid/README.md`](../proposals/boneyard-js-solid/README.md)
> - Motion system: [`../decisions/0078-adopt-ritsei-motion-system.md`](../decisions/0078-adopt-ritsei-motion-system.md)
> - Drag/drop activation gate: [`../decisions/0079-gate-dnd-kit-solid2-activation.md`](../decisions/0079-gate-dnd-kit-solid2-activation.md)
> - Documentation boundaries: [`../documentation-boundaries.md`](../documentation-boundaries.md)
>
## 1. Core decision

RITSEI uses a Solid-native `Skeleton` boundary backed by immutable Boneyard geometry artifacts.
Boneyard is a geometry extraction/build tool, not a UI framework, state store, service runtime, or
reactive layer.

The target dependency flow is:

```text
application feature
        |
        v
RITSEI-owned Skeleton boundary
        |
        v
Boneyard core geometry/artifact adapter
```

Product features must not import Boneyard directly. The current repository keeps the boundary inside
`apps/web/src/ui/`; a future published package may expose the same contract as
`@ritsei/ui/skeleton`.

The architecture is accepted as a design target. `boneyard-js` is not installed and the RITSEI Solid
adapter is not activated; the dependency is added in the same change as the adapter
([ADR-0113](../decisions/0113-retire-frontend-compatibility-probes-and-visual-contract-test.md)).

Validation of `boneyard-js@1.10.0` on September 6, 2026, before the probe was removed:

- the framework-neutral core API (`computeLayout`, `normalizeBone`, `renderBones`, and
  `snapshotBones`) bundles and runs;
- the Boneyard CLI captured a real marker page and wrote a responsive `.bones.json` plus registry;
- a core-only production bundle contained no React, `react-dom`, or Playwright code; and
- the published package exposes no `boneyard-js/solid` adapter, so RITSEI still owns the missing
  Solid-native component boundary.

## 2. Relationship to ADR-0072

This architecture directly implements [ADR-0072](../decisions/0072-prefer-native-solid-reactivity-for-effect-integration.md):

| ADR-0072 owner | Skeleton application |
|---|---|
| Solid reactive graph | `loading`, responsive width, derived bone selection, and local transition state |
| Solid ownership tree | component lifecycle, `ResizeObserver`, timers, animation cleanup, and disposal |
| Effect `ManagedRuntime` | services, dependency injection, typed operations, cancellation, and resource scope |
| TanStack Solid Query | remote cache, pending state, invalidation, refetch, and server snapshots |
| Boneyard | immutable geometry artifacts only |
| PandaCSS | semantic color, theme, layout styling, and visual recipes |
| RITSEI Motion | temporal behavior such as reveal, fade, and crossfade |
| RITSEI UI | semantics, accessibility, public component contract, and state composition |

A skeleton component must not create a second owner for a remote or service fact. Passing
`loading={query.isPending}` is a Solid projection of Query state, not a second loading store.
Skeleton must not receive `ManagedRuntime`, run Effect programs, access Query caches, or subscribe to
Boneyard state.

The allowed flow is:

```text
Effect service or TanStack Query
             |
             v
       Solid boundary
             |
       Solid signal/memo
             |
             v
          Skeleton
```

There is no Boneyard subscription or Effect stream in this chain.

## 3. Public Solid contract

The RITSEI UI boundary provides two components:

```text
Skeleton      explicit loading boundary around real content
SkeletonView  standalone skeleton, suitable for Solid 2 `Loading` fallbacks
```

The conceptual contract is:

```ts
type SkeletonProps = {
  name: SkeletonName
  loading: boolean
  children: JSX.Element
  fixture?: JSX.Element
  fallback?: JSX.Element
  animation?: "pulse" | "shimmer" | "solid"
  transition?: boolean | number
  select?: "container" | "viewport"
  class?: string
}
```

The public contract must not expose Boneyard's internal snapshot, registry, renderer, or browser
capture APIs. `SkeletonName` is generated from the RITSEI-owned registry so invalid artifact names
fail at type-check time. These are target contracts; no production `Skeleton` or `SkeletonView`
implementation is activated yet.

## 4. State and loading semantics

Skeleton visibility is derived:

```text
query.isPending + registered geometry -> skeleton visible
query.data exists + query.isFetching -> real content remains visible
success + empty -> empty state
error -> error state
```

Use initial pending state for the primary skeleton. Do not replace existing content with a skeleton
for background refetch. Do not use a skeleton for an empty or error state.

A local signal is allowed only for genuinely temporal state, such as a transition in progress or an
animation completion. Do not copy `loading`, active geometry, breakpoint selection, Query data, or
runtime state into another signal merely to synchronize it.

## 5. Boneyard geometry boundary

Boneyard runs during development/build capture:

```text
real Solid component
        |
        v
DOM with data-boneyard marker
        |
        v
Boneyard CLI / browser capture
        |
        v
immutable *.bones.json artifact
        |
        v
RITSEI typed registry
        |
        v
Solid Skeleton renderer
```

The registry is immutable application data. It must not be a Solid store, Effect `Ref`, Atom, Query
cache, or runtime subscription. Geometry is selected with a pure Solid computation from the registry
and the measured container width.

RITSEI defaults to container-based selection because ERP surfaces commonly live inside sidebars,
split panes, drawers, workspaces, and Process Studio panels. Viewport selection is an explicit
exception.

Recommended initial geometry breakpoints are 360, 768, 1280, and 1536 pixels. The exact artifact
schema remains private to the RITSEI adapter and may change without changing feature contracts.

## 6. Build/runtime separation

Build tooling may use Boneyard capture APIs such as `snapshotBones`, `computeLayout`, `renderBones`,
or `registerBones`. Those APIs must stay behind tooling or the RITSEI adapter boundary.

Production must not perform DOM extraction, Playwright capture, subtree geometry crawling, or
`getBoundingClientRect` traversal for artifact generation. Production loads committed artifacts,
resolves the active geometry, and renders Solid JSX.

A build-only browser flag or snapshot hook must not become part of the application runtime contract.
The production bundle must not include a React adapter, React runtime, Playwright browser bundle, or
Boneyard implementation details that are unnecessary for rendering committed artifacts. The RITSEI
adapter requires its own production bundle proof when it is added. Do not import `boneyard-js/vite` or the CLI from application code.

## 7. Styling, motion, and accessibility

Boneyard supplies geometry. PandaCSS supplies semantic styling, including skeleton base, highlight,
container, theme, and responsive visual tokens.

RITSEI Motion owns temporal behavior. Feature code uses the RITSEI Motion wrapper; it must not import
Motion or Boneyard animation APIs directly. Reduced-motion users receive a solid or otherwise quiet
state instead of forced shimmer, pulse, stagger, or spatial traversal.

The skeleton boundary must:

- expose `aria-busy` on the meaningful content container while loading;
- mark visual overlays and bones `aria-hidden="true"`;
- keep overlays `pointer-events: none`;
- preserve the content container's geometry without collapsing it through `display: none`; and
- avoid announcing individual bones to assistive technology.

Skeleton visibility is presentation state. It never represents authorization, domain success,
transaction completion, or workflow truth.

## 8. Effect, Query, and route integration

An Effect-backed operation resolves its runtime at the Solid integration boundary. The resulting
success, failure, or pending representation is projected into Solid before it reaches Skeleton.
Skeleton never receives a `ManagedRuntime` or a domain service.

TanStack Solid Query remains the owner of remote server state. Query results are not copied into
Effect Atom, a global Solid store, a Boneyard registry, or a second loading signal.

Route- or feature-scoped ManagedRuntime providers remain valid, but the Skeleton component stays
runtime-agnostic. Tenant configuration is resolved by the application boundary and reaches Skeleton
as semantic theme or motion policy values, never as a TenantService dependency.

## 9. React-free and dependency rules

RITSEI must not add `react`, `react-dom`, `preact/compat`, or `boneyard-js/react` for skeletons.
The intended core dependency is framework-neutral Boneyard core behind the RITSEI adapter. When the
adapter is added, `boneyard-js` starts as a development dependency because the package also ships
capture tooling with a Playwright dependency. Moving it into production dependencies requires a
measured adapter bundle and deployment-footprint decision.

Forbidden imports:

```text
feature -> boneyard-js
feature -> boneyard-js/react
domain  -> boneyard-js
runtime -> boneyard-js
Skeleton -> ManagedRuntime / domain service / Query client internals
```

Only the RITSEI skeleton adapter and build tooling may know the Boneyard core API.

## 10. Related interaction boundaries

Skeleton transition behavior follows [ADR-0078](../decisions/0078-adopt-ritsei-motion-system.md).
Drag/drop mechanics remain a separate interaction concern. The dnd-kit adapter is the target but is
`not_activated` under [ADR-0079](../decisions/0079-gate-dnd-kit-solid2-activation.md) until its
Solid 2 build, pointer/keyboard interaction, accessibility, and reduced-motion evidence passes.
Skeleton must not make DnD state or animation the source of business truth.

## 11. Validation gates

The implementation is ready for activation only when these checks pass:

Already validated:

- core API execution and core-only production bundle;
- generic CLI capture from a `data-boneyard` marker page; and
- absence of React and Playwright code in the core bundle.

Still pending:

- Solid typecheck and production build without React imports;
- `Skeleton` and `SkeletonView` loading, ready, empty, error, and background-refetch tests;
- responsive container resolution tests;
- `aria-busy`, `aria-hidden`, keyboard, contrast, zoom, and localization checks;
- reduced-motion behavior tests;
- build-time capture and typed registry validation;
- production bundle proof that extraction tooling is absent; and
- interruption, unmount, and long-session cleanup tests for transitions and `ResizeObserver`.

Until then, this document defines the boundary and does not claim that Boneyard capture or the
production Skeleton runtime is available.
