# Proposal: Anti-Slop Rules Deferred for Discussion

> **Status:** Decided and done 2026-10-20: the owner accepted the lean of every rule (section 8), and
> all six rules are enabled, each in the commit that cleaned it up. What each cleanup changed is in
> [`UPSTREAM.md`](../../tooling/oxlint/anti-slop/UPSTREAM.md).
>
> **Owns:** The reasoning for six vendored anti-slop rules that are installed but turned off, their
> measured findings, and the options for enabling each.
>
> **Does not own:** The vendored rule source or the enabled rule set, which are recorded in
> [`tooling/oxlint/anti-slop/UPSTREAM.md`](../../tooling/oxlint/anti-slop/UPSTREAM.md) and
> `.oxlintrc.json`.
>
> **Related documents**
>
> - Vendored plugin provenance: [`tooling/oxlint/anti-slop/UPSTREAM.md`](../../tooling/oxlint/anti-slop/UPSTREAM.md)
> - Agent rules: [`../../AGENTS.md`](../../AGENTS.md)

## 1. Why these six

Eleven anti-slop rules were enabled when this was written (seventeen now, with these six) and
`pnpm run lint` passes. Seven more stay off because they
conflict with a documented repository convention (services decode `input: unknown` with Schema;
`_tag` outcome unions; `...ServiceShape` names; oxfmt owns formatting). The six below are different:
they are not clearly wrong for this repository, they need a decision and a cleanup, and each cleanup
touches a different part of the code. Counts are Oxlint findings when the rule was run alone.

| Rule | Findings | Mostly in |
| --- | --- | --- |
| `require-safety-comment-for-type-assertion` | 429 | `erp/modules` (259), `erp/runtime` (46), `framework` (58); 329 in tests |
| `no-unknown-returns` | 73 | `apps/web` (55), `erp/modules` (11) |
| `no-runtime-typeof` | 60 | `apps/web` (17), `framework` (23), `erp/runtime` (9) |
| `no-chained-type-assertions` | 35 | `erp/runtime` (15), `framework/platform` (9); 24 in tests |
| `no-unsafe-dictionary-type` | 26 | `erp/modules` (9), `framework` (5), `apps/web` (6), `erp/runtime` (5) |
| `prefer-effect-match` | 13 | `erp/modules` (8), `apps/web` (4), `framework` (1) |

Suggested order, cheapest and most mechanical first: `prefer-effect-match`, `no-chained-type-assertions`,
`no-unsafe-dictionary-type`, `no-runtime-typeof`, `no-unknown-returns`, then
`require-safety-comment-for-type-assertion`. Enable each rule in the same commit as its cleanup.

## 2. `prefer-effect-match` (13)

**What it rejects:** chained literal ternaries over one value, in favor of `Match`.

**Why it is off:** the sites are small lookups, such as a status to a tone or a label, plus a few in
financial code. Some branches contain `yield*`, which a `Match` callback cannot do, and the web app
does not otherwise import `Match`.

**Options**

1. Convert the pure lookups to `Match` (or a `Record` lookup keyed by the literal union) and keep a
   narrow `oxlint-disable-next-line` with a reason for the branches that `yield*`.
2. Accept `Match` only in `erp/` and `framework/`, and exempt `apps/web` by an Oxlint `overrides`
   block.
3. Leave off permanently.

**Lean:** option 1 for the status and label lookups, where an exhaustive `Record<Status, Tone>` is
clearer than either form. **Decide:** is a typed `Record` lookup an acceptable replacement, even
though the rule names `Match`?

## 3. `no-chained-type-assertions` (35)

**What it rejects:** `x as unknown as T`, which fabricates evidence.

**Why it is off:** 24 of 35 are in tests that build partial service doubles; the rest are platform
adapters (Postgres client, request proxy) bridging driver types.

**Options**

1. Replace test doubles with typed fixtures or a small `partial<T>()` helper that centralizes the one
   unavoidable cast with a justification.
2. Keep chained assertions only inside a shared test-support module and enable the rule elsewhere.
3. Fix the platform adapters with narrow wrapper types and leave tests for later.

**Lean:** option 1; one documented cast helper is better than 35 anonymous ones. **Decide:** may
test support hold a single `as unknown as` helper?

## 4. `no-unsafe-dictionary-type` (26)

**What it rejects:** `Record<string, unknown>` and open dictionaries whose values are `unknown`,
`any`, or `object`.

**Why it is off:** several mark genuinely untrusted payloads (event payloads, verification evidence,
HTTP response bodies) before Schema decoding.

**Options**

1. Replace payload types with `Schema.Json` (or a named schema type) so the value is a parsed JSON
   shape, not `unknown`.
2. Keep `Record<string, unknown>` only for the explicitly untrusted boundary and tag those sites
   with a justified disable.
3. Convert the finite-key cases to `Record<Union, T>`.

**Lean:** 1 where Effect Schema already defines the payload, 2 for true boundaries. **Decide:** is a
justified disable acceptable at an untrusted boundary?

## 5. `no-runtime-typeof` (60)

**What it rejects:** ad hoc `typeof` narrowing, in favor of boundary parsing.

**Why it is off:** the web app and platform adapters narrow untrusted values (form values, storage,
env) without a schema. Upstream offers `allowInTypeGuards` for schema-free projects.

**Options**

1. Replace each site with `Schema.decodeUnknown*` or a shared `isString`-style predicate from
   `effect/Predicate`.
2. Enable with `{ "allowInTypeGuards": true }` and move remaining checks into named type guards.
3. Leave off for `apps/web` form handling only, through `overrides`.

**Lean:** option 2 first (cheap, keeps intent visible), then option 1 where a schema exists.
**Decide:** are `effect/Predicate` helpers considered "boundary parsing" for this rule's purpose?

## 6. `no-unknown-returns` (73)

**What it rejects:** explicit function return types that resolve to `unknown` or `Promise<unknown>`.

**Why it is off:** 55 findings are in `apps/web`, mostly `Promise<unknown>` reload callbacks
(`reload: () => Promise<unknown>`) and query helpers; the rest are JSON readers and canonicalizers
that return `unknown` before parsing.

**Options**

1. Return `Promise<void>` for fire-and-forget reload callbacks (most web findings).
2. Return a parsed type from the JSON readers (decode inside the reader) and keep `unknown` only in
   canonicalizers with a justified disable.
3. Leave off.

**Lean:** options 1 and 2; the web fixes are mechanical. **Decide:** may canonicalizers that hash or
redact arbitrary values return `unknown`?

## 7. `require-safety-comment-for-type-assertion` (429)

**What it requires:** every non-`const` `as` assertion carries a nearby `SAFETY` comment stating the
invariant that makes it valid.

**Why it is off:** 429 assertions, 329 of them in tests, so enabling it is a repository-wide sweep.
Many assertions (`as Foo["bar"]` on a value just decoded by Schema) are better removed than
commented.

**Options**

1. Enable for non-test source only (`overrides` excluding `**/*.test.ts` and `tests/**`), then
   remove or justify the ~100 production assertions.
2. Enable everywhere after the chained-assertion cleanup and a typed test-fixture helper shrink the
   test count.
3. Keep off and rely on review.

**Lean:** option 1, after `no-chained-type-assertions`. **Decide:** should tests be exempt, or must
every assertion carry its reason?

## 8. Decisions

| Rule | Decision |
| --- | --- |
| `prefer-effect-match` | Option 1. A typed `Record<Union, T>` lookup is an acceptable replacement for `Match`. Branches that `yield*` keep a narrow disable with a reason. |
| `no-chained-type-assertions` | Option 1. Test support may hold one `partial<T>()` helper with a single justified `as unknown as`; no other chained assertions. Platform adapters get a justified disable where a driver type cannot be bridged otherwise. |
| `no-unsafe-dictionary-type` | Options 1 and 2. `Schema.Json` or a named schema type where Schema already defines the payload; a justified disable at a true untrusted boundary; `Record<Union, T>` for finite keys. |
| `no-runtime-typeof` | Option 2 first (enabled with `allowInTypeGuards`; the exemption was later removed, so the rule now applies everywhere), remaining checks in named type guards, then `effect/Predicate` or Schema where one exists. |
| `no-unknown-returns` | Options 1 and 2. Reload callbacks return `Promise<void>`; JSON readers decode inside the reader; canonicalizers that hash or redact arbitrary values may return `unknown` with a justified disable. |
| `require-safety-comment-for-type-assertion` | Option 1. Enforced for non-test source only; tests are exempt by `overrides`. Production assertions are removed or given a `SAFETY` comment. |

Order of work follows section 1. Each rule and its cleanup land in one commit.

## 9. How to run the discussion

For each rule: decide which option above, record the answer here, then make the cleanup and the
`.oxlintrc.json` change in one commit and update the table in `UPSTREAM.md`. Do not enable a rule
with `warn` to defer cleanup: `pnpm run lint` runs with `--deny-warnings`.
