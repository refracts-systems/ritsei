# ADR-0108: Gate Order Confirmation on a Customer Credit Limit

- Status: Proposed
- Date: 2026-10-24
- Amends: None
- Compatible with: ADR-0091, ADR-0099, ADR-0102
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Parity plan and follow-ups: [`../proposals/erp-chains-next-steps.md`](../proposals/erp-chains-next-steps.md) (F4)

## Context

Nothing stops a customer who already owes a lot from placing and confirming more orders. The parity
plan placed the credit limit in Sales, gating order confirmation, with the customer's open items
read from Billing. Billing depends on Sales, so Sales cannot import Billing.

## Decision

1. **Sales owns the limit.** `sales.customers.credit_limit` is a non-negative amount; null means no
   limit. `SalesDocumentService.setCreditLimit` sets or removes it behind a new capability,
   `sales.credit_limit.configure`; `getCreditStanding` returns the limit, what the customer owes,
   and what is left, behind the existing customer read capability.
2. **Sales asks through a port, Billing answers.** Sales defines `CreditExposure` with one operation,
   `receivableBalance(tenant, legal entity, party)`. Billing implements it by summing the open amount
   of the party's invoices less the open amount of their credit notes in that legal entity, and the
   runtime provides Billing's implementation to Sales. Neither module imports the other's internals.
3. **Confirming a draft order is refused when the balance plus the order total exceeds the limit.**
   `SalesService.confirmOrder` fails with `CreditLimitExceeded` before the order changes. A retried
   confirmation of an order that is already confirmed is not checked again. The delivery and invoicing
   of confirmed orders is not gated.
4. **Only customers with a party role and a legal entity have an exposure.** A customer created
   before party roles (ADR-0099) has no legal entity and is never gated.

## Consequences

- The check reads the balance and then confirms; two orders confirmed at the same moment can both pass.
  The limit is a control, not a hard ledger invariant. Closing the gap would need a lock on the
  customer.
- Confirmed but not yet invoiced orders do not count against the limit, only invoices do. Counting
  them needs a read of Sales' own confirmed orders and is a later refinement.
- The exposure port does not check the caller's billing permissions: the policy applies to whoever
  confirms.

## Alternatives Considered

- **Gate in the `process` coordinator:** rejected; the web app confirms orders through Sales directly,
  so the gate would not cover it.
- **Sales imports Billing:** rejected; it creates a cycle.
- **Store the exposure on the customer:** rejected; it duplicates the open items Billing owns.
