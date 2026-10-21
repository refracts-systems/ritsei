# Vendored anti-slop

Source: [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop), commit
`13909c9e07590f5a85d93c62712259fe14a883f7` (2026-10-13), copied with the upstream
`skills/install-anti-slop/scripts/install.mjs` from the bundled assets. The generic plugin
(`index.ts`) and the opt-in Effect plugin (`effect/index.ts`) are copies, except where a deviation is
recorded below (so far `effect/rules/no-service-constructor-imports.ts`); the
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
`anti-slop-effect/prefer-effect-match`, `anti-slop/no-chained-type-assertions`,
`anti-slop/no-unsafe-dictionary-type`, `anti-slop/no-runtime-typeof`, `anti-slop/no-unknown-returns`, and
`anti-slop/require-safety-comment-for-type-assertion` (everywhere, tests included), `anti-slop-effect/no-service-constructor-imports`, `anti-slop/no-shape-in-symbol-names`, `anti-slop/no-conditional-empty-object-spread`, `anti-slop/no-unknown-parameters`.

`pnpm run lint` passes with this set. Fixes made when enabling it:

- `no-array-filter-map` (18 sites): chains became lazy `.values().filter().map().toArray()`
  pipelines (Node 24 and current browsers support iterator helpers).
- `no-known-value-widening` (8 sites): test captures use arrays instead of `{ value?: unknown }`
  holders, `targets` uses `satisfies`, `forbiddenLayers` is a `Map`, deep nesting is built by a
  typed helper, and `compareFinancialFactSnapshots` returns a named type.
- `no-object-parameters` (1 site): `responseMatches` is generic over the checked owner, so expected
  keys are typed against it.
- `prefer-effect-match` (13 sites): literal lookups and outcome choices use `Match.value`/`Match.tag`
  (`Match.exhaustive` where the union is closed), including the process operator's choice of effect.
- `no-chained-type-assertions` (35 sites): test doubles go through `partial<T>()` in
  `tests/support/partial.ts`, the one place a double is asserted into its full type. The runtime
  `postgres.js` client reaches the version check through `asPostgresClient` (now in
  `framework/platform/postgres`, no longer private to migrations), which also dropped its own two
  casts. The `solid-effect` experiment (kept as a reference) re-exports the production bridge
  directly instead of narrowing it with casts.
- `no-unsafe-dictionary-type` (26 sites): JSON boundaries use `Schema.JsonObject` (OIDC token and
  key parsing, OpenAPI path items); form payload builders take the existing `FormValue`; helpers
  that only copy fields are generic over the caller's type; the P0 backfill rows are typed by their
  selected columns. Test SQL rows use the named row types in `tests/support/sql-row.ts`, and
  fixture overrides are `Overrides<Fixture>` (`tests/support/overrides.ts`).
- `no-runtime-typeof` (60 sites, no `allowInTypeGuards` exemption): checks
  became `effect/Predicate` guards (`isString`, `isNumber`, `isFunction`, `isObjectOrArray`);
  values already typed as `Schema.Json` branch on `Array.isArray` and scalar guards so the union
  stays narrowed; tests use `assert.isFunction`. The boneyard probe reports
  `snapshotIsFunction` instead of a `typeof` string, and the standalone `verify-r.mjs` script
  probes with `instanceof Function`.
- `no-unknown-returns` (73 sites): web reload and retry callbacks return `Promise<void>`, and
  producers wrap their refetches in `reloaded()` (`request-feedback.tsx`); the OIDC JSON reader
  decodes with `Schema.Json`; event payload callbacks return `Schema.Json`; postgres test helpers
  are generic over their result. `canonicalize` is one generic helper in `framework/foundation`,
  `redactExternalPayload` takes and returns `Schema.Json`, and `unwrapCause` became a loop.
- `require-safety-comment-for-type-assertion` (production source and tests; the test exemption was removed): where the type
  could be proven, the assertion went away (annotated empty arrays, `Predicate.hasProperty` for
  errno codes through `tooling/errno.ts`, `find` instead of a membership check plus cast, type
  predicates in `Array.find`, `Form` handing callers its `FormData`). The rest carry a `SAFETY:`
  comment naming the invariant: a database check constraint, a prior validation, or a module-owned
  writer. Tests gained `postgresCode`/`postgresConstraint` (`tests/support/postgres-error.ts`) in
  place of about 215 `as { code?: string }` casts, narrow with `assert.instanceOf`, and build
  doubles with `partial<T>()`; the rest carry a `SAFETY:` comment.
- `anti-slop-effect/no-service-constructor-imports` (109 sites): the vendored rule now skips test
  support, `tooling/`, and imports from the same directory (`./`), since a constructor imported
  from a sibling stays inside its owning module (a deviation from upstream, in
  `effect/rules/no-service-constructor-imports.ts`). Helpers and builders that were not service
  constructors lost the `make` prefix (`scopedCommand`, `moduleApi`, `apiErrorMapping`,
  `createDocumentSnapshot`, `financialLedgerLayer`, ...). The composition root in
  `erp/runtime/layers.ts` imports each module's `...Live` layer instead of rebuilding it from
  `make<Service>`; Accounting gained `AccountingServiceLive` and Process `ProcessJobEnqueuerLive`
  for that.
- `no-shape-in-symbol-names` (111 sites, 38 symbols): service interfaces exported as
  `...ServiceShape` are now `...ServiceContract`, store and input types follow the same suffix,
  `InvalidTokenShape` is `InvalidTokenFormat`, and `capabilityIdShape` is `capabilityIdPattern`.
  The module generator templates were updated with them.
- `no-conditional-empty-object-spread` (51 sites): optional keys are omitted through
  `omitUndefined`/`omitNullish` (`framework/foundation/optional`) in server code and
  `definedFields`/`presentFields` (`apps/web/src/shared/api.ts`) in the web app, so the
  `...(x === undefined ? {} : { x })` pattern is gone.
- `no-unknown-parameters` (668 sites, ADR-0105): service and port operations take the encoded type
  of the schema that decodes them, interfaces and implementations alike, and still decode at
  runtime. Stored JSON (`jsonb` columns, checkpoints, mapping files) is typed as JSON through the
  `json()` column helper and `Schema.Json`; error predicates and pass-through helpers are generic;
  capability parameters use the catalog `Capability` union. Tests that send invalid input build it
  with `partial<T>()(value)`. The migration ran module by module behind a shrinking `overrides`
  block, now removed.
- `no-reflect-get` (1 site): the `Proxy` default branch in `request-limits.ts` reads the wrapped
  request directly, with a `SAFETY:` comment.

## Rules left off, and why

Counts are Oxlint findings when each rule was enabled alone. Enable a rule only together with the
cleanup it needs.

| Rule | Findings | Reason |
| --- | --- | --- |
| `require-readable-spacing` | 8468 | Formatting belongs to oxfmt; the autofix would rewrite most files and fight the formatter. |
| `anti-slop-effect/no-manual-tag-comparison` | 146 | Outcome unions (`{ _tag: "posted" }`) are matched by hand throughout. |
| `anti-slop-effect/no-manual-tagged-construction` | 182 | The same outcome unions are built as literals. |
