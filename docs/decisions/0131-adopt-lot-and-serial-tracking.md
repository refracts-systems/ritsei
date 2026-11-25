# ADR-0131: Adopt Lot and Serial Tracking

- Status: Accepted
- Date: 2026-11-25
- Amends: ADR-0118 (point 5, lot and expiry under source authority)
- Compatible with: ADR-0015, ADR-0100, ADR-0101, ADR-0104, ADR-0118
- Supersedes: None
- Superseded by: None
- Changes: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Opening stock without lots: [`./0118-load-opening-stock-at-cutover-without-lots-or-open-positions.md`](./0118-load-opening-stock-at-cutover-without-lots-or-open-positions.md)
> - Moving-average valuation: [`./0100-adopt-moving-average-inventory-valuation.md`](./0100-adopt-moving-average-inventory-valuation.md)
> - Delivery and stock: [`./0101-coordinate-sales-delivery-with-inventory.md`](./0101-coordinate-sales-delivery-with-inventory.md)
> - Valued procure-to-pay documents: [`./0104-adopt-valued-procure-to-pay-documents.md`](./0104-adopt-valued-procure-to-pay-documents.md)
> - Inventory rules: [`../../erp/modules/inventory/RULES.md`](../../erp/modules/inventory/RULES.md)

## Context

Stock is a quantity per item and warehouse. ADR-0118 point 5 says the opening load accepts only
`tracking: none` and fails anything else, so "lot" and "expiry" exist as input words and not as
identity: no table holds a lot, a serial number, or what a movement moved by identity. Receipts
(Procurement) and deliveries (Sales) carry quantities only. The mockup needs a serial lookup
(product, customer, delivery date) as the basis of a warranty claim (G-14), and products that cannot
be received or delivered without a lot or serial.

## Decision

1. **Inventory owns the tracking mode of an item**: `none` (default), `lot`, or `serial`, set when
   the item is registered for a product and changed only while the item has no stock and no movement.
   Product is not changed; whether a product is tracked is a stock fact.
2. **A lot is an identity of an item**: a trimmed code unique per `(tenant, item)` and an optional
   expiry date, created by the first receipt that names it. Stock is then held per warehouse, item,
   and lot, and the item's total stays the sum.
3. **A serial is one unit**: a trimmed code unique per `(tenant, item)`, always quantity one. Its
   status is `in_stock` (in a warehouse), `issued` (to a source document), or `returned_to_supplier`.
   A unit cannot be received twice while in stock and cannot be issued unless it is in stock in that
   warehouse.
4. **Receipt and delivery lines of a tracked item must carry the identity.** A valued receipt line
   of a lot item names a lot code (and expiry for a new lot); of a serial item it lists exactly as many
   distinct serials as its quantity. A delivery line names the lot to issue (quantities per lot
   adding up to the line) or the serials. Inventory validates and stores the identity on the movement,
   with the receipt or delivery as its source; Procurement and Sales keep their documents unchanged
   except that the line input gains the identity, and a missing, duplicate, unknown, or out-of-stock
   identity fails with a typed Inventory error before anything is written. A purchase return of a
   tracked item names what goes back, by the same rule.
5. **Valuation does not change.** Value stays moving average per item and legal entity (ADR-0100);
   a lot or a serial carries no cost of its own in this decision.
6. **Opening stock of a tracked item is loaded by identity**: the line lists lots with quantities
   summing to the line, or the serials, and an item that is not `none` no longer fails with
   `OpeningStockLotTrackingUnsupported`. A tracked line without identity does.
7. **Serial lookup is a composed read.** Inventory answers a serial with its product, status, and the
   source document that issued it; Documents joins the delivery to its order and customer and returns
   `{ product, serial, customer, deliveryDate, deliveryNumber }`, each part authorized by its owner.
   That is the base for G-14.
8. **What stays out of the first version**: transfers, counts, and adjustments of a tracked item are
   refused with `TrackedItemUnsupported` rather than moved without identity; reservations hold a
   quantity, not a specific lot or serial; stock is not picked automatically (no first-expired-first-out);
   expiry is stored and returned, not enforced.

## Alternatives Considered

- **Tracking on the product.** Rejected: the product catalog has no stock facts, and the mode must be
  locked by stock existing.
- **A cost per lot or serial.** Rejected: it changes ADR-0100 and the ledger postings for no
  decision that needs it yet.
- **Let Sales and Procurement store the identity.** Rejected: the invariants (unique, in stock) are
  Inventory's, and two copies would drift.
- **Move tracked stock through transfers and counts now.** Rejected for size; a refusal is safe,
  silent loss of identity is not.

## Consequences

### Positive

- A serial answers who bought it and when; a lot answers what was received together.
- Tracked items cannot be received or shipped without identity.

### Negative

- New inventory tables (lots, lot balances, serial units, movement identity), and the line inputs
  of three commands change for tracked items only.
- Transfers, counts, and adjustments of tracked items are unavailable until a later decision.

### Risks

- A tracked item with stock cannot be switched on later; existing stock needs a load by identity or
  a new item. Mitigation: the refusal is explicit and the opening load takes identity.
- Serial codes typed by hand have typos. Mitigation: they are exact strings; the lookup returns
  nothing for a near miss, never a guess.

## Owner decisions (2026-11-25)

The owner accepted the recommendations:

1. Inventory owns the tracking mode.
2. An item that has stock is not switched to a tracked mode.
3. Transfers, counts, and adjustments of a tracked item are refused in the first version.
4. Expiry is stored and returned, not enforced.
5. The caller names the lot to issue; there is no automatic picking.
6. A serial is a trimmed, case-sensitive string of up to 64 characters, unique per item.

## Validation

- A lot item cannot be received or delivered without a lot, nor a serial item without exactly its
  quantity of distinct serials; a duplicate or an unknown identity fails and writes nothing.
- A serial is never received twice while in stock and never issued unless in stock in the warehouse.
- Stock per lot sums to the item's balance; valuation entries are unchanged by identity.
- The serial lookup returns product, customer, and delivery date, and an owner that denies the caller
  leaves its part out.
- An item with stock or a movement cannot change its tracking mode; a transfer of a tracked item is
  refused.
