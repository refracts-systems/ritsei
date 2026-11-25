# ADR-0128: Adopt Tiered Approvals and Delegation

- Status: Accepted
- Date: 2026-11-25
- Amends: ADR-0103 (its consequence that multi-step chains and delegation stay out)
- Compatible with: ADR-0004, ADR-0006, ADR-0103, ADR-0125
- Supersedes: None
- Superseded by: None
- Changes: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Approvals today: [`./0103-adopt-threshold-approvals-with-separation-of-duties.md`](./0103-adopt-threshold-approvals-with-separation-of-duties.md), [`./0125-require-an-approval-for-exactly-the-amount-it-releases.md`](./0125-require-an-approval-for-exactly-the-amount-it-releases.md)
> - Parity plan, decision D10: [`../proposals/erp-module-parity-plan.md`](../proposals/erp-module-parity-plan.md)
> - Authorization (scope, delegated principal, SoD): [`../architecture/authorization.md`](../architecture/authorization.md)
> - Kontainer backend, K4: [`../proposals/kontainer-backend.md`](../proposals/kontainer-backend.md)

## Context

An approval policy today is one threshold per tenant and subject type with one approver capability
(`approvals.approval_policies`). A request has one decision. There is no second approver, no
amount band, no way to tell a person why they are the approver, and no way for an approver who is
away to hand the right to someone else. The mockup shows a chain of approvers and a "why this
approver" card, and decision D10 left rule shape, approver resolution, and delegation open.

Two rules must not move: separation of duties (the requester never decides, enforced in the service
and by a database check, ADR-0103) and the exact amount (an approval is valid for exactly the amount
requested, ADR-0125). Timers and escalation are not in this decision (they follow ADR-0004 in a
later one).

## Decision

1. **A policy is an ordered list of steps.** Each step has a number, an amount range, an
   `approverCapability`, and an optional scope (a legal entity, later a unit). The range is "above
   `above`, up to and including `upTo`" with `upTo` optional, so today's single threshold is one step
   with `above = threshold` and no `upTo`. A document passes through every step whose range contains
   its amount, in step order; ranges may overlap. No step contains the amount: no approval is
   required (`isRequired` stays a boolean with the same meaning).
2. **A request carries its steps, frozen when it is submitted.** The matching steps are copied onto
   the request (step number, capability, scope), so changing a policy never changes a request in
   flight. The request amount is fixed at submission and covers every step, so ADR-0125 holds per
   request and per step. Steps are decided in order: step n+1 is decidable only after step n is
   approved. A rejection at any step rejects the request. The request is approved when its last step
   is approved. Decisions are final.
3. **Who may decide a step is a holder of the step's capability in the document's scope.** The
   approver is resolved by the Authorization module, not by a name stored in the policy: roles map to
   capabilities, never to job titles. The API returns, for each step, the reason it is shown:
   `{ stepNumber, range matched, approverCapability, scope, candidates, decided }`. `candidates` are
   the users who could decide it now (holders, plus delegates in force); it is advice for display
   and never the authority, which is checked again at decision time.
4. **Delegation moves a capability for a date range.** A delegator gives one capability they hold to
   one other user from a start date to an end date (inclusive, evaluated in UTC like the other date
   rules). A delegation is created and revoked, never edited; both are audited with who, what,
   when, and why. It is not transitive (a delegate cannot delegate), the delegator keeps their own
   right, and it covers only the approval capability it names, not the rest of the delegator's grants.
   A decision made through a delegation records the delegate as the decider and the delegator as
   "on behalf of".
5. **Separation of duties holds at every step and through a delegation.** The requester cannot
   decide any step, directly or as a delegate, and a delegator who is the requester cannot act
   through a delegate. A delegation to oneself is refused. A delegation to the creator of a document
   cannot be known when it is made (it is per capability, not per document), so it is enforced when
   deciding: the document's requester is refused whatever route they came by. The database check
   `decided_by <> requested_by` is kept on each step.
6. **Existing data migrates to step 1.** Each policy becomes a one-step policy and each request a
   one-step request with its current decision. `submit`, `isRequired`, and `getForSubject` keep their
   names; `getForSubject` additionally returns the steps. Owners (Procurement, Billing) need no
   change except reading the request as approved only when all its steps are.

## Alternatives Considered

- **A chain of independent policies:** one policy per band, linked by the owner. Rejected: every
  owner would re-implement ordering and the "why" card.
- **Wait for the process engine:** rejected; it is deferred and an approval chain is a small state
  machine owned by Approvals (ADR-0103 alternative 2, unchanged).
- **Approver names in the policy:** rejected; they rot, and they defeat the capability model.
- **Delegation as a copy of the grant:** rejected; it would be indistinguishable from a real grant
  in audit and could outlive its dates.
- **One approver may decide several steps of one request:** not chosen (see Open questions).

## Consequences

### Positive

- Amount bands and a second signature need no new module and no change in the document owners.
- "Why this approver" has a defined answer that is always re-checked at decision time.
- Delegation is dated, narrow, and audited, so an absent approver stops blocking work.

### Negative

- Approvals grows from two tables to five (steps, request steps, delegations) and the request model
  gains a state per step.
- A step scope is stored but not enforced until Authorization has scoped grants (decision 1).

### Risks

- Overlapping ranges surprise administrators. Mitigation: show the matched steps for a sample amount
  when configuring.
- A delegate's authority is checked at decision time against the dates and the delegator's own grant;
  if the delegator loses the capability, the delegation stops working with it.

## Owner decisions (2026-11-25)

1. **Scope.** Steps ship at tenant level first. The optional scope column exists and is stored and
   returned, but it is not enforced until Authorization has legal-entity-scoped grants; a step with a
   scope is refused at configuration until then, so no policy silently looks narrower than it is.
2. **Distinct approvers.** One person cannot decide two steps of the same request, directly or through
   a delegation.
3. **Dates.** Whole days in UTC.
4. **Revocation.** The delegator, or a holder of `approvals.delegation.revoke`.

## Validation

- A request for an amount in two overlapping ranges gets two steps in order; the second cannot be
  decided first; a rejection at step 1 leaves step 2 undecidable.
- The requester is refused at every step, directly and through a delegation; a delegation to oneself
  is refused; a delegation outside its dates, revoked, or whose delegator lost the capability does
  not authorize.
- A policy edit after submission leaves the request's steps unchanged; an amount different from the
  request is not covered (ADR-0125 tests still pass unchanged).
- The "why" response lists each step with its capability, scope, and candidates, and the
  candidates are never trusted by `decide`.
- Migration: every existing policy and request reads as one step with its old decision.
