# ADR-0114: Adopt Solid 2 Stable With a Bounded Kobalte Peer Risk

- Status: Accepted
- Date: 2026-11-19
- Amends: ADR-0074 (the peer-range risk may also be evaluated against Solid 2 stable)
- Compatible with: ADR-0009, ADR-0072, ADR-0086, ADR-0113
- Supersedes: ADR-0074's restriction of peer-range risk acceptance to Solid 2 release candidates only
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Frontend architecture: [`../architecture/frontend.md`](../architecture/frontend.md)
> - Kobalte wrapper evidence: [`../operations/frontend-implementation.md`](../operations/frontend-implementation.md)
> - Migration plan: [`../proposals/solidjs-2-stable-migration.md`](../proposals/solidjs-2-stable-migration.md)

## Context

Solid 2.0 is stable. The web application used Solid and its renderer at `2.0.0-rc.16`, the exact
peer version declared by `@kobalte/core@2.0.0-alpha.4` and `@kobalte/utils@2.0.0-alpha.1`.
Those published packages do not declare support for Solid `2.0.0`. The upstream Kobalte Solid 2
branch has widened its peer range in [commit `ba6b1df`](https://github.com/kobaltedev/kobalte/commit/ba6b1df04eeeb3e6cce050e9fce7004e1237bae8),
but that change is not in the published alpha and does not prove runtime compatibility.

ADR-0074 accepts a Kobalte peer mismatch only for a Solid 2 release candidate, with explicit risk,
build and browser evidence, and rollback. ADR-0113 makes the actual RITSEI wrappers the evidence
boundary. Moving to stable requires an explicit decision about this mismatch.

## Decision

Adopt Solid and `@solidjs/web` `2.0.0`, with the matching Solid compiler, Babel plugin, and signals
versions. Keep Kobalte `2.0.0-alpha.4` temporarily as **approved with risk** for the existing tested
RITSEI wrapper paths, despite the published peer mismatch. Do not claim upstream supports this pair.
Solid Query remains `6.0.0-rc.5` and Storybook retains its existing prerelease integration.

The exception is bounded by the production build and the application browser tests for dialog,
focus, keyboard, accessibility, menu, tabs, and affected workflows. A behavior or compatibility
failure blocks this pairing. Do not add a module alias, shim, or peer-warning suppression; check
for an upstream Kobalte release with a compatible peer range before the next pin change. New
Kobalte primitives still require their own wrapper and behavior/accessibility evidence as required
by ADR-0074 and ADR-0113.

If the stable pairing fails in validation or operation, roll back the Solid runtime, renderer,
compiler, signals, router and Vite plugin pins and their lockfiles together to the previous
RC.16-based revision. Do not downgrade authorization, accessibility, or tests to keep the upgrade.

## Validation and limitations

- `pnpm install --frozen-lockfile` and `pnpm --filter @ritsei/web run build` pass without a new
  release-age exception. `pnpm --filter @ritsei/web run storybook:build` passes.
- `pnpm run check:affected` passes its selected suite; PostgreSQL-dependent tests are skipped when
  the database is unavailable. Existing browser tests cover the sign-out dialog and workflows;
  Accounting additionally exercises the action menu with keyboard, and Process Studio exercises
  keyboard tabs and remounting its designer after navigation.
- `pnpm peers check` reports the Kobalte mismatch and existing Storybook peer mismatches. This is a
  disclosed risk, not an upstream support guarantee. The independent Solid–Effect experiment builds,
  but its pre-existing typecheck failure remains separately documented in the migration plan.
