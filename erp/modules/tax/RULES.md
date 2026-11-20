# Tax Rules

> **Status:** Current rules owned by the Tax module (ADR-0123). This file wins over ADR text for
> what the module does now; the ADRs named under each rule record why.
>
> **Does not own:** Jurisdiction codes and their seeded rates (`localization_id`, ADR-0111), or the
> date a document passes (the document owner, for example Billing).

Each rule has an identifier that the test enforcing it names as `[ID]`, in a comment above the test
or in its title; `tests/architecture/modules.test.ts` fails when a rule has no such test or a test
names an unknown rule. A rule no test enforces says `unenforced`.

Why: [ADR-0098](../../../docs/decisions/0098-adopt-a-neutral-tax-module.md),
[ADR-0119](../../../docs/decisions/0119-date-tax-rates-with-periods-on-the-tax-code.md).

### `TAX-CALC-1` Tax is rounded half up per line

### `TAX-CALC-2` Tax is computed per line and per code, in one direction

A sales code cannot be used for a purchase and the reverse; a code of the other direction is
rejected.

### `TAX-RATE-1` The rate in force is the latest period on or before the date

A tax code may have dated rate periods (an `effectiveFrom` date and a four-decimal rate). The rate in
force is that of the latest period starting on or before the transaction date. Before the first
period, or when the caller passes no date, the code charges its own rate; Tax never defaults to the
current date. A second period with the same start date fails with `TaxCodeRateAlreadyExists`. Tax
offers no command that changes or deletes a period; a rate change is a later period.

### `TAX-AUTH-1` Tax capabilities are denied by default

Every operation needs its capability in the tenant, and scheduling a rate period needs
`tax.tax_rate.schedule`.

### `TAX-PROD-1` A product's tax defaults are codes of the matching direction

PostgreSQL binds a product's default sales and purchase tax codes to existing codes of the same
direction.
