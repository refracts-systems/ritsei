# ADR-0091: Adopt the Product Reset

- Status: Accepted
- Date: 2026-10-19
- Amends: ADR-0018 (Process Studio is frozen), ADR-0027 (search stays PostgreSQL-only; provider
  replaceability is withdrawn), ADR-0041 (PostgreSQL is the only financial authority), ADR-0059 (the
  native PostgreSQL relationship engine stays; the SpiceDB option is withdrawn)
- Compatible with: ADR-0001, ADR-0003, ADR-0012, ADR-0015, ADR-0042, ADR-0051, ADR-0068, ADR-0087,
  ADR-0090
- Supersedes: ADR-0007, ADR-0008, ADR-0020, ADR-0023, ADR-0025, ADR-0026, ADR-0034, ADR-0040,
  ADR-0043, ADR-0060, ADR-0064, ADR-0065, ADR-0070, ADR-0081, ADR-0083, ADR-0084
- Superseded by: None

> **Related documents**
>
> - Proposal and full rationale: [`../proposals/radical-product-reset.md`](../proposals/radical-product-reset.md)
> - ADR index: [`./README.md`](./README.md)
> - Repository rules: [`../../AGENTS.md`](../../AGENTS.md)

## Context

RITSEI built its foundation to a final enterprise form before any customer workflow existed:
about 63,000 lines of source against about 38,000 lines of documentation and 93 ADRs, with zero
tenants. A business still cannot invoice, collect, pay suppliers, value stock, or read a financial
statement, while the tree carries a TigerBeetle ledger program (2 of 16 activation gates), a
Stateful Entity Runtime, workload cells and admission machinery, an analytic plane, replaceable
search providers, plugin trust tiers, Business Packs, Zig FFI, a WebGPU renderer, and a Document
AST platform. The cost of the next feature is dominated by doctrine and gates rather than by the
feature. The full diagnosis is in the proposal.

## Decision

1. **Customer profile.** RITSEI targets small and mid-size **distribution and trading companies in
   Indonesia** first. Work that does not serve their month (Order-to-Cash, Procure-to-Pay,
   inventory, ledger, statements) is out of scope until pilots demand it. Indonesian tax specifics
   are a separate, validated milestone after pilot feedback.
2. **Keep the correctness foundation:** PostgreSQL as the single source of truth with constraints and
   transactions; module ownership and public `mod.ts` contracts; Effect typed failures, layers, and
   transactions; Drizzle schema and the pinned migration generator; UUIDv7; tenant-scoped,
   capability-based authorization; Effect HttpApi; the SolidJS SPA and the ADR-0090 design system;
   and the existing fast checks.
3. **PostgreSQL does everything until measured otherwise.** No second datastore, broker, ledger
   engine, or runtime is introduced without a named tenant's measured need and a new ADR.
4. **Delete, don't gate.** Capabilities off the next 90-day path are removed from the tree (they
   remain in git history), not kept behind activation gates. Removed or withdrawn:
   - TigerBeetle as a ledger engine and its activation, staging, readiness, and cutover-evidence
     program (ADR-0040, ADR-0064, ADR-0065); PostgreSQL is the only financial authority.
   - The Stateful Entity Runtime and `celld` (ADR-0025, ADR-0026).
   - Workload planes, admission, cells, and non-interference machinery (ADR-0034, ADR-0083); API and
     worker use separate connection pools and statement timeouts.
   - The analytic plane (ADR-0043); reports are SQL and materialized views.
   - Plugin trust tiers, capability release governance, and plugin contribution (ADR-0007,
     ADR-0020, ADR-0023, ADR-0084); a stable API and webhooks replace them later.
   - Zig FFI (ADR-0008), the `vgpu` renderer and the cartography renderer (ADR-0070), and the
     Document AST platform (ADR-0081).
5. **Freeze Process Studio** (ADR-0018). Its code stays but receives no new work; document approval
   rules (amount thresholds and roles) cover approvals for the target customer.
6. **Billing is in scope** (supersedes ADR-0060): invoices, receipts, bills, and payments are the
   core of Phases 3–4.
7. **Documentation follows code.** A rule exists only if code, a test, or a checked constraint
   enforces it, or if a human decision would otherwise be lost. Documentation for removed
   subsystems is deleted, and the architecture specification is consolidated.
8. **Sequence.** The phases, exit criteria, and target product are those of the proposal: decide;
   remove and consolidate; ledger and document numbering; Order-to-Cash; Procure-to-Pay and
   valuation; reports and onboarding; pilots; Indonesian specifics.

## Alternatives Considered

- **Keep the foundation and add product features on top:** rejected; every feature would keep
  paying for gates, evidence, and doctrine of subsystems no user needs.
- **Rewrite from scratch:** rejected; the correctness foundation, schema, and tests are sound and
  would be rebuilt at high cost.
- **Archive subsystems in an `attic/` directory instead of deleting:** rejected; dead code in the tree
  still costs reading, type checking, and agent context. Git history preserves it.

## Consequences

- The removed ADRs are marked superseded by this ADR; partially affected ADRs record the amendment.
- Phase 1 removes the listed subsystems in reviewable steps, keeping build, tests, and checks green
  after each step. Domain types that still name TigerBeetle in Accounting become unreachable once the
  adapter is removed and are simplified when Phase 2 redesigns the ledger and document numbering.
- Database objects that belong to removed subsystems are dropped only through reviewed forward
  migrations; applied migrations are never rewritten.
- Reintroducing any removed capability requires a named customer need, measurement, and a new ADR.
