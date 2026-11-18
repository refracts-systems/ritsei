# ADR-0115: Import Bank Statements and Record Withholding on Receipts in Settlement

- Status: Proposed
- Date: 2026-11-19
- Amends: ADR-0102 (bank statements no longer stay out of Settlement)
- Compatible with: ADR-0016, ADR-0042, ADR-0051, ADR-0098, ADR-0111
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Migration-first comparison, payments row and section 4A:
>   [`../architecture/reference/migration-first-erp-comparison.md`](../architecture/reference/migration-first-erp-comparison.md)
> - Backlog items B3 and B5: [`../proposals/erp-handoff.md`](../proposals/erp-handoff.md)

## Context

ADR-0102 left bank statements out of Settlement. A pilot cannot reach its first reconciled close
without them: cash on the books has to be shown against the bank's own evidence, and what the bank
reported but the books do not explain has to stay visible. The migration-first comparison also
requires a stated treatment for a customer who pays part of an open receivable and withholds income
tax (in Indonesia PPh 23, evidenced by a bukti potong): the residual, the certificate, and the
receivable the payment clears must all be defined.

Billing has no extension point for withheld amounts and ADR-0111 keeps withholding rules (Stage B)
for the Indonesian localization module. Settlement must not compute tax or name a jurisdiction
(ADR-0016, ADR-0098).

## Decision

1. **A statement is imported as immutable evidence.** `importBankStatement` takes one CSV text in
   the profile below for a legal entity and a ledger bank account. The service stores a statement
   header and one line per row, each with a UUIDv7 id. A SHA-256 checksum of the content, unique
   per tenant, legal entity, and bank account, makes a repeated import return the statement already
   stored. A file that breaks the profile is rejected whole with the failing row; nothing is
   stored. Statements and lines cannot be updated or deleted (database trigger).
2. **The one profile is UTF-8 CSV with the header `date,description,reference,amount`.** Fields
   follow RFC 4180 quoting; `date` is `YYYY-MM-DD`; `amount` is a signed decimal with a dot and at
   most two decimals (positive is money in, negative money out, zero rejected); `description` is
   required and `reference` may be empty; blank lines are ignored; at most 5000 lines. Other bank
   formats are converted outside Settlement until a second profile has a named user.
3. **Matching is manual and records only the cash.** `matchBankLine` links an amount of a line to a
   payment on the same legal entity and bank account, in the same direction (money in to a receipt,
   money out to a payment). The matched amount cannot exceed what is unmatched on the line or on the
   payment's cash. The cash of a payment is its amount less any withholding. A client-chosen match
   id makes a retry return the recorded match. A match never changes a payment, an allocation, or the
   ledger. Matches are only added and reversed: `reverseBankMatch` marks a match reversed and keeps
   it as history, so a wrong match is corrected by a new fact, not by deletion. The service
   serializes concurrent matches by locking the line and then the payment. Deferred database checks
   reject totals above the same limits, but they do not lock, so the service is the only supported
   writer. A payment without an explicit bank account cannot be matched.
4. **Nothing is matched automatically, and what is unmatched stays visible.** `bankReconciliation`
   lists the statement lines of a bank account with an unmatched amount, and its payments with
   unmatched cash, each payment with its unallocated (on-account) amount. Existing aging and
   statements keep showing unapplied cash.
5. **A receipt can record withheld tax; settlement computes none.** `receivePayment` takes an
   optional `withholding` of an amount, a certificate reference, and the account that holds the
   withheld tax as a claim. The payment `amount` is what the receipt settles: the cash received plus
   the withheld part. The journal debits the bank for the cash, the named account for the withheld
   amount, and credits receivables for the whole amount, so the residual receivable, the document
   open amount, and aging agree with the ledger. The withheld amount must be less than the
   amount and must be allocated to documents in the same command, so it never sits on account.
   The rate, the base, and the legal validity of the certificate are the caller's. Only receipts
   carry withholding. Withholding on supplier bills stays in Stage B (ADR-0111).
6. **Capabilities** are `settlement.bank_statement.import` and `settlement.bank_statement.reconcile`;
   reading uses `settlement.report.read`.

## Alternatives Considered

- **Match by changing the payment or an allocation:** rejected; matching is evidence about cash, not
  a change to what was settled.
- **Automatic matching or suggestions:** out of scope; the comparison asks for a manual queue first.
- **Withholding as a Billing extension point or a tax-code computation:** rejected for now; it is
  Stage B, needs ADR-0111's extension point, and the pilot only needs the correct residual.
- **Record withheld tax as a separate allocation to the invoice:** rejected; Billing allows one
  settlement per invoice and source, and a split would break cash matching.
- **A match as a mutable flag on the line:** rejected; lines are immutable evidence and a reversal
  needs history.

## Consequences

### Positive

- Cash can be reconciled to the bank file, and what remains unexplained is a query, not a spreadsheet.
- A partial payment with withholding clears the right part of the receivable, and the reconciliation
  of the three views is tested end to end.
- Replays of an import or a match are safe.

### Negative

- Only one CSV profile, one currency, and a statement without balances: opening and closing balance
  checks against the ledger remain manual.
- Payments recorded without a bank account can never be matched, because payments are immutable. The
  web payment screens do not send a bank account today, so receipts recorded there are not
  reconcilable until the screen offers one.
- Withholding is trusted input: Settlement does not verify rates or certificates.

### Risks

- A bank whose export does not fit the profile needs a conversion step; a second profile needs its
  own decision.
- Matching a bank fee or a transfer without a payment needs a payment recorded first, which is the
  intended discipline but adds a step for operators.

## Validation

Pure tests cover the profile. A PostgreSQL chain test covers import idempotency, rejection without
side effects, matching limits, direction and account mismatches, authorization, reversal, a
concurrent match race, a partial receipt with withholding that leaves the residual equal in the
document, the receivables control account and aging, and the database checks.

## Related Documents

- [ADR-0102](./0102-split-billing-and-settlement.md)
- [ADR-0111](./0111-sequence-localization-id-on-public-contracts.md)
