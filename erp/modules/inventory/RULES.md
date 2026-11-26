# Inventory Rules

> **Status:** Current rules owned by the Inventory module (ADR-0123). This file wins over ADR text
> for what the module does now; the ADRs named under each rule record why.
>
> **Does not own:** Posting rules and ledger roles ([`financial-ledger.md`](../../../docs/architecture/financial-ledger.md)),
> item identity (Product, [ADR-0097](../../../docs/decisions/0097-move-product-identity-to-a-product-module.md)), or cross-module consistency
> ([`state-and-consistency.md`](../../../docs/architecture/state-and-consistency.md)).

Each rule has an identifier that the test enforcing it names as `[ID]`, in a comment above the test
or in its title; `tests/architecture/modules.test.ts` fails when a rule has no such test or a test
names an unknown rule. A rule no test enforces says
`unenforced`. Change a rule and its test in the same change.

## Stock

### `INV-STOCK-1` Reservations never exceed available stock

Receiving and reserving are atomic. A reservation above available stock fails with `StockUnavailable`
and changes nothing. A reservation is released or fulfilled exactly once.

### `INV-STOCK-2` Stock is the sum of append-only movements

Movements are never updated or deleted; balances and projections are tenant scoped and derived from
them.

### `INV-STOCK-3` One idempotency key names one request

Reusing an idempotency key for different stock fails. A stock correction and its event are published
in one transaction: a retry returns the recorded correction with one event, and a failed messaging
append rolls the correction back.

### `INV-STOCK-4` Unit-of-measure corrections apply once and keep reservations

A normalized UOM correction is applied once per request and preserves reserved stock.

### `INV-STOCK-5` A warehouse's legal entity and branch bound its stock

A receive validates the warehouse's legal entity when supplied, and branch and legal entity scope
apply to every movement. Transfers never cross legal entities.

### `INV-XFER-1` Transfers move stock only at confirmation and completion

Confirmation deducts every source line and completion adds every destination line, each all or
nothing: one unavailable line rolls back every deduction. Confirming and completing need separate
capabilities.

Phase 5 outcome (2026-11-24): this rule stays on its PostgreSQL transaction (ADR-0124). Its staged
Alchemy model was removed on 2026-11-24; it is in git history at `f157dc5b`.

### `INV-AUTH-1` Inventory capabilities are denied by default

A caller without the capability in the tenant is denied, and stock adjustment needs its own
capability.

## Valuation

Why: [ADR-0100](../../../docs/decisions/0100-adopt-moving-average-inventory-valuation.md).

### `INV-VAL-1` Stock is valued at moving average per legal entity and item

A receipt adds its quantity at the document's unit cost. An issue removes the moving-average cost
rounded half up to the cent, and the last units take the remaining value, so rounding never strands
value. A deferred database trigger keeps each valuation equal to the sum of its immutable valuation
entries, and the inventory account equals the valuation report.
Enforced by: `src/valuation.ts` (amounts); the deferred constraint triggers
`inventory_valuation_entry_consistency_trigger` and `inventory_item_valuation_consistency_trigger`
and the immutable-entry trigger `inventory_valuation_entries_immutable_trigger`; property tests in
`tests/valuation.test.ts`; `tests/stock-keeping.postgres.test.ts`.

### `INV-VAL-2` Valued moves are document commands

`StockKeepingService` receives, issues, and counts stock for a source document in one transaction:
it locks balances and valuations in item order, posts one ledger entry for the document (inventory
against the caller's counter role; counts use `inventory_adjustment`), then writes movements,
valuation, and one valuation entry per item carrying the journal id. A document moves an item at
most once, so a retry returns the recorded movement.

### `INV-VAL-3` Unvalued stock is not issued at cost

A valued issue that needs more than the valued quantity fails with `StockValuationUnavailable`
instead of inventing a cost.
Enforced by: `src/valuation.ts`; property test in `tests/valuation.test.ts`;
`tests/stock-keeping.postgres.test.ts`.

## Opening stock

Why: [ADR-0117](../../../docs/decisions/0117-load-opening-positions-against-migration-clearing.md),
[ADR-0118](../../../docs/decisions/0118-load-opening-stock-at-cutover-without-lots-or-open-positions.md),
[ADR-0121](../../../docs/decisions/0121-post-opening-stock-against-migration-clearing-in-the-load.md).
These replace ADR-0100 point 4.

### `INV-OPEN-1` Loading opening stock needs the capability in the tenant

### `INV-OPEN-2` The load carries on-hand stock only

Tracked stock is carried only with its lots or serials on the line (ADR-0131 decision 6): a line the
source declares lot or expiry tracked, without identity, fails with `OpeningStockLotTrackingUnsupported`,
and an item tracked in Inventory with no or wrong identity fails with `TrackedIdentityRequired`,
`TrackedIdentityInvalid`, or `TrackedIdentityUnavailable` (a serial already in stock), before anything
is posted. Declared reservations and goods in transit are rejected rather than dropped.

### `INV-OPEN-3` A revalued line needs an approval

A line that states a moving-average value needs the revaluation approval, and only such a line
carries it; a line without one is held at its source value.

### `INV-OPEN-4` An opening is loaded once

An `openingId` is one approved bundle. Loading it again with the same warehouse, cutoff date,
lines, and lots or serials returns the recorded load and journal without posting again; any change fails with
`OpeningStockConflict`. An item already opened in the warehouse fails with
`OpeningStockAlreadyLoaded`.

### `INV-OPEN-5` The load posts its journal against migration clearing

Inside the load's transaction and before the position writes, the load posts one journal dated at
the cutoff with reference `inventory/inventory.opening_stock_load/<openingId>`: inventory is debited
with the value held, `migration_clearing` is credited with the source total, and the revaluation
difference goes to `inventory_adjustment` (a debit when the value held is lower, a credit when
higher). Zero lines are left out and stock with no value posts nothing. A failure later in the load
rolls the journal back with it.

### `INV-TRK-1` A tracked item moves only with its lot or serial

An item is `none`, `lot`, or `serial` tracked (ADR-0131); the mode changes only while the item has no
stock and no movement (`ItemTrackingLocked`). `receiveValued` and `issueValued` of a lot item need
lots whose quantities add up to the line, and of a serial item exactly as many distinct serials as
units; a missing, mismatched, or repeated identity fails with `TrackedIdentityRequired` or
`TrackedIdentityInvalid`, and an unknown lot, a lot without enough stock, a serial not in stock in
the warehouse, or a serial received while already in stock fails with `TrackedIdentityUnavailable`,
before anything is written. An untracked item takes no identity. A serial is unique per item, always
one unit, and is `in_stock`, `issued`, or `returned_to_supplier` (a purchase return); stock per lot
sums to the item's balance. Valuation is unchanged. A movement of a tracked item written any other
way (counts, transfers, adjustments) is refused by the database
(`tracked_item_requires_identity`). Expiry is stored, not enforced.
