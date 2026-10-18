# ADR-0087: Adopt Node.js LTS and pnpm as the Repository Toolchain

- Status: Accepted
- Date: 2026-10-18
- Amends: None
- Compatible with: ADR-0010 (Vite/SolidJS SPA), the Effect v4 HTTP API standard, and the platform boundaries established by the foundation/platform architecture documents
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Repository rules: [`../../AGENTS.md`](../../AGENTS.md)
> - Architecture overview: [`../architecture/overview.md`](../architecture/overview.md)

## Context

The repository previously ran its whole toolchain through Deno 2 (`deno.json` workspace
configuration, `deno task` orchestration, `deno fmt`/`deno lint`, `deno lock`, and the
`denoland/deno` runtime image). The platform owner requested a move to Node.js 24 LTS as
the runtime with pnpm 12.14.0 as the package manager, so that development, testing,
deployment, and dependency auditing all run on a single mainstream Node toolchain without
requiring the Deno CLI.

Effect v4 supplies runtime adapters for both platforms (`@effect/platform-deno` and
`@effect/platform-node`) behind the same `HttpApi`/`HttpRouter` contracts, so the HTTP
surface does not need to change shape.

## Decision

1. **Runtime:** Node.js LTS 24.x (minimum 24.22.0, declared in `package.json` engines).
2. **Package manager:** pnpm 12.14.0 (`packageManager` field). Workspace membership and
   `onlyBuiltDependencies` approvals move from `deno.json`/`deno.lock` into
   `pnpm-workspace.yaml` and `pnpm-lock.yaml`.
3. **HTTP adapter:** `@effect/platform-deno` (`DenoHttpServer`, `DenoRuntime`) becomes
   `@effect/platform-node` (`NodeHttpServer`, `NodeRuntime`) in the runtime entrypoints
   (`runtime/api/mod.ts`, `runtime/worker/mod.ts`, `runtime/auth/bootstrap.ts`). All
   `HttpApi`/`HttpApiBuilder`/lifecycle Effect v4 contracts stay unchanged; application
   code still must not import `node:http` directly.
4. **Script execution:** TypeScript entrypoints (runtime, tooling scripts) run through
   `tsx`; `import.meta.main` gating is replaced by the `isMain()` helper in
   `tooling/entrypoint.ts`.
5. **Formatting/linting:** `deno fmt --check` becomes `dprint check`/`dprint fmt`
   configured for the previous Deno style (double quotes, ASI, width 100). `deno lint`
   is retired; boundary enforcement keeps relying on `tsc` (formerly `deno check`),
   ast-grep boundary tests, and Fallow audits.
6. **Dependency replacements:** JDK-style `@std/*` (JSR) packages leave the dependency
   set; `@std/uuid/v7` is replaced by the `uuid` package (`v7`); `@std/path` usage is
   replaced by `node:path`.
7. **Packaging/deploy:** the entry compose services run `node:24-slim` images with
   pnpm commands; CI workflows use `actions/setup-node` + `pnpm/action-setup` instead
   of `denoland/setup-deno`.
8. **Lockfile transitive pins:** `deno.lock` pinned the Solid 2.0 ecosystem at a
   mutually compatible release-candidate pair (`solid-js`, `@solidjs/web`,
   `@solidjs/signals`, `@solidjs/compiler`, and `@solidjs/babel-plugin` all
   `2.0.0-rc.6`). pnpm would otherwise resolve the compiler and signals packages to
   newer candidates, whose dev-mode codegen expects exports that `@solidjs/web`
   `rc.6` does not provide (breaks every production web build). The exact-pin
   `overrides` in `pnpm-workspace.yaml` carry this baseline snapshot into the
   pnpm graph.

## Consequences

- `deno.json`, `deno.lock`, and per-package `deno.json` files are removed; all
  orchestration lives in `package.json` scripts (root and `apps/web`).
- Repository documentation and agent instructions are updated in the same change
  (AGENTS.md, README, CONTRIBUTING, `.env.example`, lefthook, `.vscode` settings).
- ESLint-equivalent lint parity for `deno lint` is left as follow-up work; type
  checking and boundary tooling remain the enforced gates.
- The reproducible Nix dev shell keeps `nodejs_24` + `pnpm_12` (Deno is removed); the
  exact pnpm version is pinned by the `packageManager` field.
