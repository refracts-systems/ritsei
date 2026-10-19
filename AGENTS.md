# AGENTS.md

Rules for coding agents working in the RITSEI repository. Keep this file short: it is loaded into
every session. Area-specific rules live in nested `AGENTS.md` files next to the code they govern;
subsystem rules live in the canonical architecture documents linked below.

> **Related documents**
>
> - Project overview: [`./README.md`](./README.md)
> - Architecture entrypoint: [`./ARCHITECTURE.md`](./ARCHITECTURE.md)
> - Canonical architecture: [`./docs/architecture/architecture-spec-v4.md`](./docs/architecture/architecture-spec-v4.md)
> - Architecture decisions: [`./docs/decisions/README.md`](./docs/decisions/README.md)
> - Documentation index and ownership: [`./docs/README.md`](./docs/README.md), [`./docs/documentation-boundaries.md`](./docs/documentation-boundaries.md)
> - Architecture enforcement: [`./docs/architecture/architecture-enforcement.md`](./docs/architecture/architecture-enforcement.md)
> - Testing strategy: [`./docs/development/testing.md`](./docs/development/testing.md)
> - Commit messages: [`./docs/development/commit-message-guidelines.md`](./docs/development/commit-message-guidelines.md)

## Source-of-Truth Order

When documents conflict, use this order:

1. Accepted ADRs that explicitly supersede earlier decisions.
2. `docs/architecture/architecture-spec-v4.md`.
3. Other canonical architecture documents.
4. Reference and exploration documents.

`ARCHITECTURE.md` is a summary entrypoint; it does not supersede the specification or accepted
ADRs. Do not silently resolve contradictions: report them and update the relevant source of truth.
Create a new ADR for significant decisions; supersede accepted ADRs instead of rewriting them.

## Working Rules

- Inspect existing code and tests before introducing a new pattern; preserve naming and directory
  conventions.
- Make the smallest change that fully solves the task. Avoid unrelated refactoring.
- Solve the requested outcome, not the surrounding roadmap. Reuse existing commands, tests, and
  harnesses; do not add evaluators, registries, generators, policy schemas, CI gates, or browser
  harnesses unless asked or an existing check demonstrably cannot validate a task-required invariant.
- Stop when the requested change and its relevant checks are complete. Report unrelated failures
  separately; do not repair inherited debt without authorization.
- Do not add dependencies without a documented reason. Declare each dependency in the manifest of the
  boundary that consumes it (root `package.json` for repository-wide and tooling packages,
  `apps/web/package.json` for web-only packages), with exact versions, then run `pnpm install`.
  `vendor/` is reference material, never a dependency source.
- Do not weaken typing, validation, constraints, authorization, audit, or tests.
- Do not convert all failures into generic `Error` values. Do not assume an Effect fiber is durable.
- Do not treat Drizzle as the domain model.
- Commits follow the [commit-message standard](./docs/development/commit-message-guidelines.md); do
  not rewrite shared history without approval.
- Before handing off, review the diff for speculative abstractions and scope creep.

## Skills

Before implementing a matching workflow, read the relevant `SKILL.md` under `.agents/skills/`.
Match developer intent to the descriptions; do not require the user to name a skill.

| Developer intent | Skill |
|---|---|
| Add a business capability end to end (contract, errors, service, store, API, authorization) | [`add-capability`](.agents/skills/add-capability/SKILL.md) |
| Add a new domain or schema owner | [`create-domain-module`](.agents/skills/create-domain-module/SKILL.md) |
| Change tables, constraints, triggers, RLS, or migrations | [`change-schema`](.agents/skills/change-schema/SKILL.md) |
| Cross-domain consumption, or stock/balance/journal/idempotent/multi-write invariants | [`cross-domain-and-transactions`](.agents/skills/cross-domain-and-transactions/SKILL.md) |
| Design or explain an Effect success/error/requirements flow | [`design-effect-program`](.agents/skills/design-effect-program/SKILL.md) |

Skills supplement, and never replace, repository ownership, tooling, and validation rules.

## Reference Sources

- **Effect v4:** consult the vendored source at `./vendor/effect` before writing or changing Effect
  code; do not rely on v3 memory. Use v4 names (`Effect.catch`, `Effect.catchCause`,
  `Effect.mapError`), never `catchAll`/`catchAllCause`.
- **Drizzle:** runtime `drizzle-orm` is pinned in the root `package.json`; the migration generator
  is pinned independently to Drizzle Kit `1.0.0-rc.4`. The vendored `vendor/drizzle-orm` is a
  `v1.0.0-rc.4` reference only. Revalidate the migration graph, typecheck, and integration tests
  before changing either pin.
- **Roles:** Effect owns lifecycle, typed failures, dependency injection, and transaction boundaries.
  Drizzle owns SQL construction and the typed persistence schema.

## Module Boundaries

A domain module exposes commands and queries, Effect service interfaces, public tagged errors, DTOs
through Effect Schema, and production/test `Layer` values. Tables, repositories, and internals stay
private.

- Import other domains only through their public entry points (`mod.ts`); never import their tables
  or repositories, and never mutate another module's tables. Cross-module work uses a typed service
  contract, including inside a shared PostgreSQL transaction.
- Keep the package graph acyclic and respect the schema ownership registry (`db/ownership.toml`).
  Do not bypass a failing boundary check with an undocumented allowlist.
- Domains must not import `celld`, Durable Object, fleet, bucket, ownership-protocol, PostgreSQL
  driver, or TigerBeetle APIs. The financial ledger depends on an engine-independent port; engine
  selection belongs in the current financial-ledger ADR.
- Add public contract tests for exported module behavior.

### Default Effect Feature Shape

```text
contract.ts -> errors.ts -> service.ts -> store.ts -> postgres.ts/memory.ts -> layers.ts -> handler
```

- `contract.ts`: public Effect Schema DTOs, service keys, operation contracts.
- `errors.ts`: public tagged business failures.
- `service.ts`: named `Effect.fn("Domain.operation")` workflows and orchestration.
- `store.ts`: private semantic persistence ports; `postgres.ts` is the Drizzle implementation;
  `memory.ts` exists when a deterministic test implementation can preserve the same invariants.
- `layers.ts`: named production/test composition; `mod.ts` exports only contract, errors,
  operations, and layers.
- `erp/runtime/api/api.ts` defines transport schemas and routes; `erp/runtime/api/handlers.ts` stays thin.
- Preserve tenant scope, authorization, tagged failures, transactions, idempotency, events, and
  financial/workflow authority. Add database constraints and invariant tests for every new mutable
  fact. Apply the shape to the new capability; do not refactor existing packages first.

### Identifier Policy

- New persistent entity, stored event, stored line, workflow, and other index-visible identities use
  UUIDv7. PostgreSQL-owned IDs use the `uuidv7()` default from `db/schema/common.ts`; application-
  created IDs use the foundation-owned `uuidv7()` helper. Never use `crypto.randomUUID()` for
  persistent identities or generated test UUID fixtures (UUIDv4 is valid only for opaque ephemeral
  lease tokens).
- A random lease token is not fencing. Stale-writer fencing needs a per-scope monotonic `BIGINT`
  generation enforced at the mutation boundary. Keep fencing generation and idempotency identity
  separate.
- `created_at` is the audit timestamp; business numbers are separate fields. Do not rewrite existing
  UUIDv4 rows solely to change their version.

### Failure Ownership and Translation

Keep failure types at the layer that owns and can act on them:

- Domain packages own business-policy errors, authorization errors, and input-validation failures.
- Foundation and platform services own stable technical failures such as `DatabaseFailure`.
- Composition roots own startup, configuration, deployment, and compatibility failures such as
  `UnsupportedPostgresVersion`.
- A domain may propagate a stable error from a public service contract, but must not import
  PostgreSQL, Drizzle, driver, migration, pool, or version-check error types.
- Map known constraint violations to tagged errors in the owning domain. Map all other database
  failures once at the platform boundary. Adding an infrastructure failure must not widen every
  domain failure union.
- Preserve causes for diagnostics, but never expose raw SQL, SQLSTATE, credentials, driver objects,
  or stack traces in public DTOs or API responses.
- Before adding an error to a domain contract, ask whether a domain caller can take a meaningful
  business action for it. If not, it belongs below or above the domain boundary.

```text
UserAccountAlreadyExists | DatabaseFailure | SchemaError       allowed
UserAccountAlreadyExists | UnsupportedPostgresVersion          forbidden
UserAccountAlreadyExists | PostgresError | DrizzleQueryError    forbidden
```

Add a contract or boundary regression test whenever a new error translation is introduced.

## Security

- Deny by default. Keep authentication separate from authorization.
- Model permissions as business capabilities, not only CRUD; make scopes explicit and tenant-aware.
- Use PostgreSQL RLS as defense in depth, not as the only policy engine.
- Never commit secrets or log credentials or sensitive data.
- Never accept arbitrary tenant SQL or arbitrary policy scripts.

## Framework and ERP

[ADR-0091](./docs/decisions/0091-adopt-framework-and-flagship-erp.md): RITSEI is an ERP framework
with a flagship ERP built on it like any third-party module.

```text
framework/     kernel: modules, data, auth, API, events, UI kit, CLI generator
erp/           RITSEI ERP: flagship business modules
extensions/    (later) modules from other developers and customers
```

- `framework/` never imports `erp/` or `extensions/`; `erp/` and `extensions/` use only public
  entry points. `tooling/architecture.ts` and Fallow zones enforce this. Framework:
  `framework/foundation/`, `framework/platform/`, and `framework/modules/` (auth, identity,
  authorization, messaging, integrations, catalog). ERP: `erp/modules/` (party, sales,
  procurement, inventory, accounting, billing, process, communication) and `erp/runtime/` (server,
  worker, and composition). `db/`, `apps/web/`, `tests/`, and `tooling/` stay at the root.
- Modules extend each other only through public contracts, events, and released extension points,
  never by patching another module's models, tables, or views.
- Extract, don't speculate: add a framework capability only together with an ERP module that uses
  it. Keep engine-neutral ports with exactly one used implementation.
- PostgreSQL does everything until a named user's measured need says otherwise; delete rather than
  gate capabilities that are off the roadmap. ADR-0092 and ADR-0093 keep TigerBeetle, workload
  isolation, the Stateful Entity Runtime, and the analytic plane as inactive target designs: no
  production path may depend on them until an activation ADR.
- The process engine is deferred until Order-to-Cash and Procure-to-Pay run end to end.

## Subsystem Rules

The linked document owns each subsystem's rules. Read it before changing that subsystem; do not
copy its rules into this file. Folder-specific rules live in `apps/web/AGENTS.md`, `db/AGENTS.md`,
and `erp/runtime/api/AGENTS.md`.

| Before changing | Read |
|---|---|
| Commands, events, outbox, jobs, consistency | [`state-and-consistency.md`](./docs/architecture/state-and-consistency.md) |
| Search | [`search-architecture.md`](./docs/architecture/search-architecture.md) (PostgreSQL only) |
| Connectors, OpenAPI imports, CloudEvents, OAuth, provider adapters | [`integration-architecture.md`](./docs/architecture/integration-architecture.md), ADR-0019 |
| Financial ledger, journals, balances | [`financial-ledger.md`](./docs/architecture/financial-ledger.md) |
| Frontend screens, shell, design system | [`frontend.md`](./docs/architecture/frontend.md), [`design-system.md`](./docs/architecture/design-system.md) |

Invariants that are easy to violate and expensive to find late:

- PostgreSQL is the source of truth for all business state, including the financial ledger. Use a
  direct transaction for synchronous invariants, the transactional outbox for committed facts, and a
  job table for leased single-consumer work. Do not dual-write to PostgreSQL and an external system.
- Search results are candidates, never authorization evidence or current business facts.
- External side effects need idempotency, timeout/retry policy, and explicit compensation or manual
  recovery. Provider types and credentials never appear in public contracts.
- Compensation is a new idempotent business command, never deletion of committed facts.

## Documentation

Read `docs/documentation-boundaries.md` before editing documentation, and link to the owning
document instead of duplicating its rules. Update documentation when you change public contracts,
module boundaries, data ownership, transaction or consistency models, asynchronous semantics,
authorization, deployment or configuration, or extension boundaries.

## Testing

- All TypeScript tests use `@effect/vitest`: import `assert`, `describe`, `it` only from it, never
  from `vitest`; no `Deno.test`.
- Use `it.effect` for Effect-returning tests (`it.live` only when live services are intended, plain
  `it` for pure synchronous tests). No `Effect.runPromise`/`runSync` and no `try`/`catch` around
  Effect execution; capture typed failures with `Effect.flip` or `Effect.result`.
- Use `assert` from `@effect/vitest`, not `expect` or manual `throw`.
- Acquire external resources with scoped constructors and release them in finalizers.
- Run worktree-local tests with `pnpm run check:affected`; reserve `pnpm run test` for the full
  suite and CI.
- Vendored subtrees and `node_modules` are excluded from tests, coverage, formatting, linting, type
  checking, and boundary scans.

## Validation

```sh
pnpm run fmt:check
pnpm run lint
pnpm run check
pnpm run check:affected
pnpm run boundary:test
pnpm run boundary:lint
pnpm run fallow:audit
```

`pnpm run fallow` and its focused variants are the generic dead-code, duplication, and health
checks; request `--format json --quiet` when parsing. Never apply `fallow fix` blindly to
Accounting, the financial ledger, Process Runtime, authorization, or migrations, and do not weaken
baselines or thresholds to get a green run.

Only the web app has a build (`pnpm --filter @ritsei/web run build`); report server build status as
unverified.

## Completion Report

Summarize what changed and why, the validation performed, documentation or ADR changes, and remaining
risks and assumptions.
