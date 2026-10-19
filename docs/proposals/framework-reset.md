# Proposal: Radical Product Reset

> **Status:** Proposal for owner decision. Nothing in this document is accepted until the owner
> approves it and an ADR records the decision.
>
> **Author:** Coding agent, at the owner's request (2026-10-19).
>
> **Owns:** The case for, and the sequence of, a deliberate break from the current platform-first
> foundation toward a product-first ERP. It does not change any accepted rule by itself.
>
> **Related documents**
>
> - Canonical architecture today: [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)
> - Roadmap today: [`../roadmap/README.md`](../roadmap/README.md)
> - Product vision: [`../product/vision.md`](../product/vision.md)
> - ADR index: [`../decisions/README.md`](../decisions/README.md)

## 1. Diagnosis

RITSEI has a rigorous foundation and almost no product. Measured on 2026-10-19:

| Signal | Value |
|---|---|
| TypeScript source (excluding tests and generated code) | ~63,000 lines |
| Documentation | ~38,000 lines across 180+ files |
| Architecture decision records | 93 (78 accepted, 6 proposed, 7 superseded) |
| Migrations | 116 |
| Files that reference TigerBeetle | 37 (≈26,000 lines touched) |
| Financial activation gates passing | 2 of 16, production decision **NO-GO** |
| Real tenants, pilots, or paying users | 0 |

What a business cannot do today, even in a demo:

- issue a numbered invoice, receive a payment, or see what a customer owes (Billing is deferred by
  ADR-0060);
- receive a supplier bill, pay it, or see what the company owes;
- price an order from a price list, apply tax, or work in more than one currency;
- value inventory or see a profit-and-loss or balance-sheet report;
- read a document by a human number: every list shows UUIDs.

Meanwhile the repository carries specifications and partial machinery for capabilities that no
current user needs: a TigerBeetle ledger with a 16-gate activation program, a Stateful Entity
Runtime (`celld`), WorkloadCells and shuffle sharding, an analytic plane with provider gates,
replaceable search providers, a SpiceDB relationship adapter, Zig FFI, a WebGPU renderer, Business
Packs, progressive plugin trust, a Document AST platform, and a governed Process IR with a visual
designer.

The cause is not poor engineering. It is sequencing: every capability was designed to its final
enterprise form before the first customer workflow existed. Each decision is defensible in
isolation; together they mean the cost of the next feature is dominated by doctrine, gates, and
evidence rather than by the feature.

## 2. Thesis

> **Stop building a platform that could run any business. Build an ERP that runs one kind of
> business completely, then grow from evidence.**

The break is radical in what it removes, not in what it rewrites. The parts of the foundation
that protect correctness stay; the parts that anticipate scale, extensibility, and providers that
nobody has asked for are archived.

Principles for the reset:

1. **One customer profile first.** Pick a narrow ideal customer and make their whole month work.
2. **Complete loops over deep layers.** A shallow end-to-end Order-to-Cash beats a perfect ledger
   engine with no invoice.
3. **PostgreSQL does everything until measured otherwise.** No second datastore, broker, ledger
   engine, or runtime until a real tenant's measured load requires it.
4. **Delete, don't gate.** A capability that is not on the next 90-day path is removed from the
   tree (it stays in git history), not wrapped in activation gates.
5. **Docs follow code.** A rule exists only if code, a test, or a checked constraint enforces it, or
   if a human decision would otherwise be lost.

## 3. Proposed first customer profile

The reset only works with a concrete customer. The recommended default, to be confirmed by the
owner:

> **Small and mid-size distribution and trading companies in Indonesia** (roughly 5–100 staff):
> they buy goods, hold stock in one to a few warehouses, sell on credit to business customers, and
> need correct invoices, receivables, payables, stock, and monthly financial statements.

Why this profile:

- Order-to-Cash, Procure-to-Pay, inventory, and a general ledger cover nearly all of their work;
  no manufacturing, projects, or payroll is required to be useful.
- The existing modules (Party, Sales, Procurement, Inventory, Accounting) already point at this
  scope.
- It is a large, underserved market where spreadsheets and accounting-only tools are the common
  alternative.

Jurisdiction-specific behavior (PPN, e-Faktur, e-Bupot) must be validated with the owner and a tax
professional before it is implemented; the plan below keeps tax configurable and adds the
Indonesian specifics as a separate, explicit milestone.

## 4. What stays (the load-bearing foundation)

| Keep | Why |
|---|---|
| PostgreSQL as the single source of truth, with constraints, transactions, and RLS as defense in depth | This is what makes the ERP trustworthy |
| Module ownership: each domain owns its tables, exposes `mod.ts`, never writes another module's tables | Keeps the monolith changeable |
| Effect for typed failures, layers, and transactions | Already used everywhere; replacing it would cost more than it saves |
| Drizzle schema and pinned migration generator; UUIDv7 identities | Working and enforced |
| Tenant scope and capability-based authorization (simplified to roles → capabilities) | Required for any multi-user customer |
| Effect HttpApi, the SolidJS SPA, the Operational Clarity design system, and its tests | Recent, working, and small |
| Fast checks: format, lint, typecheck, boundary checks, Fallow, unit and browser tests | Cheap protection against regression |

## 5. What goes (archive by deletion, recoverable from git history)

| Remove or freeze | Replace with |
|---|---|
| TigerBeetle adapter, financial readiness/staging evidence, `financial:gate`, ADR-0040/0064/0065 program | A PostgreSQL double-entry ledger in Accounting: journals, lines, balance constraints, period close |
| Stateful Entity Runtime and `celld` evaluation (ADR-0025/0026) | Plain transactions and a job table |
| WorkloadCells, shuffle sharding, resource leases, workload planes (ADR-0034/0083 machinery) | Separate connection pools for API and worker, statement timeouts |
| Analytic plane and provider gates (ADR-0043) | SQL reports and materialized views in PostgreSQL |
| Search provider architecture (ADR-0027 beyond PostgreSQL) | `ILIKE`/trigram search on owned tables |
| SpiceDB adapter and relationship engine (ADR-0059) | Role → capability grants with tenant scope |
| Zig FFI (`native/`), `vgpu`, cartography renderer and grammar (ADR-0008/0070) | Nothing; reintroduce with benchmark evidence |
| Business Packs, plugin trust tiers, capability release governance (ADR-0007/0020/0023/0084) | A stable public API and webhooks |
| Process IR, catalogs, designer, and process runtime (ADR-0018) — **frozen** | Configurable approval rules on documents (amount thresholds, roles) |
| Document AST platform (ADR-0081) | Server-rendered PDF templates for invoices, POs, and delivery notes |
| PgQue messaging beyond an outbox (ADR-0033/0038) | Transactional outbox table drained by the worker |
| Most roadmap tracks and gate IDs | One product roadmap with customer-facing milestones |

Expected effect: roughly 25,000–35,000 lines of source and tests and 25,000+ lines of
documentation leave the active tree. The exact list is produced in Phase 1 by tracing imports, not
by guessing.

## 6. Target product for the first 6 months

A tenant can run its month end to end:

**Masters:** company and branches, customers and suppliers (one Party model with roles), products
with units, price lists, warehouses, chart of accounts from a template, tax codes, payment terms,
users and roles.

**Order-to-Cash:** quotation → sales order → delivery (reduces stock) → sales invoice (posts to GL)
→ payment receipt (allocates to invoices) → receivables aging and customer statement.

**Procure-to-Pay:** purchase order → goods receipt (increases stock) → supplier bill (posts to GL,
three-way match warning) → payment → payables aging.

**Inventory:** stock by warehouse, transfers, adjustments with reasons, moving-average valuation,
stock valuation report, low-stock list.

**Finance:** journals posted automatically from documents, manual journals, bank and cash accounts,
period close and reopen with audit, trial balance, profit and loss, balance sheet.

**Across everything:** human-readable document numbers per series (`SO-2026-00184`), PDF documents,
spreadsheet import for masters and opening balances, an audit trail, approval rules on documents,
email of documents, and exports.

Explicitly out of scope until pilots demand it: manufacturing, projects, payroll, CRM pipelines,
multi-currency revaluation, consolidation, marketplace plugins, and a visual process designer.

## 7. Phased plan

Each phase ends with a demo on real-looking data and a short written review.

| Phase | Duration | Outcome | Exit criteria |
|---|---|---|---|
| 0. Decide | 1 week | Owner confirms profile, removal list, and freeze of Process Studio | ADR "Adopt the product reset" accepted; ADRs listed in Section 5 marked superseded |
| 1. Remove and consolidate | 2 weeks | Archived subsystems deleted; docs collapsed | Build, tests, and checks green; docs ≤ 8,000 lines; ≤ 15 active ADRs referenced by code |
| 2. Ledger and numbering | 2–3 weeks | PostgreSQL double-entry ledger, period close, document number series, audit log | Balanced-journal and period constraints tested; trial balance from SQL |
| 3. Order-to-Cash | 4 weeks | Price lists, delivery, invoice, payment receipt, receivables aging, invoice PDF | A seeded tenant invoices and collects; GL and stock reconcile in tests |
| 4. Procure-to-Pay and valuation | 4 weeks | Goods receipt, supplier bill, payment, payables aging, moving-average valuation | Stock valuation equals inventory GL account in tests |
| 5. Reports and onboarding | 3 weeks | P&L, balance sheet, spreadsheet import, chart-of-accounts template, setup wizard | A new tenant goes from sign-up to first invoice in under 30 minutes |
| 6. Pilots | ongoing | 2–3 real companies on the system | Weekly usage, support log, and a prioritized backlog from real use |
| 7. Indonesia specifics | after pilot feedback | PPN configuration, e-Faktur export, local reports | Validated with a tax professional and a pilot customer |

## 8. How documentation and process change

- One architecture document (≤ 1,500 lines) replaces `architecture-spec-v4.md` and the subsystem
  specifications; the design system stays as its own document.
- ADRs are kept only for decisions a future reader would otherwise reverse by accident. The reset
  ADR supersedes the removed ones in one record instead of one record each.
- The roadmap becomes a product roadmap: customer-visible milestones, not gate IDs.
- Agent rules shrink further: correctness rules (ownership, transactions, constraints, tenant scope,
  typed failures, tests) stay; subsystem activation rules disappear with their subsystems.
- Definition of done for any feature: a user can complete the task in the UI, the numbers reconcile
  in a test, and the screen uses human-readable references.

## 9. Risks and how to contain them

| Risk | Containment |
|---|---|
| Removing work that will be needed later | Everything stays in git history and the reset ADR lists what was removed and why; reintroduce only with a named customer need and measurement |
| PostgreSQL ledger outgrown | SME volumes are far below PostgreSQL limits; keep the ledger behind the Accounting module boundary so an engine can be swapped later |
| Loss of the "platform" differentiation | The platform story is stronger after the product has users; a public API and webhooks keep integration open |
| Scope creep back into infrastructure | Phase exit criteria are user outcomes; any new infrastructure needs a measured problem and an ADR |
| Single-country focus limits the market | The model stays jurisdiction-neutral; Indonesian specifics live in a separate, optional layer |

## 10. Decisions needed from the owner

1. Confirm or change the first customer profile (Section 3).
2. Approve deletion (not gating) of the subsystems in Section 5, or mark any to keep.
3. Approve freezing Process Studio in favor of document approval rules for the next 6 months.
4. Approve replacing the TigerBeetle path with a PostgreSQL ledger.
5. Decide the commercial model (hosted SaaS, self-hosted support, or both), because it decides
   onboarding, billing, and operations work in Phases 5–6.

Once these are decided, Phase 0 produces the reset ADR and Phase 1 starts with an import trace that
lists exactly which files and documents are removed.
