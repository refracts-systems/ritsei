# ADR-0099: Make Sales Customers Party Roles

- Status: Proposed
- Date: 2026-10-20
- Amends: None
- Compatible with: ADR-0014, ADR-0015, ADR-0021, ADR-0091
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - ERP parity plan, decision D7: [`../proposals/erp-module-parity-plan.md`](../proposals/erp-module-parity-plan.md)

## Context

Sales customers are a Sales-local record (name, email) with no legal entity, while Procurement's
supplier accounts already reference a Party supplier relationship. Invoices, receipts, aging, and
statements need the customer's party and the selling legal entity, and the same organization can be
a customer of one company and a supplier of another.

## Decision

1. **A customer is a Party customer relationship in Sales.** `SalesDocumentService.createPartyCustomer`
   takes an active `customer` relationship (party, legal entity) and creates the Sales customer with
   the party's name, a contact email, the party id, the relationship id, and the legal entity. A
   foreign key binds the customer to the relationship; one relationship has one customer.
2. **Order-to-Cash documents need a party customer.** Priced quotations, orders converted from them,
   deliveries, and invoices take the legal entity and party from the customer. Customers created
   before this decision keep working in the existing order flow but cannot start the new documents
   (`CustomerLegalEntityRequired`).
3. **Commercial policy stays with its owner.** Sales owns price lists (per customer) and quotation
   pricing; Settlement owns payment terms (ADR-0102). Party owns identity, addresses, and bank
   accounts.

## Consequences

- No data migration rewrites existing customers; a tenant converts a customer by creating it from
  the party relationship.
- Credit limits (Sales) are not implemented yet.

## Alternatives Considered

- **Drop the Sales customer table:** rejected for now; the existing order flow, confirmation
  coordinator, and screens use it.
