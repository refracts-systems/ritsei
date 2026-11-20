# Phase 1: Class A, Rules That Fit One Aggregate

> **Status:** Waits for phase 0 exit
>
> **Roadmap gate:** `alchemy.class-a`
>
> **Related documents**
>
> - Phase index: [`./README.md`](./README.md)
> - Roadmap track: [`../../roadmap/alchemy-domain.md`](../../roadmap/alchemy-domain.md#class-a-alchemyclass-a)
> - Rule classification: [ADR-0124](../../decisions/0124-adopt-alchemy-domain-in-phases.md#rule-by-rule-classification)

## Scope

The 34 class A rules: `ACC-OPEN-2`, `ACC-OPEN-4`, `BIL-RENDER-1`, `BIL-RENDER-2`, `BIL-SET-1`,
`BIL-BILL-2`, `INV-STOCK-1`, `INV-STOCK-2`, `INV-STOCK-4`, `INV-STOCK-5`, `INV-AUTH-1`,
`INV-VAL-3`, `INV-OPEN-1`, `INV-OPEN-2`, `INV-OPEN-3`, `PRC-PO-1`, `PRC-PO-2`, `PRC-PO-4`,
`PRC-AUTH-1`, `PRC-DOC-1`, `PRC-PRICE-1`, `PRC-REL-1`, `SAL-ORDER-1`, `SAL-ORDER-3`, `SAL-AUTH-1`,
`SAL-CUST-2`, `SAL-QUOT-1`, `SAL-QUOT-2`, `SET-BANK-1`, `TAX-CALC-1`, `TAX-CALC-2`, `TAX-RATE-1`,
`TAX-AUTH-1`, `TAX-PROD-1`.

Each keeps its meaning on Alchemy: validation, authorization, a read of stable reference data, or a
state machine inside one instance.

## Aggregates

- **May move:** tax codes with rate periods (Tax) and supplier prices (Procurement), the only
  aggregates whose every rule is class A.
- **Stay table-backed:** every other aggregate these rules touch carries a higher-class rule. This
  phase models them with `decide` and `evolve` and states their class A rules as stories in memory;
  production keeps the tables.

## Deliverables

1. A model per module for the aggregates above, through the phase 0 port.
2. A story for each of the 34 rules, naming its `[ID]`, so the modules test links each rule.
3. For tax codes and supplier prices: parity tests that run the same cases against the table and
   stream implementations, a rehearsed cutover of existing rows, and updated `RULES.md` and
   `state-and-consistency.md`.
4. A replacement for the foreign key from products to tax codes (`TAX-PROD-1`): command-time
   validation in Product plus a reference view, or keeping tax codes table-backed.

## Exit evidence

Stories for all 34 rules pass; the two cut-over aggregates pass parity tests and a rehearsed
migration; owner documents describe the new authority.

## Stop conditions

- A cut-over aggregate needs a foreign key from a table that command-time validation cannot replace.
- Parity tests find a tax calculation that differs between implementations.

## Five views

- **Auditor.** `TAX-RATE-1` offers no command that changes or deletes a rate period; a rate change
  is a later period. An event history keeps that by construction and adds who scheduled each period
  and when. `PRC-PO-1` and `SAL-ORDER-1` freeze a confirmed document, enforced by PostgreSQL today;
  their stories must show `decide` refusing every change after confirmation. `ACC-OPEN-4` (journals
  never deleted) stays on the ledger tables. `SAL-AUTH-1`, `PRC-AUTH-1`, `INV-AUTH-1`, and
  `TAX-AUTH-1` deny by default; a story per capability shows it still holds.
- **Accountant.** Tax amounts must not change by a cent. `TAX-CALC-1` rounds half up per line,
  `TAX-CALC-2` computes per line and per code in one direction, and `TAX-RATE-1` takes the latest
  period on or before the transaction date and never defaults to today. Parity tests between the
  table and stream implementations must cover rounding boundaries and dates on a period start before
  tax codes move. `PRC-PO-2` derives totals in integer minor units, `BIL-SET-1` never settles more
  than the open amount, `BIL-BILL-2` values excess at the bill's price, `INV-VAL-3` never invents a
  cost, and `ACC-OPEN-2` keeps control accounts out of the opening journal: all gain stories while
  their aggregates stay on tables, so no posting changes.
- **Systems engineering.** The risk is in the two cutovers. `TAX-PROD-1` is a database binding from
  products to tax codes of the same direction; moving tax codes removes it, so Product validates at
  command time against a tax code view, and a just-created code may be invisible until the view
  catches up. `SAL-ORDER-3` and `PRC-PO-4` rely on tenant-local composite constraints that stay on
  tables in this phase. `SAL-CUST-2` reads an active Party relationship at creation and `SET-BANK-1`
  rejects a whole file before storing anything; both are single commands with no change. Rollback
  means switching back to the tables, which stay intact until exit.
- **ERP engine development.** Mature engines keep tax and price master data relational because
  every document reads it (`SAL-QUOT-1` defaults tax codes through Tax; `PRC-PRICE-1` supplies
  purchase prices). The phase shows whether those reads through views are fast and fresh enough
  before any transactional aggregate moves. `PRC-REL-1` forbids self-approval in the database today;
  in `decide` it must hold for every approval path, and `SAL-QUOT-2` keeps its rule that repeating
  the target state returns the quotation unchanged. `BIL-RENDER-1` stays staged and
  `BIL-RENDER-2` keeps its integrity checks on its table.
- **Warehouse operations.** `INV-STOCK-1` (reservations never exceed available stock; receiving and
  reserving are atomic), `INV-STOCK-4` (UOM corrections keep reservations), `INV-STOCK-5` (warehouse
  legal entity and branch bound stock), and `INV-OPEN-2` and `INV-OPEN-3` (what an opening load may
  carry, and the revaluation approval) gain stories only. Stock stays on tables, so nothing changes
  on the floor.

## Open questions

- Should tax codes move at all, given how many tables reference them, or only gain stories?
- Do supplier prices need to be readable in the same transaction that drafts a purchase order
  (`PRC-DRAFT-1`)?

## Review record

| Date | Reviewer | Outcome | Notes |
| --- | --- | --- | --- |
| | | | |
