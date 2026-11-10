# ADR-0050: Use package.json for Deno dependency resolution

- Status: Accepted
- Date: 2026-08-25
- Amends: ADR-0017 dependency-resolution mechanism
- Compatible with: ADR-0017 native Effect Deno adapter
- Supersedes: ADR-0022
- Superseded by: ADR-0075 for dependency-manifest ownership; ADR-0087 for Deno resolution

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Canonical architecture: [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)
>
## Context

The repository now declares the published Effect Deno adapter and its peers in the root
`package.json`. Deno is configured with `preferPackageJson: true` and `nodeModulesDir: "auto"`,
so package exports resolve the application imports without a separate root import map.

The separate `import_map.json` duplicated package versions, retained raw source pins from the
period before `@effect/platform-deno` was published, and made dependency ownership harder to see.

## Decision

Delete the root `import_map.json` and remove `deno.json`'s `importMap` setting. Resolve all current
Deno imports through the root `package.json`, npm package exports, `node_modules`, and `deno.lock`.
Keep `deno.json` responsible for runtime, compiler, task, formatting, and lint configuration.

## Alternatives Considered

- Keep the separate import map: rejected because the published npm packages now provide the required
  Deno adapter entrypoints and package exports.
- Move every dependency into `deno.json`'s `imports`: rejected because it would duplicate the
  canonical versions already owned by `package.json`.
- Keep commit-pinned remote source aliases: rejected because they bypass the published dependency
  graph and retain the obsolete pre-publication workaround.

## Consequences

### Positive

- One dependency source of truth: `package.json` plus `deno.lock`.
- No raw Effect source URLs or duplicate import-map aliases.
- Deno, editors, Vitest, and npm consumers resolve the same published package graph.

### Negative

- Effect upgrades require updating the package manifest and lockfile together.
- A package must publish the required subpath exports before the application can consume it.

### Risks

- A future package export change can break a subpath import; `deno check .` remains the guard.

## Validation

- `deno check .`
- `deno install --dry-run`
- Repository boundary, formatting, lint, and affected-check tasks.

## Related Documents

- [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)
- [`./0017-use-effect-platform-deno.md`](./0017-use-effect-platform-deno.md)
- [`./0022-update-effect-v4-to-beta-103.md`](./0022-update-effect-v4-to-beta-103.md)
