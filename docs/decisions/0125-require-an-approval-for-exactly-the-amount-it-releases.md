# ADR-0125: Require an Approval for Exactly the Amount It Releases

- Status: Accepted
- Date: 2026-11-22
- Amends: ADR-0103 (what "covers the amount it was granted for" means)
- Compatible with: ADR-0103
- Supersedes: None
- Superseded by: None
- Changes: `erp/modules/procurement/RULES.md`

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Rule: [`../../erp/modules/procurement/RULES.md`](../../erp/modules/procurement/RULES.md) (`PRC-REL-1`)
> - Amended decision: [`./0103-adopt-threshold-approvals-with-separation-of-duties.md`](./0103-adopt-threshold-approvals-with-separation-of-duties.md)

## Context

ADR-0103 says an approval "covers the amount it was granted for; a larger amount needs a new
approval". That sentence can be read two ways: the approval is valid for any total up to the granted
amount ("at least the total"), or it is valid for exactly the amount that was requested.

Procurement implements both. `confirmPurchaseOrder` requires `granted.amount === total`.
`releasePurchaseOrder` first checks `granted.amount >= total` and then calls `confirmPurchaseOrder`,
so an approval above the total passes the first check and is refused by the second, with the request
status `approved`. A test pins that behavior on both paths. Today no command can produce an approval
that differs from the order total, because the commands submit the order total and a draft order
cannot change, so the two readings cannot yet give different answers in production.

## Decision

An approval authorizes exactly the amount it was requested for. A subject whose amount differs from
an approved request, in either direction, needs a new request. This keeps `confirmPurchaseOrder`
and `PRC-REL-1` as they are and settles the open question in `RULES.md` in favor of equality.

No code changes. The release check's `>=` is redundant behind `confirmPurchaseOrder` and is left
alone, because editing an authorization path for no change in outcome has a cost and no benefit.

## Alternatives Considered

- **Approval covers any total up to the granted amount.** This matches the more natural reading of
  ADR-0103 and avoids a second request when a total falls. It was not selected because it widens
  what an approver signed for: someone who approved 1,000 did not decide on 500, and a later edit
  path could use the larger number. A wider rule can be adopted later by an ADR that names who may
  reduce a total; narrowing it after use would be harder.
- **Leave the open question.** Rejected: two readings in one module is the drift ADR-0123 asks
  owners to remove.

## Consequences

### Positive

- One reading in code, rule, and test; deny by default is preserved.
- No migration and no behavior change.

### Negative

- A total that falls after approval needs a new approval. No command does this today.

### Risks

- A future editable draft would have to resubmit the approval request when the total changes; it
  must not reuse the approved one.

## Validation

`tests/approval-cover.postgres.test.ts` pins below, equal, and above the total on both
confirmation paths.

## Related Documents

- [`../../erp/modules/procurement/RULES.md`](../../erp/modules/procurement/RULES.md)
- [`./0103-adopt-threshold-approvals-with-separation-of-duties.md`](./0103-adopt-threshold-approvals-with-separation-of-duties.md)
