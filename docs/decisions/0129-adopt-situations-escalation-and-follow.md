# ADR-0129: Adopt Situations, Working-Day Escalation, and Follow

- Status: Proposed
- Date: 2026-11-25
- Amends: None
- Compatible with: ADR-0004, ADR-0006, ADR-0126, ADR-0128
- Supersedes: None
- Superseded by: None
- Changes: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Events, jobs, and workflows: [`./0004-separate-events-jobs-and-workflows.md`](./0004-separate-events-jobs-and-workflows.md)
> - Job timing: [`./0126-decide-job-timing-with-the-database-clock.md`](./0126-decide-job-timing-with-the-database-clock.md)
> - Tiered approvals: [`./0128-adopt-tiered-approvals-and-delegation.md`](./0128-adopt-tiered-approvals-and-delegation.md)
> - Escalation policy as written: [`../proposals/kontainer-backend.md`](../proposals/kontainer-backend.md) (K4)
> - Durable execution: [`../architecture/durable-execution.md`](../architecture/durable-execution.md)

## Context

The mockup shows a list of things that need a person (an overdue receivable, a supplier bill that
does not match what was received, an approval nobody has taken), an owner on each, escalation up the
organization when nobody acts, a way to follow a flow without being allowed to act on it, and
assigning many items at once. Nothing in the backend does this. What exists:

- Data for three detections: receivables past due (Settlement aging by payment terms), supplier bills
  whose `matchedValue` differs from what was received (Billing), and approval requests still pending
  (Approvals).
- A job table with leases, `scheduled_at`, and idempotency keys (ADR-0004, ADR-0126). Its `job_type`
  is a closed list, there is no recurring schedule, and a job runs when due, not on a calendar.
- `process.workflow_runs`, a closed list of three workflow types with a status and a result. The
  checkpointed workflow engine (`pg_durable`) is not active, and the process engine is deferred.
- Messaging as an event outbox with once-only consumers. No per-user inbox exists, and Communication
  is memory-only.
- No working-day calendar and no query for who holds a capability.

The escalation policy of K4 is written and not built: an approval nobody takes in 2 working days goes
to the flow owner, 2 more to the supervisor, and a High situation escalates after 1 working day.

## Decision

1. **A new ERP module, `situations`, owns the record and its rules.** It reads other modules only
   through their public contracts and owns no business fact of theirs. A situation is
   `{ id, tenantId, legalEntityId, type, subjectType, subjectId, severity, ownerId | null,
   escalationLevel, detectedAt, resolvedAt | null }`. Severity is low, medium, or high. At most one
   open situation exists per `(tenant, type, subjectType, subjectId)` (a partial unique index); once
   resolved, the same subject detected again opens a new one. It is a projection of other modules'
   facts, never their authority: resolving the cause resolves it, and nothing is approved, paid, or
   corrected through it.
2. **Detection is a scheduled job, idempotent per `(type, subject)`.** One detector job per
   `(type, legalEntity)` reads the owner's data, opens situations that are missing, updates severity,
   and resolves those whose cause is gone, all by the database clock (ADR-0126). The job re-enqueues
   itself for the next run with an idempotency key made of type, legal entity, and window, so a
   retry or a second worker is a no-op. The first three detectors are:
   - **Receivable past due.** An open receivable past its due date by the payment terms of Settlement.
     Medium for 1 to 30 days, high beyond.
   - **Supplier bill differs from receipt.** A supplier bill whose billed value differs from its
     `matchedValue`. Medium; high when the difference needs an approval under ADR-0128.
   - **Approval waiting past its SLA.** A pending request older than 2 working days. Medium; high
     when the amount reaches the last step of its policy.
3. **A working-day calendar is needed, owned by `situations` for now.** Per legal entity: the weekdays
   that count, and a table of non-working dates. Adding working days is a pure function of that data,
   and a due time is stored as an instant. It moves to its own module when a second consumer (the
   helpdesk of G-13) is built, not before.
4. **Escalation is a workflow, one run per open situation, on the existing job table.** The run is a
   small state machine, `unassigned -> owner notified -> supervisor notified`, advanced by jobs
   scheduled at the working-day due time (2 working days for the first step, 2 more for the second, 1
   for a high situation). Taking the situation (assigning an owner, including oneself) stops it;
   resolving it stops it. Escalation notifies and raises `escalationLevel`; it never assigns or
   grants a right. The run state lives in a `situations` table, not in `workflow_runs`, whose type
   list is closed and Process-owned. It is not `pg_durable`.
5. **Roles map to capabilities, not job titles.** "Flow owner" is whoever holds
   `situations.flow.own`, "supervisor" whoever holds `situations.flow.supervise`. Resolving them needs
   a tenant-level "who holds capability X" read in Authorization, which this decision adds (tenant
   scope only; scoped grants stay with ADR-0128).
6. **Follow is a read-only subscription.** `(userId, flow | subject)` rows; following grants no right
   to act, and a user can follow only what they can read, checked when subscribing and again when a
   notification is delivered. A notification carries type, severity, and subject reference, nothing
   else, and goes into an in-app inbox table of `situations`, written by a Messaging consumer of
   `situations.situation.opened`, `.escalated`, and `.resolved` events. E-mail through Communication is
   not part of this decision.
7. **Bulk assignment is one command.** `assignSituations(ids, ownerId)` for up to 100 situations,
   all or nothing, idempotent when repeated, needing `situations.situation.assign`; the new owner must
   hold `situations.flow.own`. An owner can read and work the situation; acting on the underlying
   document still needs the capability that document asks for.
8. **Capabilities, deny by default:** `situations.situation.read`, `.assign`, `situations.flow.own`,
   `situations.flow.supervise`, `situations.calendar.configure`.

## Alternatives Considered

- **Extend `workflow_runs` and `process_jobs` type lists.** Rejected for now: both are Process's
  closed catalogs and the escalation is not an order process; it would couple Process to every flow.
- **Wait for `pg_durable`.** Possible, and the state machine above is shaped to move onto it; but no
  activation is scheduled and the escalation policy is already written.
- **Detect on read** (compute situations when listed). Rejected: no owner, no escalation clock, no
  history, and the list would cost a scan of three modules each time.
- **Event-driven detection** (open a situation when a document event arrives). Rejected as the only
  mechanism because "past due" and "past SLA" are the passing of time, not events; kept as a later
  optimization for the opening side.
- **Escalate by assigning.** Rejected: assigning is a person's decision and would silently move
  responsibility.

## Consequences

### Positive

- One list of what needs a person, with an owner, an age, and a defined escalation.
- Detectors are plain reads over owners' public contracts, and a fourth is one more detector.

### Negative

- A new module with five tables (situations, escalation runs, subscriptions, inbox, calendar days) and
  a recurring-job pattern the job table does not have today.
- The escalation workflow is a second, small workflow mechanism beside Process's, until the engine
  question is decided.

### Risks

- A detector that is wrong floods people. Mitigation: detectors only open, update, and resolve
  idempotently, and severity thresholds are constants in code and tests until a pilot shows they need
  configuration.
- Time is subtle: a due time computed on a holiday table that changes later. Mitigation: a stored due
  instant is recomputed only when the open run is advanced, never silently shifted.

## Open questions for the owner

1. **A second workflow mechanism.** AGENTS.md defers the process engine. Is a small escalation state
   machine on the job table acceptable as the "workflow" of your decision, with a path onto
   `pg_durable` later? If not, escalation waits for the engine and only detection and follow are built.
2. **The calendar.** Weekdays plus a holiday table per legal entity, entered by hand (no public
   holiday feed). Confirm, and say which weekdays count (Monday to Friday?).
3. **Thresholds.** 1 to 30 days medium and beyond high for receivables; 2 working days for approvals.
   Fixed in code at first, or configurable per tenant from the start?
4. **Holders read.** Adding "who holds capability X" (tenant level) to Authorization. Confirm.
5. **Notifications.** An in-app inbox only for now, no e-mail, because Communication is memory-only.
   Confirm.

## Validation

- Running a detector twice, or two at once, leaves one open situation per subject; resolving the cause
  resolves it; a new cause after resolution opens a new one.
- Escalation fires at the working-day due time across a weekend and a listed holiday, a high situation
  after one working day, and not after the situation is taken or resolved.
- Escalation never changes `ownerId`; bulk assignment is all or nothing and idempotent.
- A follower without read access gets nothing, and following grants no right to act.
- Notifications are written once per event per follower (a duplicate delivery changes nothing).
