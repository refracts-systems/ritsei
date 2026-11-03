# ADR-0112: Stage Invoice Rendering Before Activation

- Status: Accepted
- Date: 2026-11-04
- Amends: None
- Compatible with: ADR-0091, ADR-0102, ADR-0110
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Rendering architecture: [`../architecture/document-rendering.md`](../architecture/document-rendering.md)
> - Durable execution: [`../architecture/durable-execution.md`](../architecture/durable-execution.md)
> - Follow-up: [`../proposals/erp-chains-next-steps.md`](../proposals/erp-chains-next-steps.md) (F2)

## Context

ADR-0110 requires a durable render job and immutable invoice artifact, but activates neither until
the rendering gates pass. The evaluation boundary also prohibits a new Process job type or migration.
The existing queue cannot claim a render job, so its worker, durable artifact writes and command
reserve cannot be measured as an integrated candidate before activation. Generic job tests and an
in-process renderer benchmark are useful evidence, but cannot prove that candidate.

## Decision

1. Permit a narrowly scoped invoice-render job, its required schema migration, a Billing-owned
   immutable artifact implementation and a dedicated candidate worker for **evaluation in disposable
   nonproduction databases**. A migration under development is not authorization to apply it to a
   production database.
2. Do not compose the candidate worker into production runtime, enqueue it from production invoice
   posting, expose a production artifact route, or send customer email until the applicable gates in
   the rendering architecture pass. Continue to provide the existing browser print sheet.
3. Evaluate the candidate through public owner contracts. Billing owns invoice snapshots, invoice
   identity and artifact access; Process owns job and lease state. The accepted artifact must bind
   the invoice, snapshot checksum, render fingerprint, versioned assets, renderer version and output
   checksum. Tenant scope and immutable one-artifact-per-issued-invoice constraints are enforced at
   the database boundary.
4. Completion and artifact acceptance must share one PostgreSQL transaction. The transaction verifies
   the current job lease and generation through the Process contract and fences the artifact write;
   a stale worker cannot publish or acknowledge an artifact. Replays return the committed artifact
   or an explicit conflict. Unknown commit outcomes are reconciled rather than overwritten.
5. Measure the actual candidate worker under bounded CPU, memory, concurrency and timeout settings,
   including crash recovery, queue behavior and the effect on normal commands. Document storage,
   retention, cleanup, monitoring, alerts, backup and manual recovery before production activation.
   An in-memory store or a simulated job type does not establish these guarantees.

## Alternatives Considered

- **Activate directly and measure afterward:** rejected because ADR-0110 requires gate evidence first.
- **Use an unrelated existing job type as a renderer surrogate:** rejected because its tests do not
  establish the candidate's job, artifact or isolation behavior.
- **Build a separate queue only for benchmarking:** rejected because it would measure a different
  execution path from the one selected for the ERP.

## Consequences

The repository may carry a reviewed migration and code that are exercised only against disposable
databases while evaluation proceeds. They must remain disconnected from production posting and
worker composition until activation. This decision does not declare a gate passed, select a
production retention duration, or relax authorization, fencing, idempotency or the activation gates.
If the candidate cannot be safely evaluated without production data or deployment, stop and record
the missing evidence instead of enabling it.

## Validation

Use real PostgreSQL integration tests for rollback, concurrent claims, stale-writer rejection,
idempotent replay, unknown-outcome reconciliation and tenant isolation. Benchmark renderer and
command workloads with documented resource limits on the intended deployment profile. Review the
migration graph, failure behavior, operational runbook and all eight gate results before activation.
