# Accounting Rules

> **Status:** Current rules owned by the Accounting module (ADR-0123). This file wins over ADR text
> for what the module does now. It covers opening balances, migration clearing, and the exact balance of a journal; ledger authority
> and posting rules are owned by
> [`financial-ledger.md`](../../../docs/architecture/financial-ledger.md).

Each rule has an identifier that the test enforcing it names as `[ID]`, in a comment above the test
or in its title; `tests/architecture/modules.test.ts` fails when a rule has no such test or a test
names an unknown rule. A rule no test enforces says `unenforced`.

Why: [ADR-0117](../../../docs/decisions/0117-load-opening-positions-against-migration-clearing.md).

### `ACC-OPEN-1` One opening journal per legal entity, keyed by the legal entity

`postOpeningJournal` needs `accounting.opening_balance.post`. Its reference is
`accounting.opening_balance/<legal entity id>`: repeating the same command returns the posted entry,
and a different journal fails with `JournalIdempotencyConflict`. A partial unique index allows one
such entry per legal entity.

### `ACC-OPEN-2` Control accounts get balance only from owner loads

An opening journal line that resolves to the receivable, payable, or inventory account fails with
`OpeningJournalControlAccount`; owners load those through `postDocumentEntry` against the
`migration_clearing` role, which both built-in charts create.

### `ACC-OPEN-3` Sign-off needs migration clearing at exactly zero

`verifyMigrationClearing` succeeds only with a posted opening journal dated on or before the cutoff
and a zero clearing balance at the cutoff; otherwise it fails with `MigrationClearingNotZero` (with
the balance) or `OpeningJournalNotPosted`.

### `ACC-OPEN-4` Journals are never deleted

A wrong opening journal is corrected by a new, traceable entry, and the clearing check applies to
the result. This is unenforced by a dedicated test; the ledger's general immutability is owned by
`financial-ledger.md`.

### `ACC-JNL-1` A journal balances exactly

Total debits equal total credits in minor units, with no tolerance, and a journal has at least two
lines. This holds for a posted entry, a manual entry, and a financial journal intent: one that does
not balance fails with `UnbalancedJournal` and records nothing. A deferred database constraint
(`journal_entries_balanced_check`) enforces it for posted entries as well, but the typed error is
the contract.
