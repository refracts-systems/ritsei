# ADR-0126: Decide Job Timing with the Database Clock

- Status: Accepted
- Date: 2026-11-22
- Amends: None
- Compatible with: ADR-0052, ADR-0053, ADR-0055
- Supersedes: None
- Superseded by: None
- Changes: `docs/architecture/durable-execution.md`

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Rule: [`../architecture/durable-execution.md`](../architecture/durable-execution.md) (job timing)
> - Fencing: [`./0052-separate-lease-capability-and-fencing-generation.md`](./0052-separate-lease-capability-and-fencing-generation.md)

## Context

Process jobs are leased to workers. A job is due when `scheduled_at` has passed and a lease is held
until `lease_until`. Both used to be compared with the clock of the host that ran the query. Hosts do
not share a clock: a host running ahead could take a lease another host still held, and one running
behind could miss a job that was due. Fencing (ADR-0052, ADR-0053) stops such a duplicate run from
corrupting data, but not from happening. The defect was reproduced with a host ten minutes ahead and
a host an hour behind before the fix.

## Decision

The database clock is the only time authority for job scheduling. Whether a job is due, whether a
lease has run out, and the new `lease_until` are decided in SQL with `now()`. A host clock never
decides any of them. Audit timestamps (`updated_at`, workflow `completed_at`, event `occurred_at`)
are not scheduling inputs and stay as they are.

A retry time, `retryAt`, is still an instant computed by the caller and stored as `scheduled_at`. A
host whose clock is off retries earlier or later by that offset. This is accepted for now: it
changes only when a retry runs, not who holds a lease, and fencing still protects the data.

## Alternatives Considered

- **Keep the host clock and add a skew margin to leases.** It narrows the window and cannot close it,
  and the margin has to be chosen for the worst host. Not selected.
- **Synchronize host clocks and rely on that.** Outside the application's control and unverifiable
  from a test. Not selected.
- **Make `retryAt` a delay in seconds and add it to `now()` in SQL.** It would remove the residual,
  but it changes the failure contract that callers use. It is the next step if retry timing is ever
  shown to matter, and needs its own change.

## Consequences

### Positive

- Which worker holds a lease no longer depends on host clocks.
- The rule is testable: a skewed host cannot take a held lease, and a host far behind still sees a
  due job.

### Negative

- Every claim, renewal, completion, and failure reads the database clock in SQL, so scheduling
  logic cannot be unit tested with a fake clock alone.

### Risks

- A new scheduling path that compares a host `Date` with a stored instant reintroduces the defect.
  `jobs.postgres.test.ts` covers the existing paths, not future ones.
- A caller with a wrong clock still shifts its own retries.

## Validation

`erp/modules/process/tests/jobs.postgres.test.ts`: a host ten minutes ahead cannot take a held lease,
and a host an hour behind still sees a due job.

## Related Documents

- [`../architecture/durable-execution.md`](../architecture/durable-execution.md)
- [`./0052-separate-lease-capability-and-fencing-generation.md`](./0052-separate-lease-capability-and-fencing-generation.md)
- [`./0053-clarify-per-job-lease-generation-invariants.md`](./0053-clarify-per-job-lease-generation-invariants.md)
