# ADR-0104: Adopt Valued Procure-to-Pay Documents

- Status: Proposed
- Date: 2026-10-20
- Amends: None
- Compatible with: ADR-0047, ADR-0096, ADR-0100, ADR-0102, ADR-0103
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - ERP parity plan, Phase 6: [`../proposals/erp-module-parity-plan.md`](../proposals/erp-module-parity-plan.md)
> - Procurement goods receipt boundary: [`./0047-define-procurement-goods-receipt-boundary.md`](./0047-define-procurement-goods-receipt-boundary.md)

## Context

Procurement confirms purchase orders and records goods receipts, but receipts carry no value,
nothing bills a supplier, and nothing pays one. Phase 6 asks for supplier prices, purchase order
approval, three-way matching, purchase returns, payables aging, and stock valuation that reconciles
with the ledger.

## Decision

1. **Procurement owns purchasing documents** through `PurchaseDocumentService`: supplier prices per
   supplier account and product; priced purchase orders with tax terms per line, stored in the
   existing purchase order tables; release with threshold approval (ADR-0103); valued receipts; and
   purchase returns as their own numbered correction documents (`RET/`), never by editing receipts.
2. **Receipts value stock at the purchase price.** A valued receipt records the receipt evidence
   (the existing over-receipt guard still applies) and receives stock against goods received not
   invoiced at the purchase order price (ADR-0100). A return issues the same goods at the purchase
   price, so goods received not invoiced clears exactly; the last units on hand take the remaining
   value.
3. **Billing matches three ways.** A supplier bill may bill per order line at most what was
   received, net of returns and earlier bills net of supplier credits, unless an approved variance
   covers the excess value. It posts goods received not invoiced at the purchase price, the
   difference to purchase price variance, input tax, and the payable.
4. **Valued purchasing covers stockable products.** Consumables and services are rejected until an
   expense posting role exists.
5. **Matching data is a Procurement query.** Billing reads ordered, received, and returned
   quantities and prices through `getMatching`; it never reads Procurement tables.

## Consequences

- With every receipt, return, and bill on these paths, goods received not invoiced is zero when all
  received goods are billed, stock value equals the inventory account, and payables aging equals the
  payables account (`tests/chains/procure-to-pay.postgres.test.ts`).
- A supplier bill line records the received value it cleared from goods received not invoiced
  (`matched_value`). A supplier credit note returns that value pro rata, the last units taking the
  remainder, and reverses the price variance the bill booked, so crediting a whole bill restores
  goods received not invoiced and purchase price variance to their balances before the bill.
- The existing unvalued receipt command remains for current flows; tenants that value stock use the
  valued command.

## Alternatives Considered

- **Billing reads receipts directly:** rejected; receipts are Procurement's facts.
- **Returns as negative receipts:** rejected; receipt evidence is immutable and a return is a
  separate business event.
