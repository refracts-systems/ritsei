# ADR-0119: Date Tax Rates With Periods on the Tax Code

- Status: Proposed
- Date: 2026-11-19
- Amends: None
- Compatible with: ADR-0016, ADR-0098, ADR-0111
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Neutral tax module: [`./0098-adopt-a-neutral-tax-module.md`](./0098-adopt-a-neutral-tax-module.md)
> - Localization stages (decision 4 and the dated-rates consequence):
>   [`./0111-sequence-localization-id-on-public-contracts.md`](./0111-sequence-localization-id-on-public-contracts.md)

## Context

ADR-0111 requires that a rate change is a new row, not a code change, and left dated rates open for
Stage B because a tax code carries one rate. Computation belongs to the neutral Tax module (ADR-0098),
and an effective period is not a jurisdiction concern, so the mechanism belongs in Tax. The values of
a jurisdiction's rates stay in its localization or in tenant data.

## Decision

1. **A tax code may have dated rate periods.** A period is a tenant, a tax code, an `effectiveFrom`
   calendar date, and a rate (percent, four decimals). It is created through a Tax command guarded by
   its own capability, `tax.tax_rate.schedule`, and is never updated or deleted; a second period with
   the same start date fails with `TaxCodeRateAlreadyExists`. A rate change is a later period.
2. **The rate in force is the latest period starting on or before the transaction date.** Before the
   first period, and when the caller passes no date, the code charges its own rate. A caller that
   passes no date therefore behaves exactly as before; Tax never defaults to the current date.
3. **The document owner supplies the date.** Billing passes the invoice date. A credit note passes the
   invoice date of the document it credits, so a correction reverses the tax at the rate the original
   was issued at, not at the rate of the correction date.
4. **No rate values are seeded here.** `localization_id` setup still creates the 11 percent PPN codes of
   ADR-0111 stage A. Adding the periods for a statutory rate change is tenant or owner input.

## Consequences

- No backfill: existing codes have no periods and keep their own rate.
- Sales and procurement do not compute tax yet; when they do, they pass their document date the same
  way.
- A period is not tied to a legal-entity registration or a filing period; those stay with the
  localization.

## Alternatives Considered

- **Periods owned by `localization_id`:** rejected; Tax computes, and the module would need to
  intercept every computation.
- **A new tax code per rate change:** rejected; a product default and open documents point at the
  code, so every rate change would re-point them.
