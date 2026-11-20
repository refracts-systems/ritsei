# Settlement Rules

> **Status:** Current rules owned by the Settlement module (ADR-0123). This file wins over ADR text
> for what the module does now. It covers bank statements, reconciliation, and receipt withholding;
> ledger posting rules are owned by [`financial-ledger.md`](../../../docs/architecture/financial-ledger.md).

Each rule has an identifier that the test enforcing it names as `[ID]`, in a comment above the test
or in its title; `tests/architecture/modules.test.ts` fails when a rule has no such test or a test
names an unknown rule. A rule no test enforces says `unenforced`.

Why: [ADR-0102](../../../docs/decisions/0102-split-billing-and-settlement.md),
[ADR-0116](../../../docs/decisions/0116-import-bank-statements-and-record-receipt-withholding.md).

### `SET-BANK-1` A bank statement has one CSV profile and is rejected whole

UTF-8 CSV with the header `date,description,reference,amount`, RFC 4180 quoting, `YYYY-MM-DD` dates,
signed amounts with at most two decimals (zero rejected), a required description, blank lines
ignored, at most 5000 lines. A file that breaks the profile is rejected at its first failing row and
nothing is stored.

### `SET-BANK-2` A statement is imported once and never changes

A SHA-256 checksum, unique per tenant, legal entity, and bank account, makes a repeated import return
the stored statement. A database trigger forbids updating or deleting statements and lines.

### `SET-BANK-3` Matching is manual, records only cash, and is reversed, not deleted

A match links an amount of a line to a payment of the same legal entity, bank account, and direction,
never above what is unmatched on the line or on the payment's cash (amount less withholding). A
client-chosen match id makes a retry return the recorded match. A match never changes a payment, an
allocation, or the ledger; `reverseBankMatch` marks it reversed, and reversing twice is safe. The
service locks the line, then the payment, and is the only supported writer.
The reconciliation report lists active matches for the selected legal entity and bank account, with
id-based pagination, so an authorized user can find a match to reverse. It includes each statement's
source name, line number, and reference, and supports paging the unmatched lines and payments.

### `SET-WHT-1` A receipt may record withholding, allocated in the same command

The payment amount is the cash plus the withheld part. The journal debits the bank with the cash and
the named claim account with the withheld amount, and credits receivables with the whole amount. The
withheld amount is less than the amount and is allocated to documents in the same command; only
receipts carry withholding, and Settlement computes no rate.
