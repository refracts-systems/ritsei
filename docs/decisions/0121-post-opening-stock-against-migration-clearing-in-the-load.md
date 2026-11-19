# ADR-0121: Post Opening Stock Against Migration Clearing in the Load

- Status: Proposed
- Date: 2026-11-19
- Amends: ADR-0118 (point 2, which said the load posts no journal)
- Compatible with: ADR-0015, ADR-0096, ADR-0117
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Opening stock load: [`./0118-load-opening-stock-at-cutover-without-lots-or-open-positions.md`](./0118-load-opening-stock-at-cutover-without-lots-or-open-positions.md)
> - Migration clearing: [`./0117-load-opening-positions-against-migration-clearing.md`](./0117-load-opening-positions-against-migration-clearing.md)

## Context

ADR-0118 had `loadOpeningStock` post no journal because Accounting had no `migration_clearing`
role. ADR-0117 added the role and says each owner posts its opening items through
`postDocumentEntry`. Until Inventory does, the inventory account is short of the valuation report by
the opening value, and the clearing account cannot reach zero at sign-off.

## Decision

1. **The load posts one journal in its own transaction.** `loadOpeningStock` calls
   `GeneralLedgerService.postDocumentEntry`, dated at the cutoff, with source type
   `inventory.opening_stock_load` and the opening document id, and with reference
   `inventory/inventory.opening_stock_load/<opening id>`. It runs after the load's checks and before
   the position and valuation writes, inside the load's transaction, so a failure after the journal
   rolls the journal back with the stock.
2. **Lines.** Inventory is debited with the value held. `migration_clearing` is credited with the
   source total, which is what the source's control balance ties to. A revaluation difference goes to
   `inventory_adjustment`: a debit when the value held is lower than the source total, a credit when
   it is higher. Zero lines are omitted, and stock with no value posts nothing.
3. **Why this does not double count.** ADR-0118 rejected `inventory_adjustment` as the offset of the
   whole opening value. Only the approved revaluation difference reaches profit and loss now; the
   opening value itself is offset by clearing.
4. **Every valuation entry of the load carries the journal id,** and the result returns it as
   `journalEntryId` (null when nothing was posted). A retry returns the recorded load before the
   post, so it never posts again, and the ledger's reference check backs that up.
5. **Callers need more.** The principal also needs `accounting.documentJournalPost`, the legal entity
   needs a configured `migration_clearing` rule, and the period of the cutoff date must be open. The
   command can now fail with the posting errors `postDocumentEntry` returns.
6. **No backfill.** A load recorded before this change keeps a null journal and replays without
   posting. Valuation entries are immutable, so correcting one is a manual journal, which the
   clearing check then covers.

## Consequences

- After a load, the inventory account equals the valuation report, and the clearing balance is the
  loaded source total, to be offset by the opening journal's clearing line (ADR-0117).
- The revaluation difference is visible in `inventory_adjustment` on the cutover date, beside the
  named approval stored on the position.
- A tenant whose chart came from elsewhere cannot load opening stock until it configures the
  clearing role.

## Alternatives Considered

- **Post the whole opening value to `inventory_adjustment`:** rejected in ADR-0118; it puts the
  opening value in profit and loss.
- **A separate command that posts the clearing entry after the load:** rejected; it leaves a window
  where the ledger and the valuation disagree, and a retry between the two steps needs its own guard.
- **A dedicated opening adjustment role:** rejected; no other posting needs it, and the difference is
  already named by the position's approval metadata.
