# Frontend Readiness Roadmap

> **Status:** Canonical roadmap subdocument, compacted. **Track ID:** `frontend`. **Owner:** `apps/web`
> and design-system owners. Detail lives in [`../architecture/frontend.md`](../architecture/frontend.md)
> and [`../architecture/design-system.md`](../architecture/design-system.md); index:
> [`./README.md`](./README.md).

The track delivers a separately deployable Vite and SolidJS SPA with typed boundaries, shared Product
Patterns, and one accessible representative workflow, keeping business authority in the backend.
Server functions and SSR are not part of this track but are not ruled out, and any renderer that is the
only representation of a critical value is out of scope.

| Stage | Outcome |
|---|---|
| F0 `frontend.shell` | A reproducible SPA with typed routing and no backend-implementation imports |
| F1 `frontend.application-boundaries` | Route input and API responses decoded through Effect Schema; loading, denial, conflict, and recovery states; no browser path mutates a domain fact |
| F2 `frontend.design-system` | Shared controls and patterns in `apps/web/src/ui/`; no vendor imports in features |
| F3 `frontend.accessibility-performance` | One workflow checked for keyboard, screen reader, contrast, reduced motion, zoom, bundle size, and latency (`apps/web/src/ui/accessibility.test.ts`) |

Each stage is checked by the tests in `tests/frontend/`. Imports of backend implementations,
browser-side business mutations, and critical-workflow keyboard or semantic-fallback failures stay at
`0`. Stop when browser state becomes a shadow domain model, vendor types escape the UI boundary,
accessibility is deferred, or a server-side feature is introduced without a concrete requirement and
an ADR.
