# SolidJS 2 Stable Migration Plan

> **Status:** Migration record; follow-up limitations and rollback remain below.
> **Scope:** Upgrade the web app and its Solid–Effect experiment from Solid 2 RC to stable.
> **Baseline:** `origin/main` at `5641e86`; registry and upstream checked on 2026-11-19.
> **Owners:** [`../architecture/frontend.md`](../architecture/frontend.md),
> [`../architecture/design-system.md`](../architecture/design-system.md), and
> [ADR-0074](../decisions/0074-switch-to-kobalte-for-solid2-accessible-primitives.md).

## Implementation status

This worktree uses `solid-js`, `@solidjs/web`, signals, compiler, and Babel plugin `2.0.0`,
router `2.0.0`, and the Vite plugin `3.0.0`. It retains Solid Query `6.0.0-rc.5`, whose peer range
includes stable Solid 2. The `2.0.0` pins pass the existing release-age policy without adding
exceptions; `2.0.1` is too recent for a frozen install under that policy at the time of the trial.
The production build, Storybook build, and affected suite pass. Kobalte's published peer mismatch
remains unresolved and is not hidden; [ADR-0114](../decisions/0114-adopt-solid-2-stable-with-bounded-kobalte-risk.md)
records a bounded risk decision for the tested wrapper paths.

## Starting point and evidence

The baseline web app uses `solid-js` and `@solidjs/web` `2.0.0-rc.16`,
`@solidjs/router` `2.0.0-next.41`, `@solidjs/vite-plugin` `3.0.0-next.51`,
`@tanstack/solid-query` `6.0.0-rc.5`, and `@kobalte/core` `2.0.0-alpha.4`.
The root workspace overrides the Solid signals, compiler, and Babel plugin to RC.16.
The Solid–Effect experiment has its own manifest, workspace settings, and lockfile.

[Solid 2.0 was released on 2026-11-17](https://github.com/solidjs/solid/releases/tag/solid-js%402.0.0).
At the time of this assessment, Solid, its web renderer, signals, compiler, and Babel plugin have
stable `2.0.1` releases; the official router has `2.0.0` and the official Vite plugin `3.0.1`.
These versions are candidates, not proof that the complete application works with them.
The local Solid and Solid Router references in `vendor/` are ignored by Git and checked out at the
installed stable tags. Runtime dependencies come from the package registry, not those clones.

## Compatibility gate

The published Kobalte `2.0.0-alpha.4` and its `@kobalte/utils` `2.0.0-alpha.1` declare both
`solid-js` and `@solidjs/web` as exactly `2.0.0-rc.16`. A Solid 2.0.1 installation therefore falls
outside their declared peer support. An isolated `pnpm install --lockfile-only
--strict-peer-dependencies --ignore-scripts` trial with stable Solid fails on those requirements.
Find an upstream release that supports Solid 2 stable before a future pin change. Do not silently
suppress the mismatch or add a `solid-js/web` alias or shim. ADR-0074 requires deliberate
compatibility/build validation, browser evidence, and rollback review; ADR-0114 extends the bounded
risk decision to the current tested stable pairing, without claiming upstream support.

`@tanstack/solid-query` `6.0.0-rc.6` declares support for Solid 2 stable but remains a prerelease;
check its behavior and current publication before selecting it. Check the Storybook adapter and
Vite/Storybook peer requirements independently. Do not assume that a package's `latest` tag
supports Solid 2: some ecosystem packages still target Solid 1.

The Solid–Effect experiment formerly declared `@effect/atom-solid` `4.0.0`, whose peer range is
`solid-js >=1.9.14 <2`. The experiment does not import that package: its Atom comparison uses
`effect/reactivity` and an existing local bridge. The trial removes the unused dependency and keeps
the comparison. Its frozen strict-peer install and build pass; typecheck fails at `checkout.tsx:95`
with the same `never` inference error reproduced on the RC.16 baseline. Do not mask that error or
claim the typecheck passed.

## Migration sequence and follow-up

1. Recheck the registry and upstream changelogs when starting implementation; identify compatible
   exact versions, especially Kobalte, and record any unresolved peer requirements.
2. Update the app's Solid runtime and renderer together in `apps/web/package.json`; align the
   compiler, signals, and Babel plugin in `pnpm-workspace.yaml`. Upgrade the official router,
   `@solidjs/vite-plugin`, Query, and Storybook adapter only to versions whose peer ranges and
   behavior are verified. Run `pnpm install` to regenerate the root lockfile.
3. Update `apps/web/src/experiments/solid-effect/package.json`, its workspace settings and its
   separate lockfile. Install and validate it independently; it is not a root pnpm workspace member.
4. Compare the installed RC.16 behavior to the stable source and changelog, then fix actual failures
   in routing, reactive props and stores, async/pending behavior, Solid–Effect ownership and cleanup,
   forms, dialogs, and query invalidation. Preserve existing public contracts and accessibility.
   The app already uses Solid 2, so do not blindly apply every Solid 1-to-2 migration instruction.
5. Update current frontend and design-system documentation where it describes the shipped RC or
   compatibility status. Preserve historical ADRs; use an ADR if the chosen architecture or the
   Kobalte decision itself needs to change.

## Exit checks and rollback

- Inspect `pnpm` peer warnings and the installed dependency graph for duplicate or incompatible Solid
  runtimes; record any remaining prerelease and its evidence.
- Run the repository validation in `AGENTS.md`, `pnpm run check:affected`,
  `pnpm --filter @ritsei/web run build`, and `pnpm --filter @ritsei/web run storybook:build`.
- Exercise existing frontend browser tests, including the Kobalte wrapper, keyboard/focus and
  accessibility, shell/navigation, Solid–Effect cancellation and cleanup, and critical ERP workflows.
  Use the existing tests and UI delivery gate; do not reinstate retired compatibility probes solely
  for this migration.
- Run the experiment's typecheck and build using its own lockfile. Record exact commands and results.
- If compatibility, behavior, or accessibility fails, retain the RC baseline and its lockfiles while
  investigating. Do not publish the upgrade as complete on typecheck alone.
