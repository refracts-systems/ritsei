# ADR-0111: Build Indonesian Localization on Public Contracts, in Two Stages

- Status: Accepted
- Date: 2026-10-25
- Amends: None
- Compatible with: ADR-0013, ADR-0016, ADR-0091, ADR-0109
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - ERP parity plan, phases 7 and 8 and open question 1:
>   [`../proposals/erp-module-parity-plan.md`](../proposals/erp-module-parity-plan.md)
> - Follow-ups: [`../proposals/erp-chains-next-steps.md`](../proposals/erp-chains-next-steps.md) (F5)

## Context

The flagship segment is an Indonesian trading company, so PPN, withholding, taxpayer identifiers,
and the Coretax e-Faktur export are needed. ADR-0016 keeps the neutral modules free of any
jurisdiction, so all of it lives in a `localization-id` module built only on public contracts. Some of
what it needs is public today and some is not, and the parity plan leaves open whether Coretax output
is required in the first pilot month.

## Decision

1. **`erp/modules/localization-id` is one module that imports only public entry points.** It owns no
   business document. It contributes data and rules to modules that release a point for them.
2. **Stage A uses what is public or is small to release, and needs no custom fields** (built;
   the module is `erp/modules/localization_id`, named with an underscore because module names
   cannot contain a hyphen):
   - a chart-of-accounts template for Indonesian trading, through a template registry that
     Accounting releases (today the neutral template is built in);
   - PPN tax codes and the product tax defaults, created through the Tax module's public commands by a
     seed command, never hard-coded in Tax;
   - NPWP and NIK identifier schemes with their validation, through Party's identifier scheme
     contract.
3. **Stage B waits for ADR-0109 (accepted) and for Stage A:**
   - PPh 23 and PPh 4(2) withholding on supplier bills, which needs a Billing extension point for
     withheld amounts;
   - the Coretax e-Faktur export, a versioned adapter in `framework/modules/integrations` that runs
     as a job and records what was submitted (ADR-0013); its output format version is part of the
     adapter's contract.
4. **Rules carry their jurisdiction and effective dates.** PPN rates and DPP basis rules are
   versioned data with a validity period, so a rate change is a new row, not a code change.
5. **Coretax output is not required in the first pilot month** (the owner's answer to open question
   1 of the parity plan). Stage B therefore stays after custom fields and after Stage A. PPN is
   calculated from tax codes from the first month, which Stage A seeds.

## Consequences

- Stage A needed two small extension points, both optional services that default to none: Accounting's
  `ChartTemplateRegistry` (an unknown template id fails with `ChartTemplateNotFound`) and Party's
  `IdentifierSchemes` (a rejected value fails with `ExternalIdentifierInvalid`; a scheme without a rule
  is accepted as before). One setup command, `POST /localization-id/setup`, applies the chart with its
  posting rules and creates the PPN tax codes, and is safe to repeat.
- Stage A does not give tax codes validity periods: the tax module has none yet, so a rate change
  today is a new code. Dated rates remain open for Stage B.
- Tax statutory text and rate tables are not in this ADR; the module's own document owns them.
- A second jurisdiction would be a second module with the same shape, which tests that the neutral
  modules stayed neutral.

## Alternatives Considered

- **Put PPN codes in the neutral Tax module:** rejected by ADR-0016.
- **Build withholding and Coretax first:** rejected; they need extension points that do not exist yet.
