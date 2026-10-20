# ADR-0102: Split Billing and Settlement

- Status: Proposed
- Date: 2026-10-20
- Amends: None
- Compatible with: ADR-0042, ADR-0091, ADR-0095, ADR-0096, ADR-0098
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - ERP parity plan, decision D2: [`../proposals/erp-module-parity-plan.md`](../proposals/erp-module-parity-plan.md)

## Context

Nothing invoices customers or pays suppliers, so neither money half of Order-to-Cash or
Procure-to-Pay exists. The architecture specification gates Settlement on deciding obligation and
payment ownership.

## Decision

1. **Billing owns obligations as posted documents**: customer invoices, customer credit notes,
   supplier bills, and supplier credit notes, with lines, computed tax (ADR-0098), a number per legal
   entity and kind (ADR-0095), the posting journal (ADR-0096), and an **open amount**. Documents are
   created posted and never edited; corrections are credit notes.
2. **Invoice policy is delivered quantity.** A customer invoice bills each order line's delivered,
   not yet invoiced quantity; a billing-source row lock serializes invoices of one source. Supplier
   bills match received quantities (three-way match, Phase 6).
3. **Open amounts are provable.** Every reduction of an open amount is an immutable settlement row
   (payment allocation or credit note application) with its source; a deferred trigger keeps
   `open = total − settlements`. A credit note settles its invoice first and keeps any remainder open
   as a credit balance.
4. **Settlement owns payments and terms**: incoming receipts and outgoing payments (numbered
   `RCV/` and `PAY/`), their journal (cash or a named bank account against receivables or payables),
   allocations to Billing documents through `BillingService.applySettlement`, unallocated amounts on
   account (kept equal to amount − allocations by a deferred trigger), payment terms per party and
   side, aging, and customer statements.
5. **Aging reconciles with the ledger.** Aging is open documents bucketed by due date (document date
   plus the party's net days) plus unapplied credits and unallocated payments, so its total equals
   the receivables or payables control account.

## Consequences

- Settlement depends on Billing and Accounting; Billing depends on Accounting, Sales, Tax, and
  Product; neither depends on the other's tables.
- Aging uses current open amounts for documents dated up to the as-of date; historical aging needs
  settlement dates and is deferred. Bank statements, dunning, and payment runs stay out.
- Billing numbers use the calendar year until fiscal-year configuration is readable outside
  Accounting.

## Alternatives Considered

- **Payments in Billing:** rejected; payments settle documents of several kinds and own the cash
  side.
- **Open amounts computed on read:** rejected; locking and invariants need the stored amount.
