# Proposal: ERP Chains, Next Steps and Merge Plan

> **Status:** Proposal, not yet approved.
>
> **Owns:** The known gaps left by the Phase 4–6 implementation on branch `exp/erp-chains`, the order
> to close them, and how to bring the branch into `master`.
>
> **Does not own:** The phase definitions and decisions D1–D10, which belong to the
> [ERP parity plan](./erp-module-parity-plan.md), and each decision's rationale, which belongs to
> ADR-0095 through ADR-0104 (all Proposed).
>
> **Related documents**
>
> - ERP parity plan, implementation status: [`./erp-module-parity-plan.md`](./erp-module-parity-plan.md)
> - ADR index: [`../decisions/README.md`](../decisions/README.md)
> - Deferred lint rules: [`./anti-slop-deferred-rules.md`](./anti-slop-deferred-rules.md)

## 1. Where the branch stands

`exp/erp-chains` is 11 commits on `master` `143944c`: numbering, ledger, party contacts, product,
valued inventory, tax, Order-to-Cash, Procure-to-Pay, a cleanup, and the anti-slop lint. Two chain
tests prove the exit criteria against PostgreSQL. The diff is 239 files; about 260,000 of the added
lines are Drizzle `snapshot.json` files, so the reviewable source is far smaller.

## 2. Should the branch merge first?

**Not as it stands.** Three reasons:

1. **The ADRs are Proposed.** ADR-0095 to ADR-0104 record decisions the owner has not accepted.
   Merging code ahead of its decisions inverts the repository's rule (code follows an accepted ADR).
   Accepted ADRs are not rewritten afterwards, so edits to the decisions must happen before
   acceptance, not after merge.
2. **Four known gaps are correctness gaps, not features** (section 3). Fixing them after merge puts a
   migration or behavior change on top of shipped numbering and billing.
3. **One reviewable unit is too large.** The commits are already one per module and phase.

**Recommended order**

1. Fix the four correctness gaps on this branch (section 3), one commit each.
2. Review the ten ADRs; change wording on the branch, then flip `Proposed` to `Accepted` in the
   commit that lands them.
3. Open **one PR** for the branch (you asked to avoid PR churn). The repository squash-merges, which
   flattens 11 commits into one; if per-phase history matters, ask for a merge commit or split into
   three PRs: Phase 4 (numbering, ledger, party), Phase 5 (product through settlement), Phase 6
   (approvals through P2P), with lint and cleanup riding on the last. The commits depend on each
   other linearly, so the PRs would stack.
4. After merge, start every item in section 4 from `master` on its own branch.

## 3. Correctness gaps to close before merge

| # | Gap | Change | Exit criteria |
| --- | --- | --- | --- |
| C1 | `POST /procurement/purchase-orders/:id/confirm` still confirms any purchase order without consulting approvals | Make the legacy confirm check the approval policy (reuse `ApprovalService.isRequired` and `getForSubject`) or retire it in favor of `releasePurchaseOrder` | A purchase order above the threshold cannot be confirmed through any command without an approved request; the existing procurement tests still pass |
| C2 | Billing, delivery, receipt, return, and payment numbers use the calendar year (`fiscalYearStartMonth: 1` in five services) | Read the legal entity's fiscal-year start month through an Accounting contract (a `GeneralLedgerService` query) and pass it to numbering | A legal entity with `fiscal_year_start_month = 4` numbers a 2026-03-31 invoice in series 2025 and a 2026-04-01 invoice in series 2026 |
| C3 | A supplier credit note at a price different from the purchase price leaves the difference in goods received not invoiced | Credit lines post at the original billed price, with the purchase-price difference to purchase price variance, mirroring the bill | After bill, receipt, and a credit note at a different price, goods received not invoiced is zero |
| C4 | Aging uses today's open amounts for documents dated up to the as-of date, so an as-of report changes when later payments arrive | Compute open amount as of a date from `invoice_settlements.created_at` and payment dates, or store the settlement date explicitly | Aging as of a past date equals the receivables or payables account balance as of that date, before and after a later payment |

C4 may need a settlement date column (`settled_on`) in `billing.invoice_settlements`, which is a
migration; decide it before merge so the table ships once.

## 4. Follow-up work after merge

Each item gets its own branch from `master`, and an ADR only where noted.

| # | Item | Notes |
| --- | --- | --- |
| F1 | **Web screens for the new documents** | Quotation, delivery, invoice, credit note, receipt, payment, supplier bill, aging, statement. The backend and HTTP routes for sales, billing, settlement, and purchasing documents are partly missing: only party contacts, accounting ledger, product, tax, and inventory valuation have routes today, so F1 starts with `http.ts` for sales documents, billing, settlement, and procurement documents. Follow the shell and design-system contracts; one workspace per module. |
| F2 | **Invoice PDF and email** | PDF through `framework/foundation/document-rendering`; email through the `communication` module, which today only handles `PurchaseOrderConfirmed`. Needs a numbered, immutable rendering per invoice. |
| F3 | **Custom fields (extension points, decision D8)** | Needs an ADR before code. Released extension points join the manifest (ADR-0094). First consumers: Product and Sales documents. |
| F4 | **Credit limit** | Decided in the parity plan to live in Sales and gate order confirmation; reads the customer's open items from Billing. Check for a dependency cycle: Sales cannot import Billing today because Billing depends on Sales. Likely a coordinator in `process` or an Accounting-style query port. |
| F5 | **Indonesian localization (`localization-id`)** | Parity plan Phases 7–8: chart template, PPN codes, withholding, Coretax export, built only through public extension points. Depends on F3. |
| F6 | **Anti-slop rule discussion** | Six rules, in [`anti-slop-deferred-rules.md`](./anti-slop-deferred-rules.md). Independent of the ERP work; one rule and its cleanup per commit. |

## 5. Risks and assumptions

- The chain tests use one fixture shape; multi-currency, several legal entities per tenant, and
  concurrent postings across legal entities are untested beyond the numbering and period locks.
- `exp/erp-chains` was tested on PostgreSQL 19 in WSL. The migration SQL, especially the deferred
  triggers on `billing`, `settlement`, `inventory`, and `approvals`, should be read once by a human
  reviewer before merge.
- Server build status is unverified, as the repository reports for every change.
