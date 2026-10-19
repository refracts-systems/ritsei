# ADR-0098: Adopt a Neutral Tax Module

- Status: Proposed
- Date: 2026-10-20
- Amends: None
- Compatible with: ADR-0013, ADR-0016, ADR-0042, ADR-0096
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - ERP parity plan, decision D5: [`../proposals/erp-module-parity-plan.md`](../proposals/erp-module-parity-plan.md)
> - Jurisdiction isolation: [`./0016-isolate-jurisdiction-localization.md`](./0016-isolate-jurisdiction-localization.md)

## Context

Invoices and supplier bills need tax lines, and the flagship segment pays Indonesian VAT (PPN) and
withholding. ADR-0016 keeps jurisdiction rules out of core modules. No module owns tax codes or
computes tax today.

## Decision

1. **`erp/modules/tax` owns tax codes and tax computation**, jurisdiction-neutral. A tax code has a
   code, name, rate (percent, four decimals), direction (sales or purchase), and an active flag.
2. **Determination is by product default.** A product has at most one default tax code per direction,
   and a composite foreign key guarantees that a sales default is a sales code. The document owner
   may override the code per line.
3. **Computation is exact, tax-exclusive, and per line.** Tax on a line is its base times the rate,
   rounded half up to the cent; document tax totals are sums of line taxes, and the summary groups
   them by code. Tax-inclusive pricing, compound taxes, and withholding stay out until a
   localization needs them.
4. **Document owners own their tax lines.** Billing stores the computed tax on its lines and posts it
   through the output or input tax posting role (ADR-0096); Tax keeps no per-document state.
5. **Localization adds codes, not rules in core.** `localization-id` creates the PPN codes and adds
   withholding through its own module; the neutral module never encodes a jurisdiction.

## Consequences

- Tax amounts are reproducible from line bases and rates, so invoice totals reconcile with the tax
  accounts.
- Party tax status (exempt customers) and fiscal positions are not modeled yet.

## Alternatives Considered

- **Tax columns on products:** rejected; the product module would own a jurisdiction concern.
- **Tax computed by Billing:** rejected; Procurement and Sales need the same rules for quotations
  and purchase orders.
