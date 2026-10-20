# ADR-0101: Coordinate Sales Delivery with Inventory

- Status: Proposed
- Date: 2026-10-20
- Amends: None
- Compatible with: ADR-0015, ADR-0047, ADR-0091, ADR-0100
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - ERP parity plan, decision D4: [`../proposals/erp-module-parity-plan.md`](../proposals/erp-module-parity-plan.md)
> - Procurement goods receipt boundary: [`./0047-define-procurement-goods-receipt-boundary.md`](./0047-define-procurement-goods-receipt-boundary.md)

## Context

Order-to-Cash needs partial deliveries: what was delivered per order line, and the stock issue with
its cost. Odoo puts pickings in Inventory; SAP puts deliveries in Sales. ADR-0047 gave Procurement
the receipt evidence and Inventory the movement.

## Decision

1. **Sales owns delivery evidence**: numbered deliveries (`DO/<year>/<n>` per legal entity) with
   lines per order line, and the cumulative guard that delivered quantity never exceeds ordered
   quantity. The order row lock serializes deliveries of one order. Confirmed order lines stay
   immutable; delivered quantity is the sum of delivery lines.
2. **Inventory owns the movement and its value**: a valued issue at moving-average cost against cost
   of goods sold (ADR-0100), for stockable products only.
3. **The Order-to-Cash coordinator composes them.** `OrderToCashService.deliverOrder` in the
   `process` module records the delivery and issues the stock in one transaction. Sales does not
   call Inventory directly, because Inventory depends on Accounting (for valuation postings) and
   Accounting depends on Sales (for the existing revenue posting), so Sales → Inventory would close
   a dependency cycle. This mirrors ADR-0047's split of evidence and movement while keeping the
   module graph acyclic.
4. **Retries are idempotent.** The caller may pass the delivery id; a retried delivery returns the
   recorded delivery, and Inventory replays the recorded issue for the same source.

## Consequences

- Billing invoices delivered quantities (ADR-0102), so services are delivered through the same
  delivery document without a stock movement.
- When the order-specific revenue posting leaves Accounting, Sales may call Inventory directly and
  the coordinator becomes a thin wrapper.

## Alternatives Considered

- **Delivery in Inventory:** rejected; Sales owns the order and its fulfillment state.
- **Sales calls Inventory directly:** rejected for now because of the dependency cycle above.
