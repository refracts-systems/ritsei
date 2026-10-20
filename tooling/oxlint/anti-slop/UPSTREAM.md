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
`anti-slop/no-reduce-accumulator-copy`, `anti-slop/no-known-value-widening`,
`anti-slop/no-module-mocking`, `anti-slop/no-object-parameters`, `anti-slop/no-reflect-apply`,
`anti-slop/no-reflect-get`, `anti-slop/no-unknown-type-aliases`,
`anti-slop/no-widen-then-assert`, `anti-slop-effect/no-manual-effect-error-tag`,
`anti-slop-effect/prefer-effect-match`, and `anti-slop/no-chained-type-assertions`.

`pnpm run lint` passes with this set. Fixes made when enabling it:

- `no-array-filter-map` (18 sites): chains became lazy `.values().filter().map().toArray()`
  pipelines (Node 24 and current browsers support iterator helpers).
- `no-known-value-widening` (8 sites): test captures use arrays instead of `{ value?: unknown }`
  holders, `targets` uses `satisfies`, `forbiddenLayers` is a `Map`, deep nesting is built by a
  typed helper, and `compareFinancialFactSnapshots` returns a named type.
- `no-object-parameters` (1 site): `responseMatches` is generic over the checked owner, so expected
  keys are typed against it.
- `prefer-effect-match` (13 sites): pure literal lookups became typed `Record<Union, T>` tables
  (a lookup is an accepted replacement for `Match`, so adding a union member is a type error);
  tagged outcomes use `Match.tag`; the action-to-effect choice in the process operator is a record
  of functions.
- `no-chained-type-assertions` (35 sites): test doubles go through `partial<T>()` in
  `tests/support/partial.ts`, the one place a double is asserted into its full type. The runtime
  `postgres.js` client reaches the version check through `asPostgresClient` (now in
  `framework/platform/postgres`, no longer private to migrations), which also dropped its own two
  casts. The experiment facade `solid-effect.ts` keeps a file-level disable with its reason.
- `no-reflect-get` (1 site): the `Proxy` default branch in `request-limits.ts` keeps
  `Reflect.get` with a justified `oxlint-disable-next-line`.

## Rules left off, and why

Counts are Oxlint findings when each rule was enabled alone. Enable a rule only together with the
cleanup it needs.

| Rule | Findings | Reason |
| --- | --- | --- |
| `no-unknown-parameters` | 668 | Module services take `input: unknown` and decode it with Effect Schema at the boundary (`AGENTS.md`, default Effect feature shape); the rule targets the opposite pattern. |
| `no-unknown-returns` | 73 | Boundary canonicalizers and JSON readers return `unknown` before parsing. |
| `no-unsafe-dictionary-type` | 26 | `Record<string, unknown>` marks untrusted payloads (events, evidence, responses). |
| `no-runtime-typeof` | 60 | Frontend and platform adapters narrow untrusted values without a schema. |
| `no-conditional-empty-object-spread` | 51 | `...(x === undefined ? {} : { x })` is how optional keys are omitted for `Schema.optionalKey`; assigning `undefined` is not equivalent. |
| `no-shape-in-symbol-names` | 110 | Effect service interfaces are named `...ServiceShape` by repository convention. |
| `require-safety-comment-for-type-assertion` | 429 | Needs a repository-wide assertion cleanup. |
| `require-readable-spacing` | 8468 | Formatting belongs to oxfmt; the autofix would rewrite most files and fight the formatter. |
| `anti-slop-effect/no-manual-tag-comparison` | 146 | Outcome unions (`{ _tag: "posted" }`) are matched by hand throughout. |
| `anti-slop-effect/no-manual-tagged-construction` | 182 | The same outcome unions are built as literals. |
| `anti-slop-effect/no-service-constructor-imports` | 109 | Layers and runtime composition import `make<Service>` constructors from module entry points by design. |
