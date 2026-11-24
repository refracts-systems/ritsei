# Phase 5: Class E, Rules Whose Business Meaning Changes

> **Status:** Accepted by the owner on 2026-11-23; exit evidence accepted on 2026-11-24 for the stories (review record), with the open items below
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
| `SAL-DLV-2` | Saga over delivery and stock items; the pilot measured both step orders | Kept on its PostgreSQL transaction (owner, 2026-11-24) |
| `SAL-CREDIT-1`, `SAL-CREDIT-2` | A credit exposure aggregate per customer that decides the limit check and holds the reservation for a confirmed order, committed before the order is confirmed so a refusal still leaves the order unchanged; it receives receivables from Billing as events | Kept on its PostgreSQL transaction (owner, 2026-11-24) |
| `BIL-DOC-1` | The document records first; a number sequence allocates only for a recorded document (the `DO/` model of phase 4), then tax and journal follow, each idempotent | Kept on its PostgreSQL transaction (owner, 2026-11-24) |
| `BIL-INV-1` | Billing owns an invoiced-quantity tracker per sales order, an **aggregate** (not a projection) fed by delivery events through a policy; the invoice decision reads it | Kept on its PostgreSQL transaction (owner, 2026-11-24) |
| `BIL-BILL-1` | Billing owns a billed-quantity tracker per purchase order, an **aggregate** fed by receipt and return events; the bill decision reads it | Kept on its PostgreSQL transaction (owner, 2026-11-24) |
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
| 2026-11-23 | Owner | Accepted | The document and its revisions, including the removal of the cutover |
| 2026-11-24 | Owner | Exit evidence accepted | The stories for the nine rules (`INV-XFER-1`, `SAL-DLV-2`, `PRC-RET-1`, `SET-BANK-3`, `BIL-INV-1`, `BIL-BILL-1`, `SAL-CREDIT-1`, `SAL-CREDIT-2`, `BIL-DOC-1`). Model only: no cutover. No rule has an outcome; the open items stay open |
| 2026-11-24 | Owner | Outcome decided | `BIL-INV-1` stays on its PostgreSQL transaction (Keep). No move, no cutover; the staged model stays as test-only evidence. The `RULES.md` records it |
| 2026-11-24 | Owner | Outcome decided | `BIL-BILL-1` stays on its PostgreSQL transaction (Keep). No move, no cutover; the staged model stays as test-only evidence. The `RULES.md` records it |
| 2026-11-24 | Owner | Outcome decided | `SAL-CREDIT-1`, `SAL-CREDIT-2` stay on their PostgreSQL transaction (Keep). No move, no cutover; the staged model stays as test-only evidence. The `RULES.md` records it |
| 2026-11-24 | Owner | Outcome decided | `BIL-DOC-1` stays on its PostgreSQL transaction (Keep). No move, no cutover; the staged model stays as test-only evidence. The `RULES.md` records it |
| 2026-11-24 | Owner | Outcome decided | `SAL-DLV-2` stays on its PostgreSQL transaction (Keep). No move, no cutover; the staged model stays as test-only evidence. The `RULES.md` records it |

Two acceptances are recorded above. The document was accepted on 2026-11-23 as the plan, and the
stories for the nine rules on 2026-11-24. Neither decides a per-rule question, and no rule has an
outcome yet. Each of these needs its own owner decision or evidence, rule by rule, before that
rule's exit:

The per-rule choices and their prices are laid out in [`phase-5-decision-sheet.md`](./phase-5-decision-sheet.md).

1. For each of the 9 rules: staged on Alchemy (stories, the business owner's sign-off, the accounting
   owner's acceptance where it posts) or kept on its PostgreSQL transaction. Every outcome column
   reads "Not decided".
2. The step order of `SAL-DLV-2` (variant A or B), and whether Billing invoices only completed
   deliveries.
3. Whether a legal billing document may be recorded and briefly unnumbered and unposted
   (`BIL-DOC-1`), and the gap policy of the series.
4. The lag a tracker or exposure may have (`BIL-INV-1`, `BIL-BILL-1` including its return-lag
   window, and `SAL-CREDIT-1`), the accounting owner's written acceptance of receivable lag for
   credit exposure, and whether releasing a reservation by compensation is acceptable.
5. The phase 4 open items that bind the posting rules, the workflow-engine ADR before any saga on the
   cluster host, and issue #122.
6. The cutover gates `alchemy.host-role` and `alchemy.rebuild`; no cutover is in this phase, and
   true concurrency is proved on the cluster host, not by stories.

## Rule progress

| Rule | Stories | Outcome |
| --- | --- | --- |
| `INV-XFER-1` | Done (2026-11-23), model only: `erp/modules/inventory/tests/transfer-saga.story.test.ts` | Not decided: staged on Alchemy or kept on its PostgreSQL transaction is the owner's call |
| `SAL-DLV-2` | Done (2026-11-23), model only: `framework/foundation/domain-model/tests/delivery.story.test.ts`, both step orders | Not decided: step order and staged-or-kept are the owner's call |
| `PRC-RET-1` | Done (2026-11-23), model only: `erp/modules/procurement/tests/return-staging.story.test.ts` | Not decided: staged on Alchemy or kept on its PostgreSQL transaction is the owner's call |
| `SET-BANK-3` | Done (2026-11-23), model only: `erp/modules/settlement/tests/bank-match.story.test.ts` | Not decided: staged on Alchemy or kept on its PostgreSQL transaction is the owner's call |
| `BIL-INV-1` | Done (2026-11-24), model only: `erp/modules/billing/tests/invoiced-quantity.story.test.ts` | Not decided: staged on Alchemy or kept on its PostgreSQL transaction is the owner's call |
| `BIL-BILL-1` | Done (2026-11-24), model only: `erp/modules/billing/tests/billed-quantity.story.test.ts` | Not decided: staged on Alchemy or kept on its PostgreSQL transaction is the owner's call |
| `SAL-CREDIT-1`, `SAL-CREDIT-2` | Done (2026-11-24), model only: `erp/modules/sales/tests/credit-exposure.story.test.ts` | Not decided: staged on Alchemy or kept on its PostgreSQL transaction is the owner's call |
| `BIL-DOC-1` | Done (2026-11-24), model only: `erp/modules/billing/tests/document-numbering.story.test.ts` | Not decided: staged on Alchemy or kept on its PostgreSQL transaction is the owner's call |

What the `INV-XFER-1` stories show, for that decision: confirmation is a saga with a compensation per
deducted line, so a refused line leaves a deduction and its restoration on the stock (production
leaves nothing) and the transfer is visible as confirming while some lines are deducted; completion
has no refusal and no compensation; **a retry after a refusal needs its own saga run**, because a
saga run is keyed and the first key is spent, so the model keys each confirmation by transfer and
attempt (without it the retried transfer stays confirming for good). Not modelled: reservations,
costs, the two capabilities, and who is told of a refusal. The sign-off of the warehouse owner on the
half-applied state is not given.

What the `SAL-DLV-2` stories add to the pilot's, for that decision (both step orders, 15 stories):

- **A failed delivery id is spent.** Production rolled a failed delivery back, so a retry with the
  same id ran again; staged, the failed delivery stays recorded and a retry with the same id records
  nothing, so the caller needs a new delivery id. The rule text "a retried delivery id returns the
  recorded result" now returns a failed record. The reversed quantity is free again for the new id.
- **Variant B refuses every rejection after stock moved**, not only an over-delivery: an order that
  is not confirmed and a line not on the order also issue stock and return it before the refusal
  (the pilot's table named only the over-delivery). Variant A refuses those before any stock moves.
  This sharpens the step-order decision: B keeps the order free of reversals but turns every
  business refusal into stock movement and a journal pair.
- Not modelled: `DO/` numbering (see the phase 4 model), valued cost per line, and the held-stock
  display. The business owner's sign-off and the accounting owner's acceptance of the reversal trail
  are not given.

What the `PRC-RET-1` stories show, for that decision: a return is **recorded first and cancelled when
a later step is refused**. The order aggregate holds received and returned quantity, so the cap and
the record are one commit and two returns cannot take the same remainder. A saga issues each line at
the order price (not moving average; the last units take what is left; stock worth less than the
price is refused) and posts one journal against GRNI. If a line is refused (the stock was consumed),
the earlier lines are restored, the order cancels the return and frees its quantity, and the status
shows it failed: the warehouse and the supplier-facing record see a return that existed for a moment.
**The id of a cancelled return is spent** (production rolled back, so a retry re-ran); the caller
returns again under a new id. Not modelled: the `RET/` number (the `DO/` pattern of phase 4
applies), receipt and matching reads, the return date, and the journal's period check. The
purchasing owner's sign-off and the accounting owner's acceptance of the reversal trail are not
given.

What the `SET-BANK-3` stories show, for that decision: the rule needs two capacities, and **no single
aggregate can own both** (a line takes many payments and a payment many lines), so the design is a
**hold on each capacity**, decided by the line and the payment aggregate, and a match saga that holds
the line, holds the payment, and records. Each capacity then serializes its own matches and the sums
never exceed either. The price: a payment that refuses leaves the line held for a match that fails,
so another match of the same line can be refused for capacity that comes back a moment later; the
failed match stays recorded and its id is spent; the refusal names the capacity that refused (the
line first), where production reports the smaller of the two as `available`. Reversal releases both
holds and keeps the match. True concurrency (two people matching at once) is not stateable in the
story host and is proven on the cluster host, as the PostgreSQL test in
`tests/chains/bank-reconciliation.postgres.test.ts` proves it today. Not modelled: the legal entity,
bank account and direction check (`BankMatchMismatch`), the capability, who matched, and the report.
The treasury owner's sign-off on a compensated match is not given.

What the `BIL-INV-1` stories show, for that decision (9 stories, 9 mutants killed): Billing owns the
tracker per sales order as an aggregate holding delivered and invoiced quantity per line, fed by
Sales' delivery and confirmation events through two policies, so "delivered less invoiced" and the
record of the invoice are one commit and two invoices for the same deliveries serialize on the
tracker (the second fails with `NothingToInvoice`, as in production, and posts no journal).

- **A delivery is invoiceable only once the tracker has it.** Between Sales recording a delivery and
  the policy feeding the tracker, an invoice fails with `NothingToInvoice`, the same answer as for a
  delivery that does not exist. Too early, never too late; the owner decides whether that lag is
  acceptable (the open question of this rule).
- **The tracker accepts the confirmation and the deliveries in either order,** because two policies
  feed it independently; the invoice needs the confirmation and refuses with `OrderNotConfirmed`
  until it arrives.
- **Billing sees only deliveries Sales completed.** That the delivery event follows a successful
  stock issue is a property of `SAL-DLV-2` (variant A); the stories take the event as given and do
  not prove it.
- **The journal is a later step:** the invoice records first and a policy posts receivable, revenue,
  and output tax once per invoice. Production posts both in one transaction.
- **True concurrency is not shown.** The stories run commands one after another; that two
  simultaneous invoices cannot both pass is a property of the tracker being one aggregate, and is
  proved on the cluster host, not here.

Not modelled: tax from the Tax module (a whole-basis-point rate rounded half up per line stands in),
the gapless `INV/` number (`BIL-DOC-1`), the invoice date and period, credit notes, products, and the
capability. The business owner's sign-off on the lag is not given.

What the `BIL-BILL-1` stories show, for that decision (12 stories, 17 mutants killed): Billing owns
the tracker per purchase order as an aggregate holding received, returned, billed, and credited
quantity per line, fed by Procurement's confirmation, receipt, and return events through three
policies, so "billable" and the record of the bill are one commit and two bills for the same receipt
serialize on it. Billable is received less returned less billed plus credited, as in production, and
a return after a bill can leave it negative.

- **The lag has two directions, and one is worse than for `BIL-INV-1`.** A receipt the tracker has
  not received yet makes a bill fail as exceeding the receipt: too early, harmless. A **return** the
  tracker has not received yet lets a bill take goods that are about to be returned; when the return
  arrives the line is negative and bills nothing more, but the bill is already recorded. Production's
  single transaction cannot do that. The owner must accept this window or keep the rule on
  PostgreSQL; the accounting owner must accept the bill that a later return then contradicts (a
  credit note, not a deletion).
- **Excess needs a covering approval and is valued at the bill's price,** as `BIL-BILL-2` says; a
  covered excess records the bill but matches only the billable part. The approval is an input here;
  who requested and who approved is not modelled.
- **A line not on the order is refused even with an approval,** with billable and requested both 0,
  as production does.
- **The tracker accepts confirmation, receipts, and returns in any order;** a bill needs the
  confirmation and refuses with `PurchaseOrderNotConfirmed` until it arrives.
- **The journal and the credit note's staging are not repeated here:** `supplier-bill-staging-model.ts`
  (phase 4) posts the journal, and its returned quantity reaches this tracker as `TrackCredit`.
- **True concurrency is not shown.** Commands run one after another; that two simultaneous bills
  cannot both pass is a property of the tracker being one aggregate, proved on the cluster host.

Not modelled: tax, the bill date and period, the gapless `BILL/` number (`BIL-DOC-1`), the capability,
and product descriptions. The business owner's sign-off on the lag is not given.

What the `SAL-CREDIT-1` and `SAL-CREDIT-2` stories show, for that decision (14 stories, 16 mutants
killed): one exposure aggregate per customer holds the limit, the receivable balance, and a
reservation per confirmed order, so the limit check and the reservation are one commit and two
orders for the same customer serialize on it. Confirmation is a saga: reserve credit, claim the
confirmation key (`SAL-ORDER-2`), mark the order confirmed.

- **The reservation comes first, as the review required.** A credit refusal leaves the order a
  draft with nothing reserved and nothing claimed, the production answer. A refusal at the key claim
  releases the reservation, so the exposure records a reservation and its release where production
  leaves nothing; this answers "what releases a reservation whose confirmation fails".
- **A retry after a refusal is its own saga run,** as for `INV-XFER-1`: the order carries an attempt
  number and the saga key is the order and attempt.
- **A retried confirmation is not checked again,** even after the limit is lowered, as the rule says.
  No limit never refuses but still reserves, so a limit set later counts those orders.
- **Committed is reserved totals less invoiced net over those orders, never below zero.** An invoice
  moves an amount from committed to receivable in one event, so Billing's lag on an invoice never
  lets an order past the limit.
- **Receivable lag is safe in one direction only.** A settlement or credit note that arrives late
  keeps the balance too high: an order may be refused that production would allow. A receivable
  increase with no reservation behind it (an invoice for no sales order) that arrives late lets an
  order past the limit, and when it arrives the exposure is over the limit with no rule that
  unconfirms an order. The accounting owner's written acceptance of that lag is not given; the
  alternative is to keep the check on PostgreSQL.
- **True concurrency is not shown.** Commands run one after another; that two simultaneous
  confirmations cannot both pass is a property of the exposure being one aggregate, proved on the
  cluster host.

Not modelled: the non-negative limit check, the capability, a customer without a party role or legal
entity (never gated), cancellation of a confirmed order (and so the release of its reservation), and
who is told of a refusal.

What the `BIL-DOC-1` stories show, for that decision: the document records first, then tax, number,
journal, and the posted mark follow as policies, each on the event before it (`BillingDocument`,
`BillingSeries`, `DocumentJournal`).

- **Tax before number keeps the series gapless.** A number is allocated only for a taxed document,
  so a document that never records or never taxes asks for none and the series has no hole and no
  voided number. Production allocates after tax too, but inside one transaction that rolls the
  number back; staged, the order is what keeps the series gapless. The document's "gapless with
  voided numbers" text in ADR-0124 follows from allocating first, which this staging does not do.
- **A series is per legal entity, kind, and calendar year,** restarting at 1, in the format of the
  numbering module (`INV/2026/00001`). The series gives a document one number and remembers it, and
  a document keeps its first number.
- **Tax uses the tax date on the record.** A credit note takes its credited document's date, so a
  step that runs after the 2026-07-01 stand-in rate change still taxes at its own date's rate.
- **The journal posts at the document date, once per document,** on the receivable side for `INV/`
  and `CN/` and the payable side for `BILL/` and `DN/`, credit notes reversed, zero lines dropped.
- **A recorded document is briefly unnumbered and unposted.** This is the owner's question for this
  rule: whether a fiscal reviewer and the accounting owner accept it for legal documents. Reports
  that list documents must either hide documents without a number or show them as pending.
- **Two documents asking at once are serialized by the series,** so numbers are consecutive in the
  order the series receives them, which need not be the order the documents were recorded in.
  True concurrency is proved on the cluster host, not by stories.

Not modelled: the Tax module's rate lookup beyond a two-period stand-in, the matched value of a
supplier bill (`BIL-BILL-3` states it), the open amount, the fiscal calendar (the series restarts
each calendar year), the capability, and a tax or journal step that fails (here each step succeeds;
no step is retried by a saga).
