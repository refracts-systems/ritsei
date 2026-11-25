# ADR-0130: Adopt Organization Units and Read-Only Consolidation

- Status: Proposed
- Date: 2026-11-25
- Amends: ADR-0021 (its deferral of group structures)
- Compatible with: ADR-0005, ADR-0006, ADR-0042, ADR-0091, ADR-0128
- Supersedes: None
- Superseded by: None
- Changes: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Scope model: [`./0021-define-p0-scope-and-identity-model.md`](./0021-define-p0-scope-and-identity-model.md)
> - Hierarchies: [`./0005-use-ltree-and-sql-pgq-selectively.md`](./0005-use-ltree-and-sql-pgq-selectively.md)
> - Exact amounts: [`./0042-exact-financial-amount-boundary.md`](./0042-exact-financial-amount-boundary.md)
> - Multi-currency, decision D6: [`../proposals/erp-module-parity-plan.md`](../proposals/erp-module-parity-plan.md)
> - KPI read: [`../proposals/kontainer-backend.md`](../proposals/kontainer-backend.md)

## Context

ADR-0021 fixed the scope chain as tenant, legal entity, then branch and warehouse, and deferred group
structures: "organization groups and hierarchy use explicit PartyRelationship links". The mockup shows
a user choosing a group or business unit and reading figures for everything under it, in one currency.

What exists today:

- A tenant holds several legal entities, each with its own base currency, precision, fiscal year, and
  ledger (`accounting.legal_entity_accounting_configurations`). One base currency per legal entity;
  no exchange-rate table exists and multi-currency is open (D6).
- Every read that takes a scope takes one `legalEntityId` (the pipeline, the KPIs, aging, the
  ledger reports). Capabilities are granted for the whole tenant; scoped grants do not exist yet.
- Party relationships link a party to a legal entity; they are not an organization tree.
- `ltree` is chosen for strict hierarchies by ADR-0005, but no migration enables the extension yet.

## Decision

1. **An organization-unit tree sits above legal entities, owned by `party`.** A unit has a kind
   (`group` or `business_unit`), a name, and at most one parent; roots are groups. A legal entity
   belongs to at most one unit, and a unit holds any number of legal entities and child units. The tree
   is strict (one parent), so it is stored as a parent link with a maintained `ltree` path (ADR-0005),
   and cycles are impossible by construction. Units carry no accounting meaning of their own except
   the group currency below.
2. **A unit selects legal entities; it never acts.** Choosing a unit as scope means "the legal entities
   at or under this unit", resolved by `party` into a list of legal-entity ids. Every command still
   names one legal entity and runs as today (as the owner decided). A unit is never a posting,
   numbering, or approval scope.
3. **Authorization is unchanged by the tree.** A reader needs the same capabilities as for a single
   entity; a read over a unit asks each owner for each legal entity and an owner that denies leaves
   that entity's part out, marked, never counted as zero (as in the KPI read). When scoped grants arrive
   (ADR-0128 decision 1) a unit grant means the legal entities under it.
4. **Consolidation is a read in the group currency from a rate table.** The currency belongs to a root
   group unit. Accounting owns a table of exchange rates `(from, to, date, rate)` entered by hand under a
   new capability; rates are decimal strings with ten decimals, never floats. Each legal entity's amount
   is translated at the latest rate on or before the as-of date, rounded half up to the cent of the group
   currency per entity and figure, then summed (ADR-0042). The first version uses one rate for every
   line of a figure; it has no translation-adjustment account. A missing rate leaves that entity's
   figure `unavailable` and the total marked incomplete, never partial without saying so.
5. **The first consolidated reads are the six KPIs and the profit and loss and balance sheet.** Each
   response gives the group total, the per-entity lines (in the entity currency and the group
   currency), the rate used, and a flag that intercompany balances are **not eliminated**. Intercompany
   elimination is deferred, as decided.
6. **The KPI endpoint accepts a unit.** `GET /insights/kpis` takes `legalEntityId` or `unitId`, not
   both; with a unit it returns the group view above. A unit's view of entities with different base
   currencies needs the rates of decision 4; entities in the group currency need none.

## Alternatives Considered

- **A group is a PartyRelationship between organizations** (ADR-0021's wording). Rejected here: a
  relationship graph has no single parent, no tree path, and no place for a group currency; a read
  scope needs a strict tree.
- **A new module for organization units.** Rejected: `party` already owns the legal entity and the
  branch, and units are the same kind of identity. Revisit if units gain behavior of their own.
- **Translate each journal line at its own date's rate.** More exact, but needs per-line rates and a
  translation-adjustment account; not selected for a read-only first version.
- **Consolidate in the ledger** (a group ledger or posting to a parent). Rejected: it would make the
  group a second authority for facts that live in each legal entity.
- **Let a unit be an action scope.** Rejected by the owner's decision above.

## Consequences

### Positive

- One scope picker over groups and units for every read, with no change to how anything is posted.
- Exchange rates become an owned, auditable table that multi-currency (D6) can later reuse.

### Negative

- A new table family in `party` (units and membership) and a rate table in `accounting`; the
  `ltree` extension must be enabled by a migration.
- Group figures are approximations until intercompany elimination and translation adjustments exist,
  and the response says so.

### Risks

- A legal entity moved between units changes past group views. Mitigation: views are as-of the
  current tree; history of membership is not kept in this version.
- A user reads the group total and takes it for an eliminated, audited figure. Mitigation: the
  "not eliminated" flag and the per-entity lines are part of every response.

## Open questions for the owner

1. **Owner of the tree.** `party` (proposed), or a separate module?
2. **One tree only.** A legal entity belongs to one unit, so there is no second, geographic tree.
   Confirm, or say what a second view would need.
3. **Translation method.** One closing rate per entity and as-of date for every line (proposed), or
   the closing rate for balances and an average rate for flows (profit and loss, net sales)?
4. **Rates.** Entered by hand under a new `accounting.exchange_rate.configure` capability, with a
   lookup of the latest rate on or before the date (proposed); no rate feed. Confirm.
5. **Which reads first.** The six KPIs, profit and loss, and balance sheet (proposed), or the KPIs
   only?
6. **Group currency.** One currency per root group; a unit under it inherits it. Confirm.

## Validation

- A unit resolves to exactly the legal entities at or under it; moving a unit moves them; a cycle or a
  second parent is refused by the database.
- A command still names one legal entity; nothing posts, numbers, or approves in a unit scope.
- A consolidated KPI over entities in two currencies equals the sum of each entity's figure
  translated at the stated rate, rounded half up per entity; a missing rate marks the entity and the
  total, not zero.
- A reader denied by one owner for one entity still gets the others, with that part marked.
- The response always carries the per-entity lines and the "not eliminated" flag.
