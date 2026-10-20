# ADR-0100: Adopt Moving-Average Inventory Valuation

- Status: Accepted
- Date: 2026-10-20
- Amends: ADR-0035, ADR-0036 (which excluded valuation)
- Compatible with: ADR-0047, ADR-0096, ADR-0097
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - ERP parity plan, decision D3: [`../proposals/erp-module-parity-plan.md`](../proposals/erp-module-parity-plan.md)
> - Posting rules and the ledger: [`./0096-adopt-posting-rules-and-legal-entity-ledger.md`](./0096-adopt-posting-rules-and-legal-entity-ledger.md)

## Context

Inventory counts units but holds no value, so cost of goods sold, stock value, and the inventory
account cannot reconcile. The flagship segment (distribution and trading) values stock at moving
average. Delivery, goods receipt, returns, and stock counts all need to move stock and its value in
one transaction with the ledger.

## Decision

1. **Inventory owns valuation**, per legal entity and item (the warehouse's legal entity), as a
   quantity and a value. A receipt adds its quantity at the document's unit cost. An issue removes
   the moving-average cost, rounded half up to the cent; the last units take the remaining value, so
   rounding never strands value.
2. **Valued moves are document commands.** `StockKeepingService` receives, issues, and counts stock
   for a source document (`type`, `id`) in one transaction: it locks balances and valuations in item
   order, posts one ledger entry for the document through posting roles (receipt: inventory against
   goods received not invoiced or inventory adjustment; issue: cost of goods sold or inventory
   adjustment against inventory; count: inventory adjustment), then writes movements, valuation, and
   one valuation entry per item with the journal id. A document moves an item at most once, so a
   retried command returns the recorded movement.
3. **Valuation is provable from stored facts.** A deferred database trigger keeps each valuation equal
   to the sum of its immutable valuation entries, as on-hand stock already equals its movements.
4. **Unvalued stock cannot be issued at cost.** Stock received through the legacy unvalued receive
   path has no value, so a valued issue that needs more than the valued quantity fails with
   `StockValuationUnavailable` instead of inventing a cost. Opening stock is received with a unit
   cost against inventory adjustment.
5. **Inventory depends on Accounting** for posting and on Product for registering stock items.

## Consequences

- The inventory account equals the valuation report whenever every stock change goes through
  valued commands; the procurement receipt moves to the valued path with the purchase price.
- Valuation is per legal entity, not per warehouse; transfers within a legal entity do not change
  value. Landed costs, FIFO, and standard cost stay out until a pilot needs them.

## Alternatives Considered

- **Accounting computes cost from movements:** rejected; cost depends on locked stock state that
  Inventory owns.
- **Value at invoice time:** rejected; cost of goods sold must follow the physical issue.
