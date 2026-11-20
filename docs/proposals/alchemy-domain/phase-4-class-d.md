# Phase 4: Class D, Staged Flows with the Same Facts

> **Status:** Waits for phase 3 exit
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

- **May move:** the opening stock load, the only aggregate whose highest rule is class D.
- **Modelled only:** stock items, purchase receipts, billing documents, payments, and sales
  deliveries, which carry class E rules; the ledger, which is outside this track.

## Prerequisites

- **Workflow engine.** Alchemy sagas run on the Effect Cluster workflow engine, while
  `durable-execution.md` names `pg_durable` as the candidate and a job layer until then, and
  ADR-0091 defers the process engine. An ADR resolves this before the first saga reaches
  production.

## Deliverables

1. Policies and sagas for receipts (`PRC-RCPT-1`, `PRC-VRCPT-1`), valued moves (`INV-VAL-2`),
   supplier bills and credits (`BIL-BILL-3`, `BIL-CREDIT-1`), withholding receipts (`SET-WHT-1`),
   and the opening stock load (`INV-OPEN-5`), as stories in memory.
2. A lag budget per projection that feeds a report or check: the ledger view, the valuation report
   (`INV-VAL-1`), open items and aging (`BIL-OPEN-1`), with measured lag on the real host.
3. A period-close barrier: closing a period waits until every projection has applied the period's
   events, and migration sign-off (`ACC-OPEN-3`) waits the same way.
4. The unapplied-cash state for `SET-WHT-1`: a receipt whose allocation fails stays recorded and
   unallocated, shown as such, and is allocated later.
5. `SAL-DLV-1`'s `DO/` numbering from a sequence aggregate, with a written gap policy: the rule does
   not require gapless numbers today.
6. The opening stock load cut over with its journal posted to the table-backed ledger, and a
   reversal journal when a later step fails.

## Exit evidence

Stories for the eleven rules; measured lag within budget; the barrier proven at a period close; the
accounting owner's written acceptance of the lagging subledger and the unapplied-cash state.

## Stop conditions

- The accounting owner does not accept a subledger that lags the ledger at period close.
- No workflow engine decision is reached.

## Five views

- **Auditor.** `INV-VAL-2` writes one valuation entry per item carrying the journal id, so a
  reviewer can follow a movement to its journal; staged commits must keep that link. `PRC-VRCPT-1`
  numbers each receipt `GR/` and `SAL-DLV-1` each delivery `DO/`; neither rule requires gapless
  numbers, so a gap policy is written rather than inherited. `INV-OPEN-5` rolls the load's journal
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
| | | | |
