# ADR-0091: Adopt the Framework and Flagship ERP Structure

- Status: Accepted
- Date: 2026-10-19
- Amends: ADR-0018 (the process engine is deferred until the core ERP loops run), ADR-0027 (search
  is PostgreSQL behind a small framework port; provider replaceability is withdrawn), ADR-0041
  (PostgreSQL is the only financial authority), ADR-0059 (the native PostgreSQL relationship engine
  stays; the SpiceDB option is withdrawn), ADR-0068 (the taxonomy becomes framework, erp, and
  extensions)
- Compatible with: ADR-0001, ADR-0003, ADR-0012, ADR-0015, ADR-0042, ADR-0051, ADR-0087, ADR-0090
- Supersedes: ADR-0007, ADR-0008, ADR-0020, ADR-0023, ADR-0025, ADR-0026, ADR-0034, ADR-0040,
  ADR-0043, ADR-0060, ADR-0064, ADR-0065, ADR-0070, ADR-0081, ADR-0083, ADR-0084
- Superseded by: None
- Amended by: ADR-0092 (TigerBeetle is retained as the designated future ledger engine)

> **Related documents**
>
> - Proposal and full rationale: [`../proposals/framework-reset.md`](../proposals/framework-reset.md)
> - ADR index: [`./README.md`](./README.md)
> - Repository rules: [`../../AGENTS.md`](../../AGENTS.md)

## Context

RITSEI has a strong correctness foundation but no framework/application boundary, no module
developer experience, and no complete business loop, while carrying specifications and code for
infrastructure no user needs (a TigerBeetle ledger program, a Stateful Entity Runtime, workload
cells, an analytic plane, search providers, plugin trust tiers, Zig FFI, WebGPU, a Document AST
platform). The owner's goal is an ERP framework for developers, with RITSEI's own ERP built on it
the way third-party modules will be. The proposal compares Frappe/ERPNext, Rails/Basecamp, Odoo, and
SAP S/4HANA with BTP.

## Decision

1. **Structure.** The repository becomes:

   ```text
   framework/     kernel: modules, data, auth, API, events, UI kit, CLI generator
   erp/           RITSEI ERP: flagship modules, built exactly like third-party modules
   extensions/    (later) modules from other developers and customers
   ```

2. **Boundaries**, enforced by the existing boundary tooling: `framework/` never imports `erp/` or
   `extensions/`; `erp/` uses only public framework and module entry points; `extensions/` uses
   only public framework and ERP entry points; a module owns its tables and never writes another
   module's tables.
3. **Odoo-like ease, SAP-like clean core.** Modules are fast to build (manifest, generator,
   conventions), but they extend each other only through public contracts, events, and released,
   versioned extension points, never by patching another module's models, tables, or views.
4. **Extract, don't speculate.** A framework capability is added only together with an `erp/`
   module that uses it. Engine-neutral ports (ledger, search, identity provider, object storage)
   stay, each with exactly one implementation that is used and tested.
5. **Delete, don't gate.** The infrastructure listed in the proposal's Section 5 is removed from
   the tree (history stays in git). PostgreSQL is the only financial authority; plain transactions,
   the outbox, and the job table replace the Stateful Entity Runtime; separate API and worker pools
   replace workload cells.
6. **Process engine deferred**, not abandoned: it returns once Order-to-Cash and Procure-to-Pay run
   end to end, built on extension points and events.
7. **Flagship scope.** The ERP targets Indonesian distribution and trading SMEs first, with a
   jurisdiction-neutral domain model; Indonesian tax specifics are a separate module later. Billing
   is in scope (supersedes ADR-0060).
8. **Sequence:** remove; restructure; module kernel and generator; ledger and numbering;
   Order-to-Cash; Procure-to-Pay and valuation; developer preview; pilots.
9. **Documentation follows code.** Framework documentation moves to `docs/framework/`, ERP
   documentation to `docs/erp/`; documentation of removed subsystems is deleted.

## Alternatives Considered

- **Odoo-style inheritance between modules:** rejected; patching other modules' models breaks
  invariants and upgrades.
- **SAP-style governance up front:** rejected; release governance comes after there are extension
  developers.
- **A single ERP application without a framework boundary:** rejected; it does not serve the goal of
  a developer platform.
- **Design the framework first and build the ERP later:** rejected; frameworks designed without a
  demanding application drift into speculation, which is the problem this ADR corrects.

## Consequences

- The superseded ADRs are marked accordingly; partially affected ADRs record the amendment.
- Phase 1 removes the listed infrastructure; Phase 2 moves code into `framework/` and `erp/` with
  `git mv`, keeping tests green after each step.
- Accounting domain types that still name TigerBeetle become unreachable and are simplified when
  the ledger and numbering are redesigned.
- Database objects of removed subsystems are dropped only through reviewed forward migrations.
- Reintroducing removed infrastructure requires a named need, measurement, and a new ADR.
