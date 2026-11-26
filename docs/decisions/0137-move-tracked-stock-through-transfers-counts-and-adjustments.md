# ADR-0137: Move Tracked Stock Through Transfers, Counts, and Adjustments

- Status: Accepted
- Date: 2026-11-26
- Amends: ADR-0131 (point 8, transfers, counts, and adjustments of a tracked item are refused)
- Compatible with: ADR-0100, ADR-0101, ADR-0131
- Supersedes: None
- Superseded by: None
- Changes: `erp/modules/inventory/RULES.md`

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Lot and serial tracking: [`./0131-adopt-lot-and-serial-tracking.md`](./0131-adopt-lot-and-serial-tracking.md)
> - Moving-average valuation: [`./0100-adopt-moving-average-inventory-valuation.md`](./0100-adopt-moving-average-inventory-valuation.md)
> - Inventory rules: [`../../erp/modules/inventory/RULES.md`](../../erp/modules/inventory/RULES.md)

## Context

ADR-0131 lets a tracked item move only with its lot or serial, through valued receipts, deliveries,
purchase returns, and the opening load. Transfers between warehouses, stock counts, and adjustments
stay refused: the database rejects a tracked movement without identity (`tracked_item_requires_identity`),
which reaches a caller as a database failure instead of a typed error. A warehouse that holds serial
or lot stock cannot move it between sites or correct it after a count, so tracking cannot be used
beyond the first receipt and delivery.

## Decision

1. **A refused tracked movement fails with a typed error.** Until a path takes identity, a transfer,
   count, or adjustment of a tracked item without identity fails with `TrackedIdentityRequired`
   before any write, never as a database failure.
2. **A transfer line of a tracked item names its lots with quantities, or its serials**, when the
   transfer is created, and the lines are stored with the transfer. A line of an untracked item takes
   none.
3. **A tracked line moves at confirm, in one step; there is no in-transit state.** Confirm issues the
   lot quantities or serials from the source and receives them in the destination in the same
   transaction, so a serial is never between warehouses and the stock per lot keeps summing to the
   item's balance in each warehouse. Complete moves the untracked lines as before and leaves tracked
   lines as confirm wrote them. A serial stays `in_stock`; only its warehouse changes. No serial status
   is added for transit.
4. **A count of a lot item is per lot.** The count line carries the counted quantity of each lot the
   warehouse holds or finds; the difference of each lot is its own movement, a surplus a receipt and a
   shortage an issue, with the valuation of ADR-0100 applied to each. A lot counted for the first time
   may carry its expiry.
5. **A count of a serial item is a list of the serials found.** A serial in the books but not found
   becomes `missing` (a new serial status, with the count as its source) and leaves the stock; a
   `missing` serial found later is received back by a count that lists it. A serial found that is
   neither in stock nor `missing` is refused with `TrackedIdentityUnavailable`: a new unit enters by a
   receipt document, not by a count.
6. **An adjustment of a tracked item follows the same rule as a count**: it names the lots it adds or
   removes (a gain may open a lot) or the serials it removes (to `missing`) or restores (from
   `missing`). A quantity-only adjustment of a tracked item fails with `TrackedIdentityRequired`.
7. **Reservations still hold a quantity**, not a lot or serial, and expiry is still stored and not
   enforced (ADR-0131 point 8 otherwise stands). A reservation does not block a tracked transfer
   beyond the available quantity rule that already applies.
8. **Valuation does not change.** A transfer moves stock within a legal entity, so it posts nothing
   (ADR-0101); counts and adjustments post their differences at moving average (ADR-0100).

## Alternatives Considered

- **An in-transit state for lots and serials.** Rejected by the owner: it needs a transit status and a
  transit balance for no decision that needs it yet; one-step movement keeps every state a warehouse
  holds.
- **Count lot items only.** Rejected by the owner: a serial item would remain uncountable.
- **Keep adjustments refused.** Rejected by the owner: a count alone would then be the only
  correction, and a lost serial would wait for the next count.
- **Pick lots automatically at confirm (first-expired-first-out).** Not in this decision: the
  transfer names its lots.

## Consequences

### Positive

- Tracked stock can be moved between sites and corrected, with its identity kept.
- A refused tracked movement is a typed error a caller can act on.

### Negative

- A new serial status `missing`, a table for transfer line identity, and a count that writes several
  movements per item.
- A tracked transfer cannot be confirmed now and received later; the destination must be ready at
  confirm.

### Risks

- A count that writes per-lot movements for one item can disagree with the item's balance if a lot is
  missed. Mitigation: the lots of a count line must add up to the counted quantity of the item, and a
  database test checks that the stock per lot equals the balance after each operation.

## Owner decisions (2026-11-26)

The owner accepted the recommendations: no in-transit state (decision 3), counts per lot and by serial
list (decisions 4 and 5), and adjustments under the same identity rule (decision 6).

## Validation

- A tracked transfer moves its lots and serials from source to destination at confirm; the lot
  balances and serials in both warehouses are right and the stock per lot equals each balance.
- A transfer of a tracked item without identity, or of a serial not in the source, fails with a typed
  error before anything is written.
- A count writes a movement per lot difference and marks an unfound serial `missing`; an unknown
  serial is refused.
- An adjustment of a tracked item without identity fails with `TrackedIdentityRequired`.
