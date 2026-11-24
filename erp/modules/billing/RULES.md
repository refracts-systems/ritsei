# Billing Rules

> **Status:** Current rules owned by the Billing module (ADR-0123). This file wins over ADR text for
> what the module does now. It covers customer invoices, supplier bills, credit notes, settlement of
> open amounts, and invoice rendering staging; rendering architecture is owned by
> [`document-rendering.md`](../../../docs/architecture/document-rendering.md).

Each rule has an identifier that the test enforcing it names as `[ID]`, in a comment above the test
or in its title; `tests/architecture/modules.test.ts` fails when a rule has no such test or a test
names an unknown rule. A rule no test enforces says `unenforced`.

Why: [ADR-0110](../../../docs/decisions/0110-issue-invoices-as-immutable-numbered-artifacts-and-send-by-communication.md),
[ADR-0122](../../../docs/decisions/0122-stage-invoice-rendering-before-activation.md).

### `BIL-RENDER-1` Invoice rendering is staged, not active

The render job, its migration, the artifact store, and the candidate worker exist for evaluation in
disposable nonproduction databases. No production runtime composes the worker, enqueues it from
invoice posting, exposes an artifact route, or sends customer email; the browser print sheet stays.
This is unenforced by a test; review of runtime composition is the check.

### `BIL-RENDER-2` One immutable, tenant-scoped artifact per issued invoice

PostgreSQL enforces the render input and artifact integrity: the artifact binds the invoice, snapshot
checksum, render fingerprint, versioned assets, renderer version, and output checksum, and staging
needs its capability.

## Documents, customer invoices, and open amounts

Why: [ADR-0095](../../../docs/decisions/0095-adopt-gapless-document-numbering.md),
[ADR-0102](../../../docs/decisions/0102-split-billing-and-settlement.md),
[ADR-0119](../../../docs/decisions/0119-date-tax-rates-with-periods-on-the-tax-code.md).

### `BIL-DOC-1` Every billing document is numbered, taxed, and posted in one transaction

A document gets a gapless number per legal entity and kind (`INV/`, `CN/`, `BILL/`, `DN/`), tax from
Tax at its tax date (the document date, or the credited document's date for a credit note), and one
journal posted at the document date; its open amount starts at its total. A repeated document id
returns the posted document.

### `BIL-INV-1` A customer invoice bills what was delivered and not yet invoiced

`invoiceSalesOrder` (`billing.customer_invoice.create`) locks the order, requires it to be confirmed
(`SalesOrderInvalidState`), and invoices each line's delivered quantity less quantity already on
customer invoices, at the order line's price and tax code; with nothing left it fails with
`NothingToInvoice`, so of two simultaneous invoices for the same deliveries only one posts. The
journal debits `receivable` with the total and credits `revenue` with the subtotal and `output_tax`
with the tax.

Phase 5 outcome (2026-11-24): this rule stays on its PostgreSQL transaction (ADR-0124). The staged
Alchemy model is test-only evidence, not a plan to move it.

### `BIL-SET-1` A settlement never takes more than the open amount

`applySettlement` (`billing.settlement.apply`) lowers a document's open amount by the settled amount
and records the source (a Settlement payment or a credit note). More than the open amount fails with
`SettlementExceedsOpenAmount`; the same source again returns the document when the amount is the
same and fails with `SettlementConflict` otherwise.

### `BIL-OPEN-1` Open items are as of a date

`listOpenItems` reports each document's total less the settlements dated on or before the as-of
date, which is what Settlement's aging uses, so aging at a date equals the control account at that
date.

## Supplier bills and credit notes

Why: [ADR-0102](../../../docs/decisions/0102-split-billing-and-settlement.md),
[ADR-0103](../../../docs/decisions/0103-adopt-threshold-approvals-with-separation-of-duties.md),
[ADR-0104](../../../docs/decisions/0104-adopt-valued-procure-to-pay-documents.md).

### `BIL-BILL-1` A supplier bill is matched against received, returned, and billed quantity

`billPurchaseOrder` (`billing.supplier_bill.create`) locks the confirmed purchase order and, per
line, treats as billable the received quantity less returned less net billed (billed on supplier
bills less credited on supplier credit notes), from Procurement's matching view. A line not on the
order, or more than billable without a covering variance approval, fails with
`BillExceedsReceipt`. A repeated bill id returns the posted bill.
Enforced by: `src/matching.ts` (`matchBill`); property tests in `tests/matching.test.ts`; the
procure-to-pay chain test.

Phase 5 outcome (2026-11-24): this rule stays on its PostgreSQL transaction (ADR-0124). The staged
Alchemy model is test-only evidence, not a plan to move it.

### `BIL-BILL-2` Billing beyond receipt needs an approved variance for that bill

Excess quantity is valued at the bill's price and needs an approved
`billing.supplier_bill_variance` request for the bill id whose amount is at least that value; the
approver must not be the requester.

### `BIL-BILL-3` A supplier bill posts GRNI at the purchase price and the rest to variance

The journal debits `goods_received_not_invoiced` with the matched quantity at the purchase order
price, debits (or credits) `purchase_price_variance` with the subtotal less that matched value,
debits `input_tax` with the tax, and credits `payable` with the total.

### `BIL-CREDIT-1` A credit note credits at most what is left and reverses its document

`creditInvoice` (`billing.credit_note.create`) credits an invoice or supplier bill line by line,
never more than the document quantity less earlier credits (`CreditExceedsInvoice`); a credit note
cannot itself be credited. It reverses the document's journal (a supplier credit reverses GRNI at
the matched value, the price variance, and input tax), is applied to the document up to its open
amount with any remainder left open, and is idempotent by credit note id. Credited supplier
quantity becomes billable again; a customer credit note returns no stock and does not make
delivered quantity invoiceable again.
Enforced by: `src/matching.ts` (`creditShare`: the value returned after k credited units is rounded once, so no share is negative and the shares of any split sum to the matched value); the `invoice_lines_matched_value_check` constraint
(`matched_value >= 0`); property test in `tests/matching.test.ts` (total returned); the
procure-to-pay chain test.
