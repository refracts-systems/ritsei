# Phase 4: Class D, Staged Flows with the Same Facts

> **Status:** Revised after review on 2026-11-23; awaiting owner acceptance
>
> **Roadmap gate:** `alchemy.class-d`
>
> **Related documents**
>
> - Phase index: [`./README.md`](./README.md)
> - Roadmap track: [`../../roadmap/alchemy-domain.md`](../../roadmap/alchemy-domain.md#class-d-alchemyclass-d)
> - Rule classification: [ADR-0124](../../decisions/0124-adopt-alchemy-domain-in-phases.md#rule-by-rule-classification)
> - Durable execution: [`../../architecture/durable-execution.md`](../../architecture/durable-execution.md)

## Scope

The 11 class D rules: `ACC-OPEN-3`, `BIL-OPEN-1`, `BIL-BILL-3`, `BIL-CREDIT-1`, `INV-VAL-1`,
`INV-VAL-2`, `INV-OPEN-5`, `PRC-RCPT-1`, `PRC-VRCPT-1`, `SAL-DLV-1`, `SET-WHT-1`. Each becomes
several commits that record the same business facts, plus a lag or a new legitimate state.

## Aggregates

- **May move:** none in this phase. The opening stock load is the only aggregate whose highest rule
  is class D, but a cutover needs `alchemy.host-role` and `alchemy.rebuild`, which are unmet, and
  it cannot be atomic with the ledger (see "Review findings"). It is modelled only, as phase 3 did
  for its aggregates.
- **Modelled only:** the opening stock load, stock items, purchase receipts, billing documents,
  payments, and sales deliveries, which carry class E rules; the ledger, which is outside this
  track.

## Prerequisites

- **Workflow engine.** Alchemy sagas run on the Effect Cluster workflow engine, while
  `durable-execution.md` names `pg_durable` as the candidate and a job layer until then, and
  ADR-0091 defers the process engine. An ADR resolves this before the first saga reaches
  production. Deliverables 1 to 5 run as stories in memory and do not wait for it; the ADR gates
  only a saga on the cluster host.
- **Already modelled.** `SAL-DLV-1`'s over-delivery cap has a story
  (`framework/foundation/domain-model/tests/delivery.story.test.ts`) and the opening stock load has
  its item claim (`opening-item-claim.story.test.ts`); this phase adds what they lack, not a second
  model.

## Deliverables

1. Policies and sagas for receipts (`PRC-RCPT-1`, `PRC-VRCPT-1`), valued moves (`INV-VAL-2`),
   supplier bills and credits (`BIL-BILL-3`, `BIL-CREDIT-1`), withholding receipts (`SET-WHT-1`),
   and the opening stock load (`INV-OPEN-5`), as stories in memory. Each saga states what happens
   when its later step is refused (a closed period, an inactive item): the receipt or load stays
   recorded and the failure is parked for a person, never retried forever and never deleted.
2. A lag budget per projection that feeds a report or check: the ledger view, the valuation report
   (`INV-VAL-1`), open items and aging (`BIL-OPEN-1`), with measured lag on the real host.
3. A period-close barrier: closing a period waits until every projection has applied the period's
   events, and migration sign-off (`ACC-OPEN-3`) waits the same way.
4. The unapplied-cash state for `SET-WHT-1`: a receipt whose allocation fails stays recorded and
   unallocated, shown as such, and is allocated later.
5. `SAL-DLV-1`'s `DO/` numbering from a sequence aggregate, with a written gap policy: the rule
   text does not say gapless, but ADR-0095 makes every series gapless, so a gap is a change to that
   ADR and the owner's decision. The model keeps the series gapless (`delivery-numbering-model.ts`).
6. The opening stock load as a saga in memory: the load commits, then a policy posts the journal
   against migration clearing under the same reference, and a reversal journal marked as a failed
   load follows when a later step fails. **No cutover** (removed by review, see below).

## Exit evidence

Stories for the eleven rules; the lag budget per projection set by the owner and measured on the
cluster host (the story host has no lag, so it cannot show one); the barrier proven on the cluster
host at a period close, as `PRC-READ-1` was; the accounting owner's written acceptance of the
lagging subledger and the unapplied-cash state; the rule text of every changed rule (see below)
accepted by its owner. A cutover is not exit evidence.

## Review findings (2026-11-23)

1. **The opening stock cutover is removed.** ADR-0124 records that the Effect Cluster host commits
   on its own connection pool, so a command cannot share a transaction with RITSEI's tables. A load
   that commits in the host and then posts its journal to the table-backed ledger is two commits,
   and the rule `INV-OPEN-5` says the opposite: the journal is posted inside the load's transaction
   and rolls back with it. The cutover gates (`alchemy.host-role`, `alchemy.rebuild`) are also
   unmet. Phase 3 removed its cutover for the same gates; this phase does too.
2. **Staging changes the text of four rules, which is an owner decision.** `PRC-RCPT-1` says
   receiving is atomic with Inventory; `INV-OPEN-5` says the journal rolls back with the load;
   `SET-WHT-1` says the allocation happens in the same command; `INV-VAL-2` locks in one
   transaction. Class D keeps the facts but not these sentences. Each rule's text changes together
   with its test only when its aggregate cuts over, not by this phase.
3. **A receipt can still be refused after it is recorded.** This document said goods that
   arrived cannot be refused; that holds for the fact but not for the steps after it (a closed
   period for the journal, an inactive item). Deliverable 1 now requires the parked-failure state.
4. **The period-close barrier is not statable in the story host.** It reads how far the host has
   applied events, which only the cluster host has (`ConsistencyTimeout`, 10 seconds). It is proven
   there, and the close command itself stays table-backed in Accounting.
5. **The lag budget has no number.** The two open questions below are owner inputs; measuring
   without a budget proves nothing. The owner sets the budget before the measurement.
6. **`DO/` and `GR/` gaps are a business decision.** The rule texts do not say gapless, but
   ADR-0095 makes every series gapless and names a gap-tolerant series only as a later option for
   non-legal documents. Allowing a gap is the owner's call and changes that ADR; a written policy
   is exit evidence.

## Stop conditions

- The accounting owner does not accept a subledger that lags the ledger at period close.
- No workflow engine decision is reached.

## Five views

- **Auditor.** `INV-VAL-2` writes one valuation entry per item carrying the journal id, so a
  reviewer can follow a movement to its journal; staged commits must keep that link. `PRC-VRCPT-1`
  numbers each receipt `GR/` and `SAL-DLV-1` each delivery `DO/`; neither rule text says gapless,
  but ADR-0095 does for every series, so staging must keep it gapless or the owner changes the ADR. `INV-OPEN-5` rolls the load's journal
  back with a failed load today; staged, a failed load leaves the journal and a reversal, which must
  be marked as a failed load, not two business events. `PRC-RCPT-1` blocks cancelling an order
  after an over-receipt; that block must hold while the receipt is still being applied.
- **Accountant.** `INV-VAL-1` promises that the inventory account equals the valuation report, and
  `BIL-OPEN-1` that aging at a date equals the control account at that date; both hold only after
  projections catch up, so the barrier in deliverable 3 decides period close. `ACC-OPEN-3` signs off
  migration only with clearing at exactly zero at the cutoff, so it waits for the ledger view.
  `BIL-BILL-3` debits GRNI at the purchase price and the rest to variance; `BIL-CREDIT-1` reverses a
  document's journal and makes credited supplier quantity billable again, which now reaches
  Procurement's matching as an event. `SET-WHT-1` debits the bank with cash and the claim account
  with the withheld part and allocates in the same command; staged, a receipt can sit unallocated,
  a known receivables state that is new for RITSEI and needs a report.
- **Systems engineering.** `INV-VAL-2` locks balances and valuations in item order inside one
  transaction to avoid deadlocks; per-item aggregates turn a multi-item document into one commit
  per item plus its journal. `SAL-DLV-1` makes two simultaneous deliveries of one remainder
  impossible; the order aggregate serializes them (piloted). `DO/` and `GR/` numbers come from
  sequence aggregates. The phase brings the first sagas and policies, with the workflow engine
  conflict, at-least-once delivery, and lag budgets; each policy must be safe to run twice and use
  command ids derived from its triggering event.
- **ERP engine development.** `PRC-RCPT-1` and `PRC-VRCPT-1` record a receipt of goods that did
  arrive; the fact cannot be refused, so staging stock and journal after it adds lag but no reversal.
  Mature engines post a goods receipt with its stock and accounting documents together; staging is
  acceptable here for that reason, which is why returns (`PRC-RET-1`) wait for phase 5.
- **Warehouse operations.** After `PRC-RCPT-1` and `PRC-VRCPT-1`, a receipt can show before its
  stock is available for picking; the lag budget must be short enough that pickers do not see "out
  of stock" for goods on the dock. Valuation under `INV-VAL-1` (moving average, rounded half up, last
  units take the remaining value) is unchanged for them.

## Open questions

- Which lag is acceptable for the valuation report during a working day?
- Does the ledger ever move to streams, or do all journals stay table-backed?

## Review record

| Date | Reviewer | Outcome | Notes |
| --- | --- | --- | --- |
| 2026-11-23 | Review before owner acceptance | Revised | Removed the opening stock cutover (unmet gates; two commits against `INV-OPEN-5`); stated that four rule texts change only at cutover; required a parked-failure state for refused later steps; moved the barrier and lag measurement to the cluster host with an owner-set budget; listed what phases 1 to 3 already model; made the workflow engine ADR gate only cluster sagas; corrected the status |
