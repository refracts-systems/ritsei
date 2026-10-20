# ADR-0103: Adopt Threshold Approvals with Separation of Duties

- Status: Proposed
- Date: 2026-10-20
- Amends: None
- Compatible with: ADR-0006, ADR-0031, ADR-0091
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - ERP parity plan, decision D10: [`../proposals/erp-module-parity-plan.md`](../proposals/erp-module-parity-plan.md)
> - Authorization: [`../architecture/authorization.md`](../architecture/authorization.md)

## Context

Purchase orders above a threshold and supplier bills that exceed received quantities need a second
person's approval. Authorization has capabilities and separation-of-duties primitives but no
approval workflow, and the process engine is deferred (ADR-0091 §6).

## Decision

1. **`framework/modules/approvals` owns approval policies and requests.** A policy per tenant and
   subject type (for example `procurement.purchase_order`) sets a threshold amount and the capability
   an approver must hold. A request belongs to one subject (type and id), carries the amount and a
   reason, and is pending, approved, or rejected.
2. **Owners decide when to ask.** The owning command asks `isRequired` for its amount, submits a
   request for its subject, and checks `getForSubject` before acting. An approval covers the amount it
   was granted for; a larger amount needs a new approval.
3. **Deciding is authorized and separated.** Deciding requires the policy's approver capability; the
   requester can never decide their own request, enforced in the service and by a database check.
   Decisions are final.
4. **First consumers**: purchase order release above the threshold (Procurement) and supplier bills
   beyond received quantity (Billing, subject `billing.supplier_bill_variance`, keyed by the bill
   id).

## Consequences

- Multi-step and amount-banded chains, delegation, and escalation stay out until a pilot needs them;
  they belong to the process engine when it returns.
- Every purchase order confirmation path consults approvals when the service is provided: the legacy
  confirmation command fails with `PurchaseOrderApprovalRequired` and leaves a pending request when
  the total needs approval and none covers it, so approval policies cannot be bypassed.

## Alternatives Considered

- **Approval state on each document:** rejected; every owner would reimplement separation of duties.
- **Wait for the process engine:** rejected; Procure-to-Pay needs approvals now.
