# Phase 0: Foundation

> **Status:** Awaiting review
>
> **Roadmap gate:** `alchemy.foundation`
>
> **Related documents**
>
> - Phase index: [`./README.md`](./README.md)
> - Roadmap track: [`../../roadmap/alchemy-domain.md`](../../roadmap/alchemy-domain.md#foundation-alchemyfoundation)
> - Decision: [`../../decisions/0124-adopt-alchemy-domain-in-phases.md`](../../decisions/0124-adopt-alchemy-domain-in-phases.md)

## Scope

Make Alchemy Domain run inside RITSEI on its real host, with no rule changed and no aggregate moved.
Every later phase depends on what this phase proves or refutes.

## Prerequisites

- ADR-0124 accepted.
- A PostgreSQL 19 database reachable from tests.

## Deliverables

1. **Effect upgrade.** `effect` and every `@effect/*` package (`@effect/platform-node`,
   `@effect/platform-node-shared`, `@effect/sql-pg`, `@effect/vitest`) move from `4.0.0` to the
   4.1 line in their own change. `vendor/effect` is refreshed to the same version, because
   `AGENTS.md` makes it the reference for Effect code.
2. **Dependencies.** `@alchemy.run/domain`, `alchemy`, and `foldkit` pinned exactly in the root
   `package.json`, with the reason recorded beside them. `foldkit` and `alchemy` are required peers,
   not choices.
3. **Framework port.** An engine-neutral port in `framework/` that hides the host, with the
   in-memory host for tests and the Effect Cluster host for runtime. It lands together with its
   first ERP consumer (phase 1), per ADR-0091; until then it lives on the phase branch.
4. **Host table under migration control.** The host creates `alchemy_domain_objects` with
   `CREATE TABLE IF NOT EXISTS` at runtime. A reviewed migration creates it instead, an entry in
   `db/ownership.toml` names its owner, and the runtime role cannot create tables.
5. **Event protection.** The host's storage API updates and deletes keys. Whether recorded events
   are ever rewritten was not verified; this phase finds out and, if events and state share the
   table, protects event rows from update and deletion with privileges or a trigger.
6. **Pilot on the real host.** The nine `SAL-DLV-2` pilot stories run on Effect Cluster against
   PostgreSQL 19. The pilot lives outside the repository today; it is copied in as tests.
7. **History measurements.** An event recorded before a schema change decodes after it, and rebuild
   time per tenant is measured on a realistic volume.
8. **Database-enforced rules inventory.** A list of every rule PostgreSQL enforces today with a
   constraint, trigger, or privilege, and where each check moves when its aggregate leaves the
   tables.

## Exit evidence

The deliverables above, and the full validation list in `AGENTS.md` passing after the upgrade.

## Stop conditions

- The host does not run on PostgreSQL 19.
- Recorded events cannot be protected from update and deletion.
- A beta upgrade breaks the port with no migration path.

## Five views

This phase changes no rule, but the host's storage decides what later phases can keep. The views
below name the rules whose protection depends on PostgreSQL today.

- **Auditor.** Three rules rely on the database to keep records unchangeable: `ACC-OPEN-4` (journals
  are never deleted; a wrong one is corrected by a new, traceable entry), `INV-STOCK-2` (movements
  are never updated or deleted), and `SET-BANK-2` (a trigger forbids updating or deleting
  statements). Events take over that role for every aggregate that moves, so they need the same
  protection in the database, not by convention (deliverable 5).
- **Accountant.** No posting, period, or report changes. One rule to carry forward: `INV-VAL-1`
  keeps each valuation equal to its entries through a deferred database trigger; whatever replaces
  it in phase 4 must be as strict.
- **Systems engineering.** Several rules are enforced by PostgreSQL itself: `SAL-ORDER-1` (rejects
  changes to confirmed snapshots), `SAL-ORDER-3` (tenant-local composite constraints), `SAL-CUST-1`
  (rejects non-canonical and duplicate emails), `PRC-PO-1` (frozen confirmed order), `PRC-REL-1`
  (self-approval forbidden by the database), `TAX-PROD-1` (product tax defaults bound to codes of
  the same direction), and `BIL-RENDER-2` (artifact integrity). JSON state in
  `alchemy_domain_objects` has none of this, so deliverable 8 lists every such rule and where its
  check moves. The rest of the technical risk is the Effect upgrade, the beta dependency and its
  peers, a second connection pool, and a table created at runtime; backups and restores must include
  the host's table.
- **ERP engine development.** `SAL-AUTH-1`, `PRC-AUTH-1`, `INV-AUTH-1`, and `TAX-AUTH-1` deny by
  default per tenant, and `PRC-PO-4` makes a foreign-tenant record not found. The port decides
  where those checks run for stream-held aggregates; hiding the host behind it keeps a later engine
  change possible. Stories follow the repository's test rules: `@effect/vitest` imports and
  `assert` rather than `expect`. The event schema policy (optional fields only; a change of meaning
  is a new event) is written here once.
- **Warehouse operations.** Nothing changes for people handling stock; the stock rules
  (`INV-STOCK-*`, `INV-VAL-*`) stay on their tables.

## Open questions

- Does the port expose Alchemy's model classes directly, or a RITSEI wrapper?
- Where do tenant scope and authorization run: Alchemy middleware, `decide`, or the port?
- Which database role owns the host's table, and which roles may read it?

## Review record

| Date | Reviewer | Outcome | Notes |
| --- | --- | --- | --- |
| | | | |
