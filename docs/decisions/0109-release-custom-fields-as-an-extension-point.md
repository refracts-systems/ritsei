# ADR-0109: Release Custom Fields as an Owner Extension Point

- Status: Accepted
- Date: 2026-10-25
- Amends: None
- Compatible with: ADR-0015, ADR-0091, ADR-0094
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - ERP parity plan, decision D8: [`../proposals/erp-module-parity-plan.md`](../proposals/erp-module-parity-plan.md)
> - Follow-ups: [`../proposals/erp-chains-next-steps.md`](../proposals/erp-chains-next-steps.md) (F3)

## Context

Tenants need fields of their own on documents: a customer's account manager, a product's shelf
location. Odoo Studio and SAP key-user extensibility add them by changing the document's tables.
RITSEI does not allow that (ADR-0015, ADR-0091): one module owns each table, and other modules and
tenants extend it only through released contracts. ADR-0094 deferred extension points until the first
one is released. This is that first one.

## Decision

1. **An owner releases a custom-field point per document type.** A module declares in its manifest
   that `product.product` or `sales.customer` accepts custom fields. Declaring it is a released,
   versioned contract; a module that does not declare it accepts none.
2. **The framework stores definitions and values, never the owner's tables.** A `framework` schema holds
   field definitions (tenant, document type, key, label, kind, required, choices, position) and values
   (tenant, document type, document id, key, typed value). A value row references the owner's document
   by id only, with no foreign key into the owner's schema, and is removed through the owner's delete
   event.
3. **Kinds are closed:** text, number, date, boolean, and a choice from a list. Each definition
   compiles to an Effect Schema that validates a value on write. There are no formulas, no scripts,
   and no cross-field logic (the Studio features rejected in the parity plan).
4. **The owner decides where values appear.** The owner's service returns them under one `custom`
   key of its DTO and accepts them on its write commands through the framework's validator; the
   owner's authorization applies to both. A new capability per owner, for example
   `product.custom_field.configure`, gates changing definitions; deny by default.
5. **First consumers are Product and the Sales customer.** Documents with posting effects (invoices,
   journals) get none: a posted document does not change.

## Consequences

- Reading a document with custom fields costs one more query by document id; v1 does not index values
  for search or filter lists by them.
- Removing a definition keeps the values until a tenant administrator purges them, so nothing is lost
  by accident.
- Localization modules (ADR-0111) can add jurisdiction fields without touching shared tables.

## Alternatives Considered

- **A `jsonb` column on each owner table:** rejected; it lets one tenant's shape leak into the owner's
  schema and bypasses the owner's constraints.
- **Entity-attribute-value rows owned by each module:** rejected; every owner would rebuild the same
  validation.
- **Generated columns per tenant:** rejected; DDL per tenant does not scale and breaks the migration
  graph.
