# ADR-0095: Adopt Gapless Document Numbering

- Status: Proposed
- Date: 2026-10-20
- Amends: None
- Compatible with: ADR-0091, ADR-0094
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - ERP parity plan, decision D9: [`../proposals/erp-module-parity-plan.md`](../proposals/erp-module-parity-plan.md)
> - Framework reset Phase 4: [`../proposals/framework-reset.md`](../proposals/framework-reset.md#8-phases)

## Context

Journals, invoices, credit notes, supplier bills, payments, and deliveries need human-readable
numbers. Legal numbering for invoices and tax documents is hard to change after go-live: most
jurisdictions, including Indonesia, expect a gapless, monotonically increasing series per issuing
entity and fiscal year, and auditors read gaps as deleted documents. No numbering exists today.

## Decision

1. **A framework service owns numbering.** `framework/modules/numbering` owns the `numbering`
   schema and exposes `NumberingService.allocate`. ERP modules call it from their own commands; the
   number is an attribute of the owner's document, never a separate business fact.
2. **A series is per tenant, scope, document type, and fiscal year.** The scope is normally the
   issuing legal entity. The caller passes the document date and the scope's fiscal-year start month;
   the series key uses the calendar year in which that fiscal year starts. A new fiscal year starts a
   new series at 1. The format is `<prefix><fiscal year>/<zero-padded value>`, for example
   `INV/2026/00001`; the caller supplies the prefix for a new series.
3. **Every series is gapless.** Allocation runs inside the transaction that commits the numbered
   document. It locks the series row, so allocations in one series serialize until commit, and a
   rollback returns the value. Numbers are allocated when a document is posted or issued, never for
   drafts. Each issued number is recorded with its document id; allocating again for the same document
   returns the same number, so command retries are safe.
4. **Allocation is not a business action.** It carries no capability of its own; the calling command
   authorizes its business action first. Series configuration (custom prefixes, padding) is deferred
   until a pilot asks for it; until then the caller's default prefix applies.

## Consequences

- Posting in one series is serialized per legal entity and document type. This is acceptable for the
  flagship segment (SME distribution and trading) and is measurable; a gap-tolerant series backed by
  a PostgreSQL sequence can be added later for high-volume, non-legal documents.
- Gaplessness is provable from stored facts: `numbering.issued_numbers` holds every value with a
  unique `(series, value)` and `(series, document)`.
- A document whose number must be voided keeps its number and is corrected by a new document (credit
  note, reversal), never deleted.

## Alternatives Considered

- **PostgreSQL sequences:** rejected for legal documents; sequences are not transactional and leave
  gaps on rollback.
- **Numbering columns owned by each module:** rejected; every module would reimplement locking,
  fiscal-year rollover, and retry behavior.
