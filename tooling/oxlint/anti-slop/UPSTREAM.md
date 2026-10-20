# Vendored anti-slop

Source: [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop), commit
`13909c9e07590f5a85d93c62712259fe14a883f7` (2026-10-13), copied with the upstream
`skills/install-anti-slop/scripts/install.mjs` from the bundled assets. The generic plugin
(`index.ts`) and the opt-in Effect plugin (`effect/index.ts`) are unmodified copies; the
`vendor/eslint-stylistic` files keep their own `UPSTREAM.md` and `LICENSE`.

The files are owned by this repository: change them to match RITSEI's standards, and record each
change below. Dependency: `@oxlint/plugins` at the same exact version as `oxlint` (1.88.0).
Configuration lives in the root `.oxlintrc.json`; the directory is excluded from linting,
formatting, and Fallow because it keeps upstream's tab-indented style.

## Enabled rules

`oxc/no-accumulating-spread`, `anti-slop/no-array-filter-map`,
`anti-slop/no-reduce-accumulator-copy`, `anti-slop/no-conditional-empty-object-spread`,
`anti-slop/no-module-mocking`, `anti-slop/no-reflect-apply`, `anti-slop/no-unknown-type-aliases`,
`anti-slop/no-widen-then-assert`, and `anti-slop-effect/no-manual-effect-error-tag`.

## Rules left off, and why

Counts are approximate text matches over `apps`, `framework`, `erp`, `tests`, `tooling`, and `db`
when this copy was installed. Enable a rule only together with the cleanup it needs.

| Rule | Matches | Reason |
| --- | --- | --- |
| `no-unknown-parameters` | ~360 | Module services take `input: unknown` and decode it with Effect Schema at the boundary (`AGENTS.md`, default Effect feature shape); the rule targets the opposite pattern. |
| `no-unknown-returns` | 5 | Boundary canonicalizers and JSON readers return `unknown` before parsing. |
| `no-unsafe-dictionary-type` | ~30 | `Record<string, unknown>` marks untrusted payloads (events, evidence, responses). |
| `no-runtime-typeof` | ~50 | Frontend and platform adapters narrow untrusted values without a schema. |
| `no-reflect-get` | 1 | Required by the request-limits `Proxy` handler. |
| `no-object-parameters` | 1 | Response matching helper in `apps/web/src/shared/api.ts`. |
| `no-chained-type-assertions` | ~35 | `as unknown as` in test doubles; needs a typed fixture approach first. |
| `no-known-value-widening` | ~5 | Annotated `Record<string, T> = {...}` tables; convert to `satisfies` first. |
| `no-shape-in-symbol-names` | ~110 | Effect service interfaces are named `...ServiceShape` by repository convention. |
| `require-safety-comment-for-type-assertion` | ~2300 | Needs a repository-wide assertion cleanup. |
| `require-readable-spacing` | repo-wide | Formatting belongs to oxfmt; the rule would fight it. |
| `anti-slop-effect/no-manual-tag-comparison` | ~130 | Outcome unions (`{ _tag: "posted" }`) are matched by hand throughout. |
| `anti-slop-effect/no-manual-tagged-construction` | ~250 | The same outcome unions are built as literals. |
| `anti-slop-effect/no-service-constructor-imports` | ~125 | Layers and runtime composition import `make<Service>` constructors from module entry points by design. |
| `anti-slop-effect/prefer-effect-match` | unchecked | Not evaluated yet. |

## Verification status

At install time the Oxlint native binding was blocked on the installing machine by a Windows
Application Control policy, so the rules above could not be executed. The enabled set was chosen
from text matches only. Run `pnpm run lint` where the binding loads, and either fix or turn off any
rule that reports findings.
