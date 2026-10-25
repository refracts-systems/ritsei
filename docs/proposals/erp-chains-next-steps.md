# Proposal: ERP Chains, Next Steps and Merge Plan

> **Status:** The Phase 4–6 branch was merged into `main` in #17 (2026-10-20); section 4 is the
> open follow-up list and is still a proposal until each item gets its own branch.
>
> **Owns:** The known gaps left by the Phase 4–6 implementation (the experiment branch merged in #17),
> the order in which they were closed, and the follow-up work that remains.
>
> **Does not own:** The phase definitions and decisions D1–D10, which belong to the
> [ERP parity plan](./erp-module-parity-plan.md), and each decision's rationale, which belongs to
> ADR-0095 through ADR-0104 (all Accepted).
>
> **Related documents**
>
> - ERP parity plan, implementation status: [`./erp-module-parity-plan.md`](./erp-module-parity-plan.md)
> - ADR index: [`../decisions/README.md`](../decisions/README.md)
> - Deferred lint rules: [`./anti-slop-deferred-rules.md`](./anti-slop-deferred-rules.md)

## 1. Where the branch stood

The experiment branch (`exp/erp-chains`, merged as #17) was 19 commits on `main` `143944c`: numbering, ledger, party contacts, product,
valued inventory, tax, Order-to-Cash, Procure-to-Pay, a cleanup, the anti-slop lint, and four fixes. Three chain
tests prove the exit criteria against PostgreSQL. The diff is 292 files; about 300,000 of the added
lines are Drizzle `snapshot.json` files, so the reviewable source is far smaller.

## 2. Should the branch merge first?

**Yes, once reviewed.** The reasons:

1. **The ADRs are Accepted in this branch.** ADR-0095 to ADR-0104 were reworded to match the code
   and accepted in the same PR as the code, so code and decisions land together. Accepted ADRs are
   not rewritten afterwards.
2. **Four known gaps were correctness gaps, not features** (section 3); they are fixed here so no
   migration or behavior change lands on top of shipped numbering and billing.
3. **One reviewable unit is too large.** The commits are already one per module and phase.

**Order followed**

1. Fixed the four correctness gaps on this branch (section 3), one commit each.
2. Reviewed the ten ADRs, updated their wording to match the code, and accepted them in the PR.
3. Open **one PR** for the branch. The repository squash-merges, which flattens the commits into
   one; if per-phase history matters, ask for a merge commit or split into three PRs: Phase 4
   (numbering, ledger, party), Phase 5 (product through settlement), Phase 6 (approvals through
   P2P), with lint and cleanup riding on the last. The commits depend on each other linearly, so the
   PRs would stack.
4. After merge, start every item in section 4 from `main` on its own branch.

## 3. Correctness gaps closed on this branch

| #   | Gap                                                                             | Resolution                                                                                                                                                                                                       | Proven by                                                                                                                            |
| --- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| C1  | The legacy purchase order confirmation bypassed approval policies               | `confirmPurchaseOrder` consults `ApprovalService` when provided and fails with `PurchaseOrderApprovalRequired`, leaving a pending request                                                                        | `tests/chains/procure-to-pay.postgres.test.ts`                                                                                       |
| C2  | Documents were numbered by calendar year, not the legal entity's fiscal year    | A `FiscalCalendar` port in numbering, implemented by Accounting from the accounting configuration; services no longer pass a month                                                                               | `tests/chains/fiscal-calendar.postgres.test.ts` (April fiscal year)                                                                  |
| C3  | A supplier credit note left the price difference in goods received not invoiced | Bill lines store `matched_value`; a credit note returns it pro rata and reverses the variance. After a bill and a full credit, goods received not invoiced and variance return to their balances before the bill | `tests/chains/procure-to-pay.postgres.test.ts`                                                                                       |
| C4  | Aging changed when later payments arrived                                       | `invoice_settlements.settled_on` and `payment_allocations.allocated_on` record the business date; open items and unallocated payments are computed as of the report date                                         | `tests/chains/order-to-cash.postgres.test.ts` and `procure-to-pay.postgres.test.ts` (aging equals the control account on past dates) |

## 4. Follow-up work after merge

Each item gets its own branch from `main`, and an ADR only where noted.

| #   | Item                                              | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | **Web screens for the new documents**             | Quotation, delivery, invoice, credit note, receipt, payment, supplier bill, aging, statement. The backend and HTTP routes for sales, billing, settlement, and purchasing documents are partly missing: only party contacts, accounting ledger, product, tax, and inventory valuation have routes today, so F1 starts with `http.ts` for sales documents, billing, settlement, and procurement documents. Follow the shell and design-system contracts; one workspace per module. |
| F2  | Partly done: a billing document prints on its own and the browser saves it as a PDF. The rest is decided in [ADR-0110](../decisions/0110-issue-invoices-as-immutable-numbered-artifacts-and-send-by-communication.md) (Accepted): an immutable numbered artifact rendered by a job with `pdfnative` once its activation gates pass, and email through the Communication Platform over SMTP, sent manually first and automatically as a tenant setting later. | Partly done: a billing document prints on its own, with issuer and recipient, and the browser saves it as a PDF, with no renderer dependency. Still open: a numbered, immutable PDF rendering per invoice through `framework/foundation/document-rendering`, and email through the `communication` module, which today only handles `PurchaseOrderConfirmed`.                                                                                                                    |
| F3  | Design proposed in [ADR-0109](../decisions/0109-release-custom-fields-as-an-extension-point.md) (Accepted): owners release a custom-field point per document type; the framework stores definitions and values; kinds are closed. First consumers are Product and the Sales customer. | Needs an ADR before code. Released extension points join the manifest (ADR-0094). First consumers: Product and Sales documents.                                                                                                                                                                                                                                                                                                                                                  |
| F4  | **Credit limit**                                  | Done on a proposed design: [ADR-0108](../decisions/0108-gate-order-confirmation-on-customer-credit-limit.md). Sales owns the limit and gates order confirmation; Billing answers what the customer owes through a port Sales defines.                                                                                                                                                                                                                                            |
| F5  | Sequenced in [ADR-0111](../decisions/0111-sequence-localization-id-on-public-contracts.md) (Accepted): Stage A (COA template, PPN codes, NPWP and NIK schemes) on public contracts; Stage B (withholding, Coretax export) after Stage A; Coretax is not required in the first pilot month. | Parity plan Phases 7–8: chart template, PPN codes, withholding, Coretax export, built only through public extension points. Depends on F3.                                                                                                                                                                                                                                                                                                                                       |
| F6  | **Anti-slop rule discussion**                     | Done: all six rules are decided and enabled, see [`anti-slop-deferred-rules.md`](./anti-slop-deferred-rules.md).                                                                                                                                                                                                                                                                                                                                                                 |
| F7  | **Superseded document routes**                    | Done for two: `POST /sales/quotations` (replaced by `/sales/quotation-documents`) and the unvalued `POST /procurement/purchase-orders/:id/receipts` (replaced by `valued-receipts`) are removed; their services stay for the chain tests. Kept on purpose: `POST /procurement/purchase-orders` and its `confirm`, the only route that returns a consistency token for read-your-writes and a coherent pair with the legacy order flow. `POST /sales/orders`, `confirm` and `cancel` are still used by the web app. |

## 5. Risks and assumptions

- The chain tests use one fixture shape; multi-currency, several legal entities per tenant, and
  concurrent postings across legal entities are untested beyond the numbering and period locks.
- The experiment branch was tested on PostgreSQL 19 in WSL. A code read of the three migrations with
  deferred constraint triggers (`protect_valuation_consistency`, `protect_invoice_open_amounts`,
  `protect_payment_allocations`, 2026-10-24) found them consistent with ADR-0100 and ADR-0102: each
  `SECURITY DEFINER` function pins `search_path`, the checks run at commit and fail closed, and
  posted rows are immutable except the one derived column. Not covered by any test: two transactions
  settling the same invoice at once (the commit-time check should reject the loser), and
  `TRUNCATE`, which no trigger blocks. A human reviewer should still read them; `approvals` and the
  procurement documents add no deferred triggers.
- Server build status is unverified, as the repository reports for every change.
