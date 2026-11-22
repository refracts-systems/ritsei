# Phase 1: Class A, Rules That Fit One Aggregate

> **Status:** Accepted by the owner on 2026-11-22; exit evidence accepted the same day (review record)
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

No aggregate moves in this phase. Every aggregate these rules touch stays table-backed, tax codes
and supplier prices included. The phase models them with `decide` and `evolve` through the phase 0
port and states their class A rules as stories in memory; production keeps the tables and keeps its
behavior.

## Deliverables

1. A model per module for the aggregates above, through the phase 0 port, run on the in-memory host.
2. One pure `decide` function per rule, called by the production service and by the Alchemy
   aggregate's `decide`, so no two models of the same rule can disagree (the shape of
   `erp/modules/sales/src/order-lifecycle.ts` and `erp/modules/procurement/src/order-lifecycle.ts`).
   A rule that is a read or an authorization check is shared as the same pure function or, where
   none exists, stated as a story against the production function.
3. A story for each of the 34 rules, naming its `[ID]`, so the modules test links each rule.
4. Tax codes stay table-backed because of the foreign key from products (`TAX-PROD-1`); they gain
   stories only. Supplier prices are read outside the purchase order transaction (`PRC-DRAFT-1`),
   because the price is copied onto the order line.

## Exit evidence

Stories for all 34 rules pass, and each aggregate's `decide` is the same function the production
service calls. There is no cutover, no parity rehearsal, and no change to `RULES.md` authority.

## Exit evidence (recorded 2026-11-22)

Observed on branch `alchemy/phase-1-class-a` with PostgreSQL 19: `vitest run --project repository` passes
(845 tests, 1 skipped: the opt-in Swarm pool test); `fmt:check`, `lint`, `tsc`, `boundary:test`,
`boundary:lint`, `skills:check`, and `fallow:audit` (no finding introduced) pass. All 34 rule IDs are
named by a story or authorization test in the new files. No aggregate moved, and no module's
`mod.ts` exports a model, so production loads no Alchemy code.

| Module | Rules | Shared `decide` with production | Stated without a shared `decide` |
| --- | --- | --- | --- |
| Tax | 5 | TAX-CALC-1/2, TAX-RATE-1 (`tax-decisions.ts`, `taxOn`) | TAX-AUTH-1 (service); TAX-PROD-1 (a foreign key owns it; a Product aggregate would be class B) |
| Sales | 6 | SAL-ORDER-1, SAL-ORDER-3 (quotation owner check), SAL-CUST-2, SAL-QUOT-1, SAL-QUOT-2 transitions | SAL-AUTH-1 (service); SAL-ORDER-3 tenant-local references (composite keys); the `expireQuotations` sweep (one set-based UPDATE) |
| Procurement | 7 | PRC-PO-1, PRC-PO-2 (`deriveTotal`), PRC-REL-1 (`decideApprovalCover`) | PRC-AUTH-1 (service); PRC-PO-4, PRC-DOC-1, PRC-PRICE-1 (constraints and the render function) |
| Inventory | 9 | INV-STOCK-1/2/4/5 (partly), INV-VAL-3, INV-OPEN-2/3 (`stock-rules.ts`, `valuation.ts`, `opening-stock-rules.ts`) | INV-AUTH-1, INV-OPEN-1 (service); PostgreSQL `reserveStock` keeps its guarded UPDATE; the branch bound of INV-STOCK-5 (a foreign key) |
| Billing | 4 | BIL-SET-1 (`decideSettlement`), BIL-BILL-2 (`firstUncoveredExcess`) | BIL-RENDER-1/2 (staging and constraints) |
| Settlement | 1 | SET-BANK-1 (`parseBankStatement`) | none |
| Accounting | 2 | ACC-OPEN-2 (`firstControlAccountLine`) | ACC-OPEN-4 (ledger triggers) |

So 22 of 34 rules share a `decide` with production or already had one, and 12 are stated against the
production service or against constraints. The exit evidence asked that each aggregate's `decide` be
the function production calls; that holds for the 22, and the 12 are listed above with the reason.

### Findings to decide or follow up (none changed here)

- **`BIL-RENDER-1` and `ACC-OPEN-4` stay `unenforced` (owner decision, 2026-11-22).** Their stories are weak (one cannot state that
  no runtime composes the worker; the other checks a declaration), and `tooling/modules.ts` fails a
  test that brackets an `unenforced` ID, so these two IDs are named unbracketed in comments.
- **Memory and PostgreSQL can still diverge in three places:** the duplicate rate-period start in Tax
  (primary key in PostgreSQL, a shared pure check in memory), the `expireQuotations` sweep (a story
  mirrors the SQL predicate), and PostgreSQL `reserveStock` (a guarded UPDATE). Each has no
  differential test.
- **`INV-STOCK-2` as written is not how production works:** balances are SQL updates beside the
  movement insert, not folded from the movements. Only the aggregate states the rule literally.
- **Approval gate:** the shared `decideApprovalCover` compares amounts as numbers in minor units where
  the PostgreSQL gate compared strings. Approvals normalizes the stored amount, so the results are
  equal, and `approval-cover.postgres.test.ts` passes unchanged. A malformed amount would now throw
  instead of refuse; no command can produce one.
- **Two small production deviations:** `settle` in Billing converts the open amount before the
  replay check; `createPartyCustomer` in Sales looks up an existing customer before the role check,
  so an invalid-role call reads once more before failing. Outcomes are identical.
- **A defect found, not fixed:** `draftPurchaseOrder` derives its total with its own `major(sum)`, not
  `deriveTotal`, so a total beyond 2^128 minor units throws a `RangeError` defect where other paths
  fail with a `SchemaError`. Reasoned from the code, not run.
- **Not covered by memory layers:** the `SalesDocumentService` and `PurchaseDocumentService`
  capabilities have no memory layer, so only the PostgreSQL tests exercise them.
- **`alchemy` is a test-only dependency** (inherited from phase 0, reported by `fallow:audit`).

## Stop conditions

- Sharing a `decide` changes the result of an existing production test.
- A story needs behavior that production does not have, or production has a behavior the story
  cannot state.
- A rule turns out to need two aggregates, which makes it class B or higher: stop and report it
  instead of widening the model.

## Five views

The views below were written for a phase that cut two aggregates over. The review removed the
cutovers, so their risks (the two cutovers, parity tests, rollback to the tables) do not apply
in this phase and return with the gates `alchemy.rebuild` and `alchemy.host-role`.

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

Both questions were answered in the review (decisions 3 and 4 below).

## Review record

| Date | Reviewer | Outcome | Notes |
| --- | --- | --- | --- |
| 2026-11-22 | Owner | Accepted | Five decisions below |
| 2026-11-22 | Owner | Exit evidence accepted | Phase 1 accepted; PR #90 merges together with it. `BIL-RENDER-1` and `ACC-OPEN-4` stay `unenforced`. The findings above stay open as follow-ups |

Decisions taken in this review:

1. **One `decide` per class A rule**, called by the production service and by the Alchemy
   aggregate's `decide`, so there are not two models that can drift apart.
2. **No cutover in phase 1.** The gates `alchemy.rebuild` and `alchemy.host-role` are not met.
   Exit is 34 stories passing with the shared `decide` in use.
3. **Tax codes stay table-backed** (many foreign keys, `TAX-PROD-1`) and gain stories only.
4. **Supplier prices are read outside the purchase order transaction** (`PRC-DRAFT-1`): accepted,
   because the price is copied onto the order line.
5. **PR #90 merges together with phase 1**, after phase 1 is accepted. The new port enters `main`
   with its first ERP consumer (ADR-0091).
