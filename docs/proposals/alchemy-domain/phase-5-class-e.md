# Phase 5: Class E, Rules Whose Business Meaning Changes

> **Status:** Revised after review on 2026-11-23; awaiting owner acceptance
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

## Prerequisites

- **Phase 4 is accepted for its stories only.** Its seven open items bind this phase where a rule
  posts or reads a lagging view: the lag budget and the barrier on the cluster host, the accounting
  owner's acceptance of lagging subledgers, the `DO/`/`GR/` gap policy (ADR-0095 is gapless), the
  ledger decision, and the workflow-engine ADR. The ADR gates a saga on the cluster host, not a
  story in memory.
- **The cutover gates are unmet** (`alchemy.host-role`, `alchemy.rebuild`), and the host commits on
  its own connection pool, so it cannot share a transaction with RITSEI's tables or its ledger.
  Phases 3 and 4 removed their cutover for this; this phase does too (finding 1).
- **Already modelled.** `SAL-DLV-2` has both step orders as stories
  (`framework/foundation/domain-model/tests/delivery.story.test.ts`); phase 4 modelled the staged
  patterns these rules reuse (a saga with compensation and a parked failure, a policy that sends a
  command, a sequence aggregate that allocates after a recorded fact, a projection with a waiting
  query). This phase applies them; it does not build a second set.

## Aggregates

All remaining aggregates of Sales, Procurement, Inventory, Billing, and Settlement, each moving only
when every rule it carries has passed. The ledger stays outside this track.

## Per-rule design questions

| Rule | Design on Alchemy | Question for the owner |
| --- | --- | --- |
| `SAL-DLV-2` | Saga over delivery and stock items; the pilot measured both step orders | Accept issue-and-return trails for failed deliveries? Which step order? |
| `SAL-CREDIT-1`, `SAL-CREDIT-2` | A credit exposure aggregate per customer that decides the limit check and holds the reservation for a confirmed order, committed before the order is confirmed so a refusal still leaves the order unchanged; it receives receivables from Billing as events | Accept a lag between an invoice and its exposure, or reserve exposure at confirmation? What releases a reservation whose confirmation fails? |
| `BIL-DOC-1` | The document records first; a number sequence allocates only for a recorded document (the `DO/` model of phase 4), then tax and journal follow, each idempotent | Accept a document that is recorded but briefly unnumbered and unposted? |
| `BIL-INV-1` | Billing owns an invoiced-quantity tracker per sales order, an **aggregate** (not a projection) fed by delivery events through a policy; the invoice decision reads it | Accept that a just-recorded delivery is not invoiceable until the tracker catches up? |
| `BIL-BILL-1` | Billing owns a billed-quantity tracker per purchase order, an **aggregate** fed by receipt and return events; the bill decision reads it | Same lag for supplier bills |
| `SET-BANK-3` | Match capacity as one aggregate per line and payment pair, or a reservation saga | Accept a compensated match when two people match at once? |
| `PRC-RET-1` | Return recorded, then stock issued; issue can fail if stock was consumed | Accept a recorded return that is later cancelled? |
| `INV-XFER-1` | Saga over every source and destination stock item | Accept a transfer that is visible half applied, then compensated? |

## Deliverables, per rule

1. Stories for every outcome, including each failure and its compensation.
2. The rule's business owner's written sign-off on its new meaning, recorded in its `RULES.md`.
3. For rules that post: the accounting owner's written acceptance of the reversal trail and a
   period-close rule for a step and its compensation in different periods.
4. For each rule, a recorded outcome: staged on Alchemy with deliverables 1 to 3 met, or kept on its
   PostgreSQL transaction. **No cutover** (removed by review, see below): whether a rule moves is
   decided later, when the gates are met and the aggregate's whole rule set has passed.

## Exit evidence

For each rule, either deliverables 1 to 3 with its outcome recorded, or a recorded decision that it
stays on a PostgreSQL transaction. The decision is written in the rule's `RULES.md` and in this
document's review record. A concurrency proof (`SAL-CREDIT-2`, `BIL-INV-1`, `SET-BANK-3`) states
the invariant inside one aggregate in a story; true concurrency is proven on the cluster host, as
the PostgreSQL tests in `tests/chains/` prove it today. A cutover is not exit evidence.

## Review findings (2026-11-23)

1. **The cutover deliverable cannot be met.** A rehearsed cutover needs a command that commits with
   RITSEI's tables, and the host commits on its own pool; `BIL-DOC-1`, `BIL-INV-1`, `SAL-DLV-2`
   and `PRC-RET-1` also post to the table-backed ledger, and the gates are unmet. Replaced by a
   recorded outcome per rule; no cutover.
2. **The `BIL-DOC-1` question is partly moot.** The document and ADR-0124 say gapless numbering
   "becomes gapless with voided numbers when a step fails after allocation". That follows from
   allocating first. Phase 4's `DO/` model allocates only for a recorded fact, which keeps the
   series gapless (ADR-0095) with no void. The question narrows to a recorded document that is
   briefly unnumbered and unposted, which a fiscal reviewer and the accounting owner must accept for
   legal documents (`INV/`, `CN/`, `BILL/`, `DN/`). The rule text "in one transaction" changes only
   at cutover.
3. **The trackers must be aggregates.** ADR-0124 says checks taken at decision time (credit, stock,
   billable quantity) read aggregate state, not a projection. The table rows said "tracker fed by
   events"; they now say aggregate.
4. **Phase 4 already stages two of these rules' neighbours.** `BIL-BILL-3` and `BIL-CREDIT-1`
   record the bill and post its journal later, which is already a change to `BIL-DOC-1`'s "one
   transaction". The two rules are stated together here so the document is not both recorded and
   unposted by one rule and atomic by another.
5. **Three rules' concurrency proofs are PostgreSQL tests today**
   (`tests/chains/concurrent-commands.postgres.test.ts`, `order-to-cash.postgres.test.ts`,
   `bank-reconciliation.postgres.test.ts`). The stories prove the invariant, not the race; the exit
   evidence now says where each is proven.
6. **`SAL-CREDIT-1` refuses before the order changes.** The reservation must commit first, then the
   order confirms, or a refusal would leave a reservation with no order; the design question now
   asks what releases it.
7. **`SAL-DLV-2` step order has a measured trade-off, not a free choice.** Variant A records the
   delivery first and lets Billing see a delivery that is reversed; variant B issues stock first and
   refuses an over-delivery after stock was issued and returned (ADR-0124 pilot table). Both leave
   2 journal rows for a failed delivery. The owner decides with that table; the exit already names
   "Billing invoices only completed deliveries" as the condition for variant A.
8. **The open question has an inferred answer, which is not a decision.** Rules that post to the
   ledger and have no external step (`BIL-DOC-1`, `SAL-DLV-2`) are the likeliest to stay on a
   PostgreSQL transaction, because ADR-0124 says the five views answer no for single-database
   flows. Inferred, not measured; the owner decides each rule.

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
| 2026-11-23 | Review before owner acceptance | Revised | Removed the rehearsed cutover (unmet gates; the host cannot share a transaction with the ledger); added prerequisites and what phases 1 to 4 already model; narrowed the `BIL-DOC-1` question (allocate only after a recorded fact); made the trackers aggregates; ordered the credit reservation before the confirmation; stated where each concurrency proof runs; corrected the status |
