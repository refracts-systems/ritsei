# ADR-0118: Load Opening Stock at Cutover Without Lots or Open Positions

- Status: Accepted
- Date: 2026-11-19
- Amends: ADR-0100 (point 4, how opening stock is received)
- Compatible with: ADR-0015, ADR-0096, ADR-0101
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Moving-average valuation: [`./0100-adopt-moving-average-inventory-valuation.md`](./0100-adopt-moving-average-inventory-valuation.md)
> - Migration-first design reference: [`../architecture/reference/migration-first-erp-comparison.md`](../architecture/reference/migration-first-erp-comparison.md)

## Context

A customer who adopts RITSEI continues the business in it, so each warehouse starts with the stock
it holds at the cutoff. ADR-0100 says opening stock is received with a unit cost against inventory
adjustment. That posts the whole opening value to a profit-and-loss account, cannot carry a source
total that does not divide into a unit cost, and gives the administrator no way to show where the
number came from.

The [migration-first reference](../architecture/reference/migration-first-erp-comparison.md) says
batch identity must survive or stay under source authority, and that reservations and goods in
transit need an explicit cutover treatment. Its reviewer decisions, still on an unmerged branch,
propose that every opening stock item is loaded by Inventory against a `migration clearing` account
that must be zero at sign-off, and that stock on another valuation method is revalued once to moving
average at the cutoff as a named, approved opening adjustment. Neither the reference nor those
proposals chooses between rejecting and carrying reservations and goods in transit; this ADR does.
Accounting has no migration clearing role at this snapshot, so Inventory cannot offset against it
yet.

## Decision

1. **A dedicated command loads opening stock.** `StockKeepingService.loadOpeningStock` takes one
   warehouse, an opening document id, the cutoff date, and per-item lines with a quantity and the
   source's total value, not a unit cost, so source control totals tie exactly. The cutoff date is
   stored on each position and returned so the accounting owner posts at the right date. It runs behind the new capability
   `inventory.opening_stock.load`, in one transaction that writes the balance, movement, valuation,
   and one receipt valuation entry per item, as `receiveValued` does.
2. **It posts no journal.** The result states `valueToClear`, the source total the accounting
   owner offsets against the migration clearing account, the revaluation `adjustment`, and the
   `value` held. Until Accounting adds the clearing role and posts that entry, the inventory account
   does not equal the valuation report for opening stock; the difference is exactly `value`. The
   command never posts to `inventory_adjustment` instead. That role is profit and loss, and its
   entry would be counted twice once the clearing entry exists.
3. **The revaluation is a stated, approved input.** A line may state `movingAverageValue`, the
   total value at moving average the owner approved. The valuation entry records that value. The
   difference from the source value is stored on the opening position with a name, approver,
   approval time, and reference, which are required exactly when any line is revalued. RITSEI does
   not compute the average of a source's valuation layers and does not carry those layers.
   Revaluation happens only here, so it is once per warehouse and item.
4. **A warehouse and item are opened once.** `inventory.opening_stock_positions` is unique per
   tenant, warehouse, and item, and a second document for the same pair fails with
   `OpeningStockAlreadyLoaded`. The load locks the item's valuation row before it checks, so two
   concurrent loads of one item run one after the other and the second gets that error. A retry of
   the same document returns the recorded load. The same document with a different warehouse,
   cutoff date, item, quantity, or value fails with `OpeningStockConflict`: changed content after
   approval is an exception, not a replay. The valuation entries use the source type
   `inventory.opening_stock_load`, distinct from the `inventory.opening_stock` earlier opening
   receipts used, so only loads that have a position are swept up by the clearing entry.
5. **Lot and expiry stay under source authority.** Each line must state `tracking`. Any value other
   than `none` fails with `OpeningStockLotTrackingUnsupported`. Inventory builds no batch identity
   in this decision; the affected stock is kept in the source until a pilot that needs it
   justifies that work.
6. **Reservations and goods in transit are rejected, never dropped.** Quantities are physical on
   hand. Each line states `reservedQuantity` and `inTransitQuantity`, and a nonzero value fails
   with `OpeningStockReservationsNotCarried` or `OpeningStockInTransitNotCarried`. A source
   reservation belongs to an open order, so the order carries it and reserves through
   `reserveStock` after the load. Goods in transit continue as a stock transfer: load them at the
   origin warehouse, then create and confirm the transfer, which takes them out of on-hand stock as
   every confirmed transfer does; their value stays in the legal entity's valuation. A source that
   reports either quantity must resolve it through those owners before the load passes.

## Consequences

- The migration can load stock and have its value, source total, and revaluation approval read back
  from Inventory. Accounting owns the next step: a `migration clearing` role and an entry that
  offsets `valueToClear` and books the adjustment. Until then a sign-off that compares the inventory
  account to the valuation report reports the opening stock as the difference.
- The opening position is a new inventory-owned table with database checks for quantity, amounts, and
  approval metadata. It is not made immutable by a trigger; the load is the only writer.
- The unique constraint is the last guard behind the valuation row lock; it relies on the platform
  transaction's default isolation, under which the second load reads the first one's commit.
- The command does not check that the warehouse has no earlier movements; loading after live stock
  is an operator decision the cutover runbook must prevent.
- `receiveValued` remains valid for ordinary valued receipts. It is no longer the path for opening
  stock.

## Alternatives Considered

- **Post opening stock to `inventory_adjustment` (ADR-0100):** rejected; it puts the opening value in
  profit and loss and double counts with a later clearing entry.
- **Add the clearing role to Accounting here:** rejected for this change; Accounting owns its roles
  and its opening-balance design, and another branch owns that work.
- **Carry reservations and transit as reservations and transfers inside the load:** rejected; open
  orders and transfers are open processes with their own owners and would be created twice.
- **A separate revaluation command after the load:** rejected; a value-only entry does not fit the
  movement-backed valuation entries, and a second step would leave an unrevalued window.
- **Per-batch opening stock now:** rejected; batch identity needs its own owner and valuation
  treatment, and no pilot requires it yet.
