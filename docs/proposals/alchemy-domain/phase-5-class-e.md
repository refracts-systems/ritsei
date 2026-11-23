# Phase 5: Class E, Rules Whose Business Meaning Changes

> **Status:** Awaiting review
>
> **Roadmap gate:** `alchemy.class-e`
>
> **Related documents**
>
> - Phase index: [`./README.md`](./README.md)
> - Roadmap track: [`../../roadmap/alchemy-domain.md`](../../roadmap/alchemy-domain.md#class-e-alchemyclass-e)
> - Rule classification and pilot: [ADR-0124](../../decisions/0124-adopt-alchemy-domain-in-phases.md#pilot-sal-dlv-2-on-alchemy)

## Scope

The 9 class E rules: `BIL-DOC-1`, `BIL-INV-1`, `BIL-BILL-1`, `INV-XFER-1`, `PRC-RET-1`,
`SAL-CREDIT-1`, `SAL-CREDIT-2`, `SAL-DLV-2`, `SET-BANK-3`. On Alchemy each becomes several commits
whose failure or interleaving changes the business facts. This is where the costs the owner accepted
in ADR-0124 are paid.

Each rule is reviewed and decided on its own. A rule that cannot meet its exit stays on a PostgreSQL
transaction, and so do the aggregates it touches; that is a stop condition for the rule, not a
failure of the track.

## Aggregates

All remaining aggregates of Sales, Procurement, Inventory, Billing, and Settlement, each moving only
when every rule it carries has passed. The ledger stays outside this track.

## Per-rule design questions

| Rule | Design on Alchemy | Question for the owner |
| --- | --- | --- |
| `SAL-DLV-2` | Saga over delivery and stock items; the pilot measured both step orders | Accept issue-and-return trails for failed deliveries? Which step order? |
| `SAL-CREDIT-1`, `SAL-CREDIT-2` | A credit exposure aggregate per customer that reserves for confirmed orders and receives receivables from Billing as events | Accept a lag between an invoice and its exposure, or reserve exposure at confirmation? |
| `BIL-DOC-1` | A number sequence per legal entity and kind, then tax and journal | Accept voided numbers when a step fails after allocation? |
| `BIL-INV-1` | Billing owns an invoiced-quantity tracker per sales order, fed by delivery events | Accept that a just-recorded delivery is not invoiceable until the tracker catches up? |
| `BIL-BILL-1` | Billing owns a billed-quantity tracker per purchase order, fed by receipt and return events | Same lag for supplier bills |
| `SET-BANK-3` | Match capacity as one aggregate per line and payment pair, or a reservation saga | Accept a compensated match when two people match at once? |
| `PRC-RET-1` | Return recorded, then stock issued; issue can fail if stock was consumed | Accept a recorded return that is later cancelled? |
| `INV-XFER-1` | Saga over every source and destination stock item | Accept a transfer that is visible half applied, then compensated? |

## Deliverables, per rule

1. Stories for every outcome, including each failure and its compensation.
2. The rule's business owner's written sign-off on its new meaning, recorded in its `RULES.md`.
3. For rules that post: the accounting owner's written acceptance of the reversal trail and a
   period-close rule for a step and its compensation in different periods.
4. A rehearsed cutover for each aggregate that moves, with no fact held by two authorities.

## Exit evidence

For each rule, either deliverables 1 to 4, or a recorded decision that it stays on a PostgreSQL
transaction.

## Stop conditions

- For a rule, neither acceptance nor a PostgreSQL transaction boundary is possible.

## Five views

These views answered no for single-database flows in ADR-0124; the owner accepted the risk, and this
phase turns each objection into an exit criterion.

- **Auditor.** `BIL-DOC-1` gives every billing document a gapless number per legal entity and kind;
  a failed step after allocation would leave a voided number that a fiscal reviewer must be able to
  explain. `SAL-DLV-2` rolls a delivery back when its stock issue fails, and `INV-XFER-1` rolls back
  every deduction when one transfer line is unavailable; staged, both leave reversal records for
  events that did not happen. `SET-BANK-3` already reverses matches rather than deleting them, which
  events keep. **Exit:** every compensation links to the step it reverses and carries a reason that
  marks it as a failed flow; voided numbers are listed with their cause; reports can exclude
  failed-flow pairs.
- **Accountant.** `SAL-DLV-2` issues at moving average against `cost_of_goods_sold`; a return puts
  stock back at the cost it left with, so a receipt in between gives a valuation history a rollback
  would not (`INV-VAL-1`). `PRC-RET-1` issues at the purchase price against GRNI, not moving average.
  `BIL-DOC-1` takes tax at the document's tax date and posts at the document date, so a retried step
  must keep those dates after a rate period starts (`TAX-RATE-1`). `BIL-INV-1` debits receivables
  and credits revenue and output tax for delivered quantity, so it must not see a delivery later
  reversed. `SAL-CREDIT-1` adds open receivables and confirmed orders not yet invoiced; exposure
  that arrives late can let an order past the limit. **Exit:** the period-close barrier also waits
  for running sagas, or a compensation posts in its step's period; Billing invoices only completed
  deliveries; credit exposure is reserved at confirmation, or the accounting owner accepts its lag
  in writing.
- **Systems engineering.** Three rules serialize with row locks across modules today: `SAL-CREDIT-2`
  locks the customer so only one of two orders that fit the limit separately is confirmed,
  `BIL-INV-1` locks the order so only one of two simultaneous invoices posts, and `SET-BANK-3` locks
  the line, then the payment, so matches never exceed what is unmatched on either. On Alchemy each
  needs the invariant inside one aggregate or a reservation with its own failure path.
  `INV-XFER-1` is all or nothing over every line. **Exit:** each saga has a measured failure rate
  and recovery path, compensations never refuse, and a stuck saga is visible and repairable by an
  operator.
- **ERP engine development.** Mature engines post a goods issue for a whole delivery or not at all
  (`SAL-DLV-2`). `INV-XFER-1` is already two-step (confirmation deducts the source, completion adds
  the destination), which maps to in-transit stock in mature engines and may stage well. `BIL-BILL-1`
  bills received less returned less net billed from Procurement's matching view under a lock on the
  purchase order; a Billing-owned tracker changes who owns that number. **Exit:** each saga's step
  order keeps business documents free of technical failures where possible (the pilot's variant B
  for deliveries), and the remaining cases are documented.
- **Warehouse operations.** Under `SAL-DLV-2` a saga holds stock that may come back, causing false
  `StockUnavailable` answers for other orders; under `INV-XFER-1` a transfer can be seen half
  applied; under `PRC-RET-1` a return can be recorded and then fail because the stock was consumed.
  **Exit:** held stock is shown as held, not gone; hold time is measured and bounded; staff can see
  why stock is held and which return failed.

## Open questions

- Which rules does the owner expect to stay on PostgreSQL transactions permanently?

## Review record

| Date | Reviewer | Outcome | Notes |
| --- | --- | --- | --- |
| | | | |
