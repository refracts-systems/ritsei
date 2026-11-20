# AGENTS.md

Rules for coding agents in the RITSEI repository. This file is loaded into every session, so it
holds only what an agent would get wrong and no check or skill catches. A rule a check enforces is
named once, with its check. Folder rules live in `apps/web/AGENTS.md`, `db/AGENTS.md`, and
`erp/runtime/api/AGENTS.md`; read the one for the folder you change.

> **Related documents:** [`README.md`](./README.md) · [`ARCHITECTURE.md`](./ARCHITECTURE.md) ·
> [spec](./docs/architecture/architecture-spec-v4.md) · [ADRs](./docs/decisions/README.md) ·
> [documentation boundaries](./docs/documentation-boundaries.md) ·
> [testing](./docs/development/testing.md) · [ERP handoff](./docs/proposals/erp-handoff.md) ·
> [commit messages](./docs/development/commit-message-guidelines.md)

## Source-of-Truth Order

When documents conflict, use this order:

1. Accepted ADRs that explicitly supersede earlier decisions.
2. `docs/architecture/architecture-spec-v4.md`.
3. Other canonical architecture documents.
4. Reference and exploration documents.

`ARCHITECTURE.md` is a summary. Do not silently resolve contradictions: report them and update the
source of truth. Create an ADR for a significant decision; supersede accepted ADRs instead of
rewriting them. Superseded ADRs are in `docs/decisions/archive/`; search current ADRs with
`rg -g '!docs/decisions/archive/**' <pattern> docs/decisions`.

## Working Rules

- Inspect existing code and tests before introducing a pattern; preserve naming and layout.
- Solve the requested outcome completely with the smallest change, not the surrounding roadmap.
  Reuse existing commands, tests, and harnesses; do not add evaluators, registries, generators,
  policy schemas, CI gates, or browser harnesses unless asked or an existing check demonstrably
  cannot validate a task-required invariant.
- Never pass over a defect in silence. Fix it in the same change if the file is already changed, the
  fix is a few lines, and a check covers it; otherwise report it with file, line, and how it fails.
  Unrelated refactoring and larger inherited debt need authorization.
- Add a dependency only with a documented reason, in the manifest of the boundary that consumes it
  (root `package.json` or `apps/web/package.json`), with an exact version, then run `pnpm install`.
  `vendor/` is reference material, never a dependency source.
- Do not weaken typing, validation, constraints, authorization, audit, or tests. Do not convert
  failures into generic `Error` values. Do not assume an Effect fiber is durable. Drizzle is not the
  domain model.
- Commits follow the commit-message standard; do not rewrite shared history without approval.
- Before handing off, review the diff for speculative abstractions and scope creep.

## Skills

Before implementing a matching workflow, read its `SKILL.md` under `.agents/skills/`; match intent
to the descriptions without waiting for the user to name a skill.

| Developer intent | Skill |
|---|---|
| Add a business capability end to end (contract, errors, service, store, API, authorization) | [`add-capability`](.agents/skills/add-capability/SKILL.md) |
| Add a new domain or schema owner | [`create-domain-module`](.agents/skills/create-domain-module/SKILL.md) |
| Change tables, constraints, triggers, RLS, or migrations | [`change-schema`](.agents/skills/change-schema/SKILL.md) |
| Cross-domain consumption, or stock/balance/journal/idempotent/multi-write invariants | [`cross-domain-and-transactions`](.agents/skills/cross-domain-and-transactions/SKILL.md) |
| Design or explain an Effect success/error/requirements flow | [`design-effect-program`](.agents/skills/design-effect-program/SKILL.md) |
| Deliver a web screen, route, or UI component change in `apps/web` | [`ui-delivery-gate`](.agents/skills/ui-delivery-gate/SKILL.md) |

## Reference Sources

- **Effect v4:** consult `vendor/effect` before writing Effect code; do not rely on v3 memory.
  `fallow:audit` rejects v3 names (`tooling/fallow/rules/ritsei-static-policy.json`). Effect owns
  lifecycle, typed failures, dependency injection, and transaction boundaries.
- **Solid:** consult `vendor/solidjs` and `vendor/solid-router` (rules in `apps/web/AGENTS.md`).
- **Drizzle:** owns SQL construction and the typed persistence schema; pins in `db/AGENTS.md`.

## Module Boundaries

A module exposes commands, queries, Effect services, public tagged errors, Effect Schema DTOs, and
`Layer` values through `mod.ts`; tables, repositories, and internals stay private. `boundary:lint`
enforces entry points, layer direction, framework-never-imports-erp, and `db/ownership.toml`; do not
bypass it with an undocumented allowlist. `tests/architecture/modules.test.ts` and the codegen test
fail when a manifest, the code, or a generated file disagree; run `pnpm run ritsei gen` after
changing a manifest or an ADR header, and never edit `*.gen.ts` files or the ADR index by hand.

- Never mutate another module's tables. Cross-module work uses a typed service contract, even inside
  a shared PostgreSQL transaction. Modules extend each other only through public contracts, events,
  and released extension points.
- Domains must not import `celld`, Durable Object, fleet, bucket, ownership-protocol, PostgreSQL
  driver, or TigerBeetle APIs; the ledger depends on an engine-independent port.
- The contract, the tagged errors, and the authorization check are never optional. The default file
  shape and when to skip parts of it are in the `add-capability` skill. Preserve tenant scope,
  idempotency, events, and financial and workflow authority; add database constraints and invariant
  tests for every new mutable fact.

### Identifier Policy

- New persistent, event, line, and workflow identities use UUIDv7: PostgreSQL defaults use
  `uuidv7()` from `db/schema/common.ts`, application code the foundation `uuidv7()` helper.
  `boundary:lint` rejects `crypto.randomUUID()`; UUIDv4 is only for opaque ephemeral lease tokens.
- A lease token is not fencing: stale-writer fencing needs a per-scope monotonic `BIGINT` generation
  at the mutation boundary, kept separate from idempotency identity.
- `created_at` is the audit timestamp; business numbers are separate. Do not rewrite UUIDv4 rows.

### Failure Ownership and Translation

Domains own business, authorization, and input-validation errors; foundation and platform own stable
technical failures such as `DatabaseFailure`; composition roots own startup and compatibility
failures such as `UnsupportedPostgresVersion`. A domain must not import PostgreSQL, Drizzle, driver,
migration, or pool error types: map known constraint violations to tagged errors in the owning
domain and all other database failures once at the platform boundary. Never expose SQL, SQLSTATE,
credentials, driver objects, or stack traces in public DTOs or responses. Add an error to a domain
contract only if a caller can act on it, and add a regression test for each new translation. Worked
examples are in the `design-effect-program` skill.

## Security

Deny by default; keep authentication separate from authorization. Permissions are business
capabilities, not only CRUD, with explicit tenant-aware scopes. RLS is defense in depth, not the
policy engine. Never commit secrets, log credentials, or accept tenant SQL or policy scripts.

## Framework and ERP

RITSEI is an ERP framework (`framework/`) with a flagship ERP (`erp/`) built on it like any
third-party module ([ADR-0091](./docs/decisions/0091-adopt-framework-and-flagship-erp.md)).

- Extract, don't speculate: add a framework capability only with an ERP module that uses it. Keep
  engine-neutral ports with exactly one used implementation.
- PostgreSQL does everything until a named user's measured need says otherwise; delete rather than
  gate capabilities that are off the roadmap. The TigerBeetle cutover code in Accounting stays.
  ADR-0092 and ADR-0093 keep TigerBeetle, workload isolation, the Stateful Entity Runtime, and the
  analytic plane as inactive target designs; their documents are in `docs/architecture/target/`. Do
  not read them as current rules or implement them, and no production path may depend on them until
  an activation ADR. The process engine is deferred until Order-to-Cash and Procure-to-Pay run end
  to end.

## Subsystem Rules

Read the owning document before changing a subsystem; do not copy its rules here.

| Before changing | Read |
|---|---|
| Commands, events, outbox, jobs, consistency | [`state-and-consistency.md`](./docs/architecture/state-and-consistency.md) |
| Search | [`search-architecture.md`](./docs/architecture/search-architecture.md) (PostgreSQL only) |
| Connectors, OpenAPI imports, CloudEvents, OAuth, provider adapters | [`integration-architecture.md`](./docs/architecture/integration-architecture.md), ADR-0019 |
| Financial ledger, journals, balances | [`financial-ledger.md`](./docs/architecture/financial-ledger.md) |
| Frontend screens, shell, design system | [`frontend.md`](./docs/architecture/frontend.md), [`design-system.md`](./docs/architecture/design-system.md) |

PostgreSQL is the source of truth for all business state, including the ledger: a direct transaction
for synchronous invariants, the outbox for committed facts, a job table for leased work, and no
dual-write to an external system. Search results are candidates, never authorization evidence.
External side effects need idempotency, timeout and retry policy, and compensation or manual
recovery; provider types and credentials stay out of public contracts. Compensation is a new
idempotent command, never deletion of committed facts.

## Documentation

Read `docs/documentation-boundaries.md` before editing documentation and link to the owning document
instead of duplicating it. Update documentation when you change public contracts, module boundaries,
data ownership, consistency, asynchronous semantics, authorization, deployment, or extension points.

## Testing

`fallow:audit` enforces `@effect/vitest` and rejects `vitest` imports and
`Effect.runPromise`/`runSync` in tests. Use `it.effect` for Effects (`it.live` only for live
services, plain `it` for pure code), capture typed failures with `Effect.flip` or `Effect.result`
(no `try`/`catch`), and assert with `assert`, not `expect`. Acquire external resources with scoped
constructors. Test behavior and invariants, not constants or baselines
([`testing.md`](./docs/development/testing.md)). Run `pnpm run check:affected` locally; `pnpm run
test` is the full suite.

## Validation

```sh
pnpm run fmt:check && pnpm run lint && pnpm run check && pnpm run check:affected
pnpm run boundary:test && pnpm run boundary:lint && pnpm run fallow:audit
```

Never apply `fallow fix` blindly to Accounting, the ledger, Process Runtime, authorization, or
migrations, and do not weaken baselines or thresholds. Only the web app has a build
(`pnpm --filter @ritsei/web run build`); report server build status as unverified.

## Completion Report

Summarize what changed and why, validation performed, documentation or ADR changes, defects found
outside the task (fixed or left), and remaining risks and assumptions.
