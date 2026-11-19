# ADR-0117: Load Opening Positions Against a Migration Clearing Account

- Status: Accepted
- Date: 2026-11-19
- Amends: ADR-0096 (adds a posting role, a capability, and the opening journal), ADR-0100 (point 4: opening stock)
- Compatible with: ADR-0015, ADR-0091, ADR-0095
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Migration-first comparison, section 4A and the decisions requested from reviewers:
>   [`../architecture/reference/migration-first-erp-comparison.md`](../architecture/reference/migration-first-erp-comparison.md)
> - Posting rules and the ledger: [`./0096-adopt-posting-rules-and-legal-entity-ledger.md`](./0096-adopt-posting-rules-and-legal-entity-ledger.md)
> - Moving-average valuation: [`./0100-adopt-moving-average-inventory-valuation.md`](./0100-adopt-moving-average-inventory-valuation.md)

## Context

A tenant that moves from another system arrives with a trial balance and with open items: invoices
and bills with residuals, and stock with a value. Open receivables, payables, and stock are already
held by their owners (Billing, Settlement, Inventory), and their control accounts in the ledger move
only through those owners' postings. If the opening trial balance also carried the control account
balances, every open item would be counted twice. If an owner loaded its items with no offsetting
account, the ledger would not balance. Nothing in Accounting yet says how an opening position enters
the ledger, how it is proven complete, or how an operator reads the result as a profit and loss and a
balance sheet.

## Decision

1. **A `migration_clearing` posting role** names a per-legal-entity clearing account. The built-in
   neutral chart and the Indonesian chart create it (`1900`, `1-1900`) as a transitory asset account.
   Applying a chart again adds it to an existing tenant without changing any other account or rule.
2. **Owners load open items against clearing.** Billing, Settlement, and Inventory post each opening
   item through `postDocumentEntry`: the item's own role (receivable, payable, inventory) against
   `migration_clearing`, dated at the opening date, with the owner's source document and reference as
   today. Opening stock therefore no longer goes against inventory adjustment (ADR-0100, point 4).
   The owners' loading commands are separate work; this decision only fixes what they post against.
3. **One opening journal per legal entity** carries every other balance (cash, fixed assets, equity,
   accruals, and any year-to-date revenue and expense). `GeneralLedgerService.postOpeningJournal` posts
   it under `accounting.opening_balance.post`, a capability apart from manual journals. The entry is
   keyed by its legal entity: its reference is `accounting.opening_balance/<legal entity id>` and its
   source is the legal entity, so repeating the same command returns the posted entry and a different
   journal fails with `JournalIdempotencyConflict`. A partial unique index allows at most one entry
   with that source type per legal entity, whatever its reference.
4. **Control accounts get balance only from owner loads.** A line that resolves to the receivable,
   payable, or inventory account fails with `OpeningJournalControlAccount`. The check runs in the
   posting transaction against the posting rules read there. The journal still has to balance, so its
   lines include `migration_clearing` for the net of the three control balances the owners will load.
5. **Sign-off needs clearing to be exactly zero.** `verifyMigrationClearing` succeeds only when the
   legal entity has a posted opening journal dated on or before the cutoff and the clearing balance at
   the cutoff is zero. A nonzero balance fails with `MigrationClearingNotZero`, which carries the
   balance, and a missing journal fails with `OpeningJournalNotPosted`, so an entity where nothing was
   loaded cannot pass. The verifier is a read under `accounting.ledger.read`; recording a sign-off and
   any use of the result in a cutover workflow belong to the migration work.
6. **Profit and loss and balance sheet** are reads over posted lines under `accounting.ledger.read`.
   The profit and loss covers a date range, with revenue and expenses in their natural sign and net
   income. The balance sheet covers a date and lists assets, liabilities, and equity. No year-end close
   exists, so it adds `unclosedEarnings`, every revenue less every expense up to the date, which makes
   it balance. Rows are each account's own activity with its parent id; consumers roll up the
   hierarchy.
7. **Journals are never deleted.** A wrong opening journal is corrected by a new, traceable entry
   (a manual journal or a corrected owner load), and the clearing check applies to the result.

## Consequences

- The "no amount counted twice" rule becomes a test: the opening journal cannot touch the three
  control accounts, and the clearing account must come back to zero.
- Clearing zero shows that the owners' loads equal the source control balances, not that the source
  balances are right. Source control totals are still checked against independent reports.
- Applying a chart template to an existing tenant adds the clearing account and rule, and an existing
  tenant whose chart came from elsewhere must configure the `migration_clearing` role before it can
  load or verify.
- The control check compares exact account ids. A sub-account of a control account is not guarded, and
  neither are goods received not invoiced or any other role; the comparison document's section 4D
  treats them as separate controls.
- A zero clearing balance at the cutoff says nothing about postings dated after it. The verifier takes
  the cutoff date, and the migration work decides when to run it.
- The posting role is a PostgreSQL enum value and the single-opening-journal rule a partial unique
  index, so both ship as one migration.

## Alternatives Considered

- **Load every balance, control accounts included, through one opening journal:** rejected; it counts
  open items twice or leaves the owners' subledgers without the opening items.
- **Make the owners post control balances directly, with the opening journal holding the rest and no
  clearing account:** rejected; nothing would prove the two halves agree, and a mismatch would hide in
  the equity or cash lines.
- **Tag the opening journal with a new column:** rejected; the existing source type and source id fit,
  and no other query needs a new column.
- **Return a flag instead of failing the verifier:** rejected; a failing verifier is a gate callers
  cannot forget to check, and the trial balance already shows the clearing balance for diagnosis.
