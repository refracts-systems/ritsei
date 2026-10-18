---
name: cross-domain-and-transactions
description: "Use when one RITSEI domain needs a fact or operation owned by another, or when implementing balance, stock, journal, quota, idempotency-key, or multi-write mutations; also when choosing between a transaction, PgQue event, job table, or durable workflow."
---

# Purpose

Connect domains only through public contracts and implement mutations with the smallest durability
primitive that preserves ownership, atomicity, idempotency, and database invariants.

# Do Not Use When

- the behavior lives entirely inside one owner and is a plain single-row write with no concurrency risk;
- the operation is a pure query or local calculation;
- someone proposes an Effect fiber as durable execution.

# Cross-domain rules

- The owner stays the only mutation authority for its invariant. Consumers import the owner's
  `mod.ts` and call a typed service (or consume a committed event); never its `src/`, tables, or
  repositories. Sharing a PostgreSQL transaction does not transfer ownership.
- If the owner lacks the operation, add it via `add-capability` first.
- Keep translation at the consumer boundary; preserve the owner's tagged failures when callers can
  act on them. Internal calls stay local; no loopback HTTP. Keep the package graph acyclic.
- Process coordinators may hold coordination state but must not become a super-domain.
- There is no general reusable cross-domain transaction context yet. Use an existing
  transaction-aware service contract; if the task needs one that does not exist, report the missing
  paved road instead of importing tables.

# Choose the primitive (first that satisfies the semantics)

1. One atomic PostgreSQL transaction — synchronous invariant required before success.
2. Transactional PgQue event — committed fact with fan-out.
3. Job table — leased, scheduled, prioritized single-consumer work.
4. Approved checkpointed workflow (`pg_durable`) — only after its gates pass.

Never dual-write to PostgreSQL and an external broker; use an outbox written in the same transaction.
Consumers and retries are idempotent.

# Implementing a transactional mutation

- Trace all writes and callers. Identify the invariant owner, lock ordering, constraints, retry and
  duplicate behavior, and side effects.
- Use `DatabaseService.transaction` for owner-local multi-write changes. Authorization comes before
  the protected mutation; outbox/event publication is inside the same transaction.
- Prefer an atomic conditional update when "did not happen" is enough; lock-then-validate when the
  caller needs a precise state-dependent failure. An idempotency key is guaranteed by a unique
  constraint, not by a prior read. Strategy detail:
  [`change-schema/references/constraint-validation-strategy.md`](../change-schema/references/constraint-validation-strategy.md).
- Map specific constraint names to tagged domain errors.

# Validate

Test success, rollback after an intermediate failure, constraint failure, duplicate/idempotent
execution, and concurrency; add a real PostgreSQL test for guarantees an in-memory layer cannot prove.

```sh
pnpm run check:affected
pnpm run boundary:test
pnpm run boundary:lint
pnpm run db:check
pnpm run check
```

# Stop and report when

Ownership is ambiguous, lock ordering is undefined, retryable work lacks idempotency, the only path
is a cross-domain table write or external dual-write, or the required event/worker/transaction
infrastructure does not exist.

# Related

[`add-capability`](../add-capability/SKILL.md), [`change-schema`](../change-schema/SKILL.md).
References: ADR-0015, `docs/architecture/durable-execution.md`,
`docs/architecture/pgque-messaging.md`, `modules/inventory/src/service.ts`,
`modules/accounting/src/service.ts`.
