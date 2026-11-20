# Phase 3: Class C, Cross-Aggregate Rules That Stay Simple

> **Status:** Waits for phase 2 exit
>
> **Roadmap gate:** `alchemy.class-c`
>
> **Related documents**
>
> - Phase index: [`./README.md`](./README.md)
> - Roadmap track: [`../../roadmap/alchemy-domain.md`](../../roadmap/alchemy-domain.md#class-c-alchemyclass-c)
> - Rule classification: [ADR-0124](../../decisions/0124-adopt-alchemy-domain-in-phases.md#rule-by-rule-classification)

## Scope

The 9 class C rules: `ACC-OPEN-1`, `INV-OPEN-4`, `PRC-SUP-1`, `PRC-READ-1`, `PRC-DRAFT-1`,
`SAL-CUST-1`, `SAL-PRICE-1`, `SAL-QUOT-3`, `SET-BANK-2`. Each touches more than one aggregate but
becomes a derived id, a uniqueness claim, or a policy whose delay harms nothing.

## Aggregates

- **May move:** price lists, quotations, and Supplier Accounts, where their open gates close
  (references from table-backed aggregates; quotation conversion into a table-backed order).
- **New:** claim aggregates for customer email per tenant (`SAL-CUST-1`), price list name per tenant
  (`SAL-PRICE-1`), and one Supplier Account per Party relationship (`PRC-SUP-1`).
- **Modelled only:** the opening journal (`ACC-OPEN-1`), because the ledger is not in this track;
  the opening stock load (`INV-OPEN-4`, class D aggregate); bank statements (`SET-BANK-2`, class E
  aggregate).

## Deliverables

1. Derived ids for conversion (`SAL-QUOT-3`), opening loads (`INV-OPEN-4`), opening journals
   (`ACC-OPEN-1`), and statements (`SET-BANK-2`), with stories showing a repeat returns the record.
2. Claim aggregates with a release path for a failed or reversed command.
3. A policy that submits the approval request after a purchase order is drafted (`PRC-DRAFT-1`); release
   still requires the approval (`PRC-REL-1`), so the delay changes nothing a user can do.
4. Replica read-your-writes (`PRC-READ-1`) restated as a receipt wait (`atLeast`), with the same
   fail-closed behavior.
5. Rehearsed cutovers for the aggregates that move, with updated `RULES.md` files.

## Exit evidence

Stories for the nine rules; claims proven under concurrent attempts; cutovers rehearsed.

## Stop conditions

- A claim can be left held by a failed command with no release path.
- A quotation conversion cannot create its order without two authorities in one command.

## Five views

- **Auditor.** `SET-BANK-2` makes a statement importable once by checksum per tenant, legal entity,
  and bank account, and a trigger forbids changing it; the derived statement id keeps the first
  part, and the event protection from phase 0 the second. `ACC-OPEN-1` keeps one opening journal per
  legal entity through a partial unique index; its derived journal id is only modelled, because the
  ledger stays on tables. Claims for `SAL-CUST-1`, `SAL-PRICE-1`, and `PRC-SUP-1` show who took a
  value and when; a released claim stays in the history.
- **Accountant.** A duplicate import under `SET-BANK-2` would double cash lines, and a second
  opening load under `INV-OPEN-4` would double opening stock value; `INV-OPEN-4` also refuses an
  item already opened in the warehouse (`OpeningStockAlreadyLoaded`), which needs a claim per
  warehouse and item, not only a derived load id. `ACC-OPEN-1` returns the posted entry for the same
  command and fails a different journal with `JournalIdempotencyConflict`; that behavior must
  survive. No posting changes in this phase.
- **Systems engineering.** Claims replace unique indexes with a protocol: take the claim, create the
  record, release the claim if creation fails, and survive a crash between steps. `SAL-CUST-1`
  claims the trimmed, lowercased email, so normalization happens before the claim. `PRC-READ-1`
  waits for a replica and fails closed; the receipt wait must keep failing closed. `PRC-DRAFT-1`
  returns the approval request with the drafted order today; with a policy the response no longer
  contains it, which changes the API contract and the screen that shows it.
- **ERP engine development.** `SAL-QUOT-3` converts an accepted quotation once under a lock and
  returns the same order on repeat; a derived order id keeps the "once", but the conversion writes a
  table-backed order while the quotation may be stream-backed, which is the open gate. `PRC-SUP-1`
  accepts only an active supplier relationship from Party at creation; master-data uniqueness in
  mature engines is a database constraint, and claims must make duplicates impossible under
  concurrent clicks.
- **Warehouse operations.** `INV-OPEN-4` makes an opening stock load idempotent and refuses loading
  an item twice; people loading opening stock see no difference.

## Open questions

- Should quotations move before sales orders, given that conversion creates an order?

## Review record

| Date | Reviewer | Outcome | Notes |
| --- | --- | --- | --- |
| | | | |
