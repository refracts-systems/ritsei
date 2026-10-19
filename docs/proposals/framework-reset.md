# Proposal: Framework Reset

> **Status:** Approved by the owner on 2026-10-19 and recorded in
> [ADR-0091](../decisions/0091-adopt-framework-and-flagship-erp.md).
>
> **Owns:** The target shape of RITSEI as an ERP framework with a flagship ERP built on it, the
> case for breaking from the current platform-first foundation, and the phased sequence.
>
> **Related documents**
>
> - Decision: [`../decisions/0091-adopt-framework-and-flagship-erp.md`](../decisions/0091-adopt-framework-and-flagship-erp.md)
> - Canonical architecture today: [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)
> - Product vision: [`../product/vision.md`](../product/vision.md)

## 1. Goal

RITSEI becomes **an ERP framework for developers, proven by its own ERP**:

```text
framework/     kernel: modules, data, auth, API, events, UI kit, CLI generator
erp/           RITSEI ERP: flagship business modules, built exactly like third-party modules
extensions/    (later) modules from other developers and customers
```

The flagship ERP is the framework's first and most demanding user. Anything the ERP needs from the
platform must exist as a public framework capability; there are no internal shortcuts. When an
outside developer builds a module, they use the same APIs, generator, and extension points as the
RITSEI ERP team.

## 2. Lessons taken from existing ecosystems

| From | Take | Avoid |
|---|---|---|
| Frappe / ERPNext, Rails / Basecamp | The framework is **extracted** from a real application; the flagship app uses only public framework APIs | Designing the framework before an application exercises it |
| Odoo | Everything is a module; generators and conventions make building a module fast | Modules that patch other modules' models and views, which breaks invariants and upgrades |
| SAP S/4HANA + BTP | A clean core; extensions only through **released** APIs, events, and extension points | Heavy governance before there are extension developers |

The RITSEI rule is the combination: **Odoo-like ease of building modules, SAP-like clean core.**
A module never writes another module's tables or rewrites its logic; it uses public contracts,
events, and declared extension points (custom fields, validation hooks, approval steps, document
actions). Extension points are added when a flagship module needs one, so the extension API is
shaped by real use.

## 3. Diagnosis of the current foundation

Measured on 2026-10-19: about 63,000 lines of source, about 38,000 lines of documentation, 93
ADRs, 116 migrations, and zero tenants. The correctness foundation is strong: PostgreSQL integrity,
module ownership with public `mod.ts` contracts, Effect typed failures and layers, Drizzle schema
flow, UUIDv7, tenant-scoped capability authorization, Effect HttpApi, and a Solid SPA with a design
system.

What holds it back:

- **Speculative infrastructure** with gates and evidence programs but no user: a TigerBeetle ledger
  program, a Stateful Entity Runtime, workload cells and admission, an analytic plane, replaceable
  search providers, plugin trust tiers, Zig FFI, WebGPU rendering, a Document AST platform.
- **No framework/application boundary.** Platform services (identity, authorization, messaging,
  integrations, process engine) and business modules (sales, inventory, accounting) live side by
  side in `modules/`; the web app mixes UI kit and business features. Nothing tells a developer
  which parts are the framework.
- **No module developer experience.** There is no module manifest, generator, or documented
  extension point; adding a module means copying an existing one by hand.
- **No complete business loop.** The ERP cannot invoice, collect, pay suppliers, value stock, or
  produce financial statements, so the framework has never been exercised end to end.

## 4. Target structure

```text
framework/
  core/           ids, money, time, errors, concurrency            (from foundation/)
  data/           database contract, PostgreSQL adapter, migrations runner, outbox, jobs
  auth/           identity, authentication, authorization kernel   (from modules/auth, identity, authorization)
  http/           Effect HttpApi kernel, middleware, OpenAPI        (from runtime/api kernel parts)
  events/         transactional outbox and messaging                (from modules/messaging)
  integrations/   connectors, webhooks                              (from modules/integrations)
  documents/      document rendering                                (from foundation/platform document-rendering)
  process/        process engine (deferred, see Section 6)          (from modules/process)
  module/         module manifest, registry, extension points       (new, extracted from erp needs)
  ui/             design system, primitives, patterns, shell        (from apps/web/src/ui, app shell)
  cli/            `ritsei` CLI: new module, generate migration, check (new)

erp/
  party/ catalog/ sales/ procurement/ inventory/ accounting/ billing/
    each module: manifest, contract, service, store, schema, migrations, api routes, web pages, tests
  app/            ERP composition: which modules are installed, server and web entrypoints

extensions/       empty until outside modules exist; same shape as an erp/ module
```

Rules enforced by the existing boundary tooling (Fallow zones, `tooling/architecture.ts`):

- `framework/` never imports `erp/` or `extensions/`.
- `erp/` imports only the public entry points of `framework/` and of other `erp/` modules.
- `extensions/` imports only public entry points of `framework/` and `erp/`.
- A module owns its tables; cross-module work uses public contracts and events, never shared tables.

## 5. What is removed (archive by deletion; history stays in git)

| Removed | Replaced by |
|---|---|
| TigerBeetle adapter, engine selection, staging/readiness/cutover evidence program | A ledger port in the framework with one PostgreSQL implementation in `erp/accounting` |
| Stateful Entity Runtime and `celld` | Plain transactions and the job table |
| Workload planes, admission, cells, non-interference machinery | Separate API and worker pools, statement timeouts |
| Analytic plane | SQL reports and materialized views |
| Search provider architecture | PostgreSQL search behind a small framework port |
| Plugin trust tiers, capability release governance, plugin contribution model | Module manifest and released extension points (Section 6) |
| Zig FFI, `vgpu` and cartography renderers, Document AST platform | Nothing until measured need; PDF templates for documents |

Ports that keep the framework engine-neutral (ledger, search, identity provider, object storage)
stay, each with exactly one implementation that is used and tested. A second implementation is
added only when a real user needs it.

## 6. Framework capabilities, in the order the ERP pulls them

1. **Module manifest and registry:** name, version, dependencies, owned schema, capabilities,
   routes, web pages, events published and consumed, extension points offered. Derived first from
   the existing `erp/` modules.
2. **CLI generator:** `ritsei new module <name>` produces the full module shape with tests;
   `ritsei check` runs boundaries, types, and tests for one module.
3. **Extension points, added as the ERP needs them:** custom fields on documents, validation
   hooks, document actions, approval steps, and event subscriptions. Each is released with a
   version and a contract test.
4. **Document numbering and approvals** as framework services, because every ERP module needs them.
5. **Process engine:** deferred, not abandoned. It returns once Order-to-Cash and Procure-to-Pay
   run end to end, built on the extension points and events above.

## 7. Flagship ERP scope

The flagship ERP targets **Indonesian distribution and trading SMEs** first, so the framework is
proven against a real month of work. The domain model stays jurisdiction-neutral; Indonesian tax
specifics are a separate module after pilot feedback.

- **Masters:** company and branches, customers and suppliers (Party roles), products, units, price
  lists, warehouses, chart of accounts template, tax codes, payment terms, users and roles.
- **Order-to-Cash:** quotation, sales order, delivery, sales invoice, payment receipt, receivables
  aging, customer statement.
- **Procure-to-Pay:** purchase order, goods receipt, supplier bill, payment, payables aging.
- **Inventory:** stock by warehouse, transfers, adjustments, moving-average valuation.
- **Finance:** automatic journals from documents, manual journals, period close, trial balance,
  profit and loss, balance sheet.
- **Everywhere:** human-readable document numbers, PDFs, spreadsheet import, audit trail.

## 8. Phases

| Phase | Outcome | Exit criteria |
|---|---|---|
| 0. Decide | ADR-0091 accepted | Done |
| 1. Remove | Speculative infrastructure and its documentation deleted | Build, tests, and checks green |
| 2. Restructure | Tree becomes `framework/`, `erp/`, `extensions/` with enforced boundaries | Boundary checks fail on any `framework → erp` import; all tests green |
| 3. Module kernel | Module manifest, registry, and `ritsei new module` generator | A generated module compiles, migrates, serves an endpoint and a page, and passes its tests |
| 4. Ledger and numbering | PostgreSQL ledger in `erp/accounting`, numbering and approvals in the framework | Balanced journals and period close tested; numbered documents |
| 5. Order-to-Cash | Price lists, delivery, invoice, receipt, receivables | A seeded tenant invoices and collects; GL and stock reconcile in tests |
| 6. Procure-to-Pay and valuation | Receipt, bill, payment, payables, moving-average valuation | Stock valuation equals inventory GL in tests |
| 7. Developer preview | Framework docs, a "build your first module" tutorial, an example extension | An outside developer builds a module using only public APIs |
| 8. Pilots | 2–3 companies on the flagship ERP | Weekly usage and a backlog from real use |

## 9. Documentation after the reset

- `docs/framework/`: architecture, module contract, extension points, CLI, tutorial.
- `docs/erp/`: flagship ERP modules and business rules.
- ADRs only for decisions a future reader would otherwise reverse by accident.
- The design system stays and moves with the UI kit into the framework documentation.

## 10. Risks

| Risk | Containment |
|---|---|
| Framework designed in the abstract again | Every framework capability must have an `erp/` consumer in the same change |
| Restructure breaks imports and history | One mechanical move per phase step, `git mv` to keep history, tests green after each step |
| Extension API churn | Extension points are versioned and released only after an ERP module uses them |
| Removed capability needed later | Reintroduce with a named need and a new ADR; history is in git |
