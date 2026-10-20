# ADR-0096: Adopt Posting Rules and the Legal-Entity General Ledger

- Status: Accepted
- Date: 2026-10-20
- Amends: None
- Compatible with: ADR-0042, ADR-0091, ADR-0092, ADR-0095
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - ERP parity plan, Phase 4: [`../proposals/erp-module-parity-plan.md`](../proposals/erp-module-parity-plan.md)
> - Document numbering: [`./0095-adopt-gapless-document-numbering.md`](./0095-adopt-gapless-document-numbering.md)
> - TigerBeetle as designated engine: [`./0092-retain-tigerbeetle-as-designated-ledger-engine.md`](./0092-retain-tigerbeetle-as-designated-ledger-engine.md)

## Context

Accounting posts journals, but a journal has no legal entity, posting date, or number, so there is no
trial balance, general ledger, or fiscal-year numbering. The only automatic posting is the
order-specific revenue posting profile. Billing, Settlement, and Inventory each need to post journals
(receivables, revenue, tax, payables, stock value, cost of goods sold) without knowing a tenant's
chart of accounts, and the parity plan asks for an account hierarchy and a chart template mechanism.

## Decision

1. **Journals belong to a legal entity and a posting date.** Journal entries gain `legal_entity_id`,
   `posting_date`, `number`, `description`, and an optional source document (`source_type`,
   `source_id`). The three ledger attributes are set together or not at all, so entries posted
   before this decision stay valid. The existing database checks still enforce balanced, immutable
   posted journals.
2. **Posting validates the period by posting date.** An entry posts only when the legal entity is
   configured for accounting on the PostgreSQL engine with posting enabled, and an open period covers
   the posting date. Posting takes a shared lock on that period, so a concurrent close waits for it.
3. **Entries are numbered per legal entity and fiscal year** through the numbering service
   (ADR-0095), as `JE/<fiscal year>/<value>`, in the posting transaction.
4. **Document owners post through roles, not accounts.** Accounting owns a closed set of posting
   roles (receivable, revenue, output and input tax, payable, inventory, cost of goods sold, goods
   received not invoiced, purchase price variance, inventory adjustment, cash) and a posting rule per
   legal entity and role that names the account. A document owner calls
   `GeneralLedgerService.postDocumentEntry` inside its own transaction, with lines that name a role
   or, where the owner holds an account reference (a bank account), an account. The entry carries
   the source document, and its reference is the idempotency key. This replaces the order-specific
   revenue posting profile for new documents; the profile stays for the existing order flow.
5. **Accounts form a same-type hierarchy.** An account may name a parent of the same type, enforced
   by a composite foreign key. A chart template creates accounts by code and, for a legal entity, the
   template's posting rules; applying it again never changes existing accounts or rules. The neutral
   `neutral_trading` template is the first; localization modules add their own.
6. **Reports read posted lines.** The trial balance, general ledger (with opening and running
   balance), and role balance sum posted lines by legal entity and posting date. They are the
   reconciliation targets for receivables, payables, and stock valuation.
7. **Capabilities stay explicit.** `accounting.document_journal.post` authorizes document postings,
   separately from manual `accounting.journal.post`; `accounting.chart.apply`,
   `accounting.posting_rule.configure`, `accounting.posting_rule.read`, and `accounting.ledger.read`
   cover the rest. They are deny by default.

## Consequences

- The general ledger is PostgreSQL-only. The TigerBeetle path (ADR-0092) is unchanged: a legal
  entity whose engine is TigerBeetle rejects ledger postings until that path supports them.
- Posting rules are the extension point for localization: a localization module supplies a chart
  template and its role mapping without changing document owners.
- Downstream modules test their postings against PostgreSQL; there is no in-memory ledger, because
  the period lock, numbering, and balance checks are database guarantees.

## Alternatives Considered

- **Rewrite the existing journal service:** rejected for now; the existing service carries the
  TigerBeetle cutover path that ADR-0092 keeps. The ledger shares its tables and invariants instead.
- **Accounts on documents:** rejected; Billing and Inventory would depend on each tenant's chart.
