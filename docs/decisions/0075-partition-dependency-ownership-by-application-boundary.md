# ADR-0075: Partition Dependency Ownership by Application Boundary

- Status: Accepted
- Date: 2026-09-05
- Amends: ADR-0050 for dependency-manifest ownership
- Compatible with: ADR-0010, ADR-0057, ADR-0072, ADR-0074
- Supersedes: ADR-0050 for dependency-manifest ownership only
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Decision map: [`./decision-map.md`](./decision-map.md)
> - Canonical architecture: [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)
> - Frontend architecture: [`../architecture/frontend.md`](../architecture/frontend.md)
> - Deno workspaces: [`https://docs.deno.com/runtime/fundamentals/workspaces/`](https://docs.deno.com/runtime/fundamentals/workspaces/)
>
## Context

RITSEI is a Deno workspace with a modular-monolith backend and a separately owned
`apps/web` application. The root `package.json` currently mixes backend/runtime
packages, repository tooling, and frontend-only packages. That makes the application
boundary harder to understand and makes it unclear which package owns a dependency.

Deno supports workspace members that contain both `deno.json` and `package.json`.
Member-specific dependencies are resolved within the member, while root files and
repository-wide tooling continue to resolve from the root configuration. A single
`deno.lock` remains the reproducibility boundary.

## Decision

Dependency declarations follow the application boundary that owns their consumption:

- The root `package.json` contains repository-wide npm/JSR dependencies and tooling.
  This includes backend/runtime dependencies and packages consumed by root tests or
  tooling, even when a package is frontend-oriented.
- `apps/web/package.json` contains dependencies exclusively consumed by the web
  application, including Solid runtime packages, Solid Router, TanStack Solid Query,
  Kobalte, Panda CSS, and Storybook.
- `apps/web/package.json` keeps exact version pins for web-owned npm dependencies next to
  the application boundary. A root `catalog` is intentionally not introduced while there is
  only one workspace member consuming these packages; add one only when multiple members share
  a version invariant.
- `deno.lock` remains the single resolved dependency graph for the workspace.
- `apps/web/deno.json` continues to own frontend tasks and compiler/tool configuration.
- `modules/*` remains the modular-monolith domain boundary. Domain modules do not become
  npm or Deno workspace packages by default.
- The nested `apps/web/src/experiments/solid-effect/` project remains excluded reference
  material for ADR-0072. Removing or relocating it is a separate cleanup decision, not a
  consequence of this manifest split.

The current shared root dependencies intentionally remain at the root, including Effect,
Vite and the Solid Vite plugin used by repository compatibility tooling, TypeScript,
Vitest, Playwright/axe, Drizzle Kit, Fallow, Lefthook, and database/runtime packages.

## Alternatives Considered

### Keep every dependency in the root manifest

Rejected for the current workspace shape because it obscures application ownership and
makes the web boundary cognitively heavier than necessary.

### Create a package manifest for every domain module

Rejected. `modules/*` are internal semantic boundaries of one modular monolith, not
independently versioned libraries or workspace packages.

### Duplicate exact versions in root and web manifests

Rejected because duplicated version ownership drifts. Each dependency has one owning manifest;
web-only pins stay in `apps/web/package.json`.

### Add a root catalog for the current web-only dependencies

Rejected as premature indirection with one workspace consumer. A catalog becomes appropriate when
multiple workspace members must share a version invariant.

### Move every frontend-shaped package into `apps/web`

Rejected where root tests or tooling consume the package. Ownership follows actual
consumption, not package naming.

## Consequences

### Positive

- The web application manifest shows its runtime and development surface directly.
- Repository-wide tooling remains available from the root without hidden cross-boundary
  dependency resolution.
- Web dependency ownership and exact pins are visible in one application manifest.
- The single lockfile and workspace retain reproducible installation.

### Negative

- Contributors must know whether a dependency is consumed by the root or by `apps/web`.
- Root tests cannot silently rely on a member-only dependency; a shared test dependency
  must remain root or the test must move into the member boundary.
- `deno install` must be run after root or member manifest changes.

### Risks

- Tooling that assumes every binary is in the root `node_modules/.bin` may need a member-local
  path. Frontend tasks use the web member's local binary path where required.
- A future workspace member may need its own dependency owner or a shared catalog if it must
  preserve a version invariant with another member.

## Validation

The migration is valid only when all of the following pass:

- `deno install --frozen`;
- `deno task check`;
- `deno task --cwd apps/web build`;
- `deno task --cwd apps/web storybook:build`;
- `deno task test`;
- `deno task boundary:test`; and
- `deno task boundary:lint`.

## Related Documents

- [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)
- [`../architecture/frontend.md`](../architecture/frontend.md)
- [`./0050-use-package-json-for-deno-dependency-resolution.md`](./0050-use-package-json-for-deno-dependency-resolution.md)
- [`./0072-prefer-native-solid-reactivity-for-effect-integration.md`](./0072-prefer-native-solid-reactivity-for-effect-integration.md)
