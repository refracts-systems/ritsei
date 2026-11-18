# RITSEI as a Migration-First ERP

> - **Status:** Reference and design proposal. The recommendations are for review.
> - **Owns:** The comparison snapshot and its implications for a migration-first RITSEI.
> - **Evidence checked:** 2026-11-19 against RITSEI `main` at `772fb7a`, Odoo 20.0, SAP Business One 10.0, and SAP S/4HANA Cloud Public Edition 2608.
> - **Read when:** Choosing ERP depth, planning an adoption or upgrade, or designing an extension that must survive releases.

> **Related documents**
>
> - Product identity and Business Packs — [RITSEI Product Vision](../../product/vision.md)
> - Framework boundary and composition — [ADR-0091](../../decisions/0091-adopt-framework-and-flagship-erp.md), [ADR-0094](../../decisions/0094-adopt-module-manifest-registry-and-generator.md)
> - Earlier parity plan and subsequent implementation — [ERP Module Parity Plan](../../proposals/erp-module-parity-plan.md), [ERP Build-out Handoff](../../proposals/erp-handoff.md)
> - Canonical rules — [state and consistency](../state-and-consistency.md), [financial ledger](../financial-ledger.md), [integration surface](../integration-architecture.md), [plugin architecture](../plugin-architecture.md)

## Decisions requested from reviewers

These are proposed defaults to debate. Each can change multiple domains and goes through the
[ADR workflow](../../development/documentation-workflow.md#adr-gate) before implementation.

1. **Opening balance semantics.** Every open AR, AP, and stock item is loaded by its owner
   against a `migration clearing` account. All other GL balances enter through one opening
   journal. Sign-off requires the clearing account to be zero per legal entity. See
   [section 4A](#a-scope-the-cutover-before-reading-files).
2. **Valuation method at cutover.** RITSEI values stock at moving average. A source on FIFO or
   standard cost is revalued once at the cutoff, and the difference is shown and approved as
   a named opening adjustment. See section 4A.
3. **First source adapter.** Choose by the first named pilot's incumbent, with Accurate,
   Zahir, Jurnal (Mekari), and spreadsheets considered before SAP Business One. Odoo remains
   a candidate where the pilot runs it, most likely release 14 to 17 rather than 20.
4. **Cutover date.** Default to the first day of a month, ideally the start of a fiscal year,
   so one SPT Masa PPN period is not split across two systems.
5. **Parallel run.** Read-only shadow comparison is allowed. Dual-write is not.
6. **Section 7 status.** It is a bounded follow-on experiment, not a step in the
   [recommended sequence](#recommended-sequence) of this proposal.

1. [The premise and evidence](#1-the-premise)
2. [ERP depth and what needs to migrate](#2-erp-depth-and-what-needs-to-migrate)
3. [Framework and extensibility](#3-framework-and-extensibility)
4. [The migration experience RITSEI should prove](#4-the-migration-experience-ritsei-should-prove)
5. [Work examples](#5-work-examples-that-make-the-requirements-testable)
6. [Upgrade, coexistence, and product decisions](#6-upgrade-coexistence-and-product-decisions)
7. [Migrate the module and its custom behavior](#7-migrate-the-module-and-its-custom-behavior)

## 1. The premise

Make **safe, repeatable migration one of RITSEI's highest product priorities**. For an Indonesian
trader or distributor, adoption should feel like continuing the business in a new system. The
operator should recognize the customer, the remaining units on an order, the balance still due,
the stock available to sell, and the invoice the customer already received. The accountant
should be able to explain where each opening number came from. The administrator should be able
to rehearse the same move and reproduce the evidence.

“Seamless” means the work is predictable and recoverable. The cutover window is agreed and
measured. Owners can see what will move, where exceptions are, and when operators can resume.
A failed import can resume without posting the same effect twice. Dates, document references,
balances, stock, authorization, and audit evidence keep their meaning. Claims such as zero
downtime, automatic conversion of every module, or parity with all source history require
separate proof.

This is a practical expression of **“Order governed by correctness.”** The [product vision](../../product/vision.md)
pairs running the business with designing how it runs. Migration should preserve business facts
and make local differences explicit enough to review. When an entire module is in scope,
carry the inventory of its standard and custom behaviors through the migration review.
The existing clean-core decision assigns every fact to an owner.
That makes migration easier to verify one fact at a time and makes extensions easier to
replace or retire without moving authority. [One semantic owner per invariant](../../decisions/0015-one-semantic-owner-per-invariant.md)

For a distributor, the flagship ERP supplies the business meanings and defaults. Imports,
extensions, and process design reuse those meanings. An external file must pass the same
inventory, money, and authorization boundaries as a native workflow. A Business Pack can
show how to configure an approved starting workflow. It remains a draft until the existing
approval and release steps are satisfied. The two choices help RITSEI support gradual change
while keeping PostgreSQL as the active financial authority and localization separate from
the neutral domains. [Business Packs](../../product/vision.md#business-pack-library) · [Financial authority](../../decisions/0092-retain-tigerbeetle-as-designated-ledger-engine.md) · [Localization](../../decisions/0016-isolate-jurisdiction-localization.md)

| Lifecycle | What must travel | Evidence that the move succeeded |
| --- | --- | --- |
| **Adopt RITSEI** from spreadsheets, Accurate, Zahir, Jurnal, Odoo, or another incumbent. SAP Business One is a design reference more than a likely source | Master data, opening positions, selected open transactions, source references, retained evidence, and the applicable module behavior | The opening position ties out, required custom behavior is accounted for, the first live transactions work, and the first period can close. |
| **Run in stages** while moving a second company, warehouse, or function | Agreed ownership by scope, integration mappings, and any authorized deltas | One operational writer for each scope, with visible exceptions and no duplicate accounting or stock effects. |
| **Upgrade RITSEI** in place, including a trusted extension | Schema evolution, data semantics, jobs in progress, public contracts, and configured behavior | Existing tenants, integrations, and released extensions still pass rehearsed business scenarios. |
| **Hand over data** to an auditor or successor system | Portable, permission-scoped records and evidence with reference IDs and versioned formats | A recipient can reconcile the export to the reported figures and find the underlying documents. |

### How to read the comparison

- **Available** means the RITSEI snapshot contains a public contract or a working surface for
  the stated behavior. **Partial** means some of the behavior exists and the named end-to-end
  experience is still open. **Gap** identifies capabilities for which the snapshot supplies no
  corresponding operational surface. The passing chain tests establish behavior for their
  fixtures, independently of tenant onboarding, rollout, or live support.
- Odoo means **20.0**, with Community add-ons distinguished from Enterprise apps or capabilities
  that depend on the deployment and edition. The columns are mostly version-generic. Customers
  to migrate are more likely on 14 to 17, so check version-specific behavior against the
  customer's release. See the [20.0 add-on tree][odoo-addons] and
  [edition comparison][odoo-editions].
- SAP Business One (B1) is the near-peer for a small distributor. S/4HANA Cloud Public Edition
  is the enterprise design reference. The two have different extension APIs and scope.
  Adjacent SAP products, availability by country, and extra licenses remain separate.
- **Documented** describes an observable feature, published contract, or public release item.
  **Inference** describes a design lesson drawn from those observations. Public SAP material
  does not establish internal transactions, storage layout across products, retry guarantees,
  or deployment topology. See the [Business One help][sap-b1] and [Public Edition help][sap-public].

## 2. ERP depth and what needs to migrate

The [generated runtime registry](../../../erp/runtime/modules.gen.ts) contains 13 ERP modules.
The [Order-to-Cash test](../../../tests/chains/order-to-cash.postgres.test.ts) and
[Procure-to-Pay test](../../../tests/chains/procure-to-pay.postgres.test.ts) exercise complete
business paths in PostgreSQL. The earlier [Parity Plan](../../proposals/erp-module-parity-plan.md)
records an older baseline before much of this was implemented. The
[handoff](../../proposals/erp-handoff.md) identifies what remains for a pilot.

| Business area | Odoo 20.0 | Public SAP evidence | RITSEI on `772fb7a` and migration implication |
| --- | --- | --- | --- |
| **Party, addresses, roles** | Contacts and partner records used in sales, purchasing, and invoicing. CRM is a separate app. [Add-ons][odoo-addons] | Public Edition Business Partner combines roles such as customer and supplier. Company code, plant, sales, and purchasing organizations are distinct. [BP][sap-bp] · [Org structure][sap-org] | **Available core.** `party` owns parties, roles, legal entities, branches, contacts, identifiers, and relationships. Keep source identities and roles separately mapped. Resolve duplicates and entity scope explicitly. Carry the party references used by open receivables, payables, and orders. |
| **Products, units, and classification** | SKU/variants, product types, units, and conversions. [Inventory documentation][odoo-inventory] | B1 item master supports warehouse settings, unit groups, and serial/batch valuation options. [Item master][sap-b1-item] | **Partial.** `product` owns SKU, product type, and unit codes. Map each sellable item and source unit. Require approved conversion rules where case and each differ. A source variant can map to a distinct SKU only when the target keeps the required price, stock, and identity distinctions. |
| **Sales, pricing, and fulfillment** | Quotation, sales order, delivery through stock integration, pricelists, and optional CRM link. [Sales add-on][odoo-sale] · [Sales and inventory link][odoo-sale-stock] | Public Edition documents pricing access sequences, connected document flow, and fulfillment monitoring. [Pricing][sap-pricing] · [Document flow][sap-docflow] | **Available core.** `sales` supplies quotation, order, delivery, and a credit gate. Import open order lines with quantities ordered, already delivered/invoiced, and remaining; retain agreed money values and references. Customer price rules and fulfillment exceptions remain opportunities. |
| **Procurement, buying terms, and receipts** | Purchase, RFQ, purchasing agreements, receipt, and stock/accounting bridge add-ons. [Add-ons][odoo-addons] | Public Edition exposes GR/IR exception monitoring. The user can identify receipt versus invoice differences and inspect open items. [GR/IR monitor][sap-grir] | **Available core.** `procurement` owns supplier prices, PO, approval, valued receipts, and returns. Import open PO lines and receipts not fully billed; align the remainder with `billing` and the relevant `accounting` control account. Purchasing comparison and an operational GR/IR worklist are gaps. |
| **Inventory, traceability, and valuation** | Locations, lots, serials, expiry, reorder rules, and landed costs. [Inventory documentation][odoo-inventory] | B1 has bins, batch/serial tracking, and perpetual valuation options. [Bins and batches][sap-b1-lots] · [Item master][sap-b1-item] | **Partial.** `inventory` has positions, moves, adjustments, reservations, transfers, and moving-average valuation in the tested purchase chain. Reconcile on-hand quantity and value independently. Reservations and goods in transit need an explicit cutover treatment. A pilot that requires lot/expiry traceability must establish that capability or leave the affected stock under the source's authority. |
| **Billing and open obligations** | Customer invoices, credit notes, vendor bills, and payment terms. [Accounting][odoo-account] | Public Edition billing supports document posting and PDF/email output. [Billing output][sap-output] | **Available core.** `billing` owns invoices, supplier bills, credits, and matched amounts. Migrate what remains due, the due date, source invoice number, and the relation to receipts or orders where needed. Keep already issued evidence and prevent historical sales or purchases from posting a second time. |
| **Payments and bank matching** | Payment allocation, bank statement workflows, and reconciliation, with depth varying by edition. [Bank reconciliation][odoo-bank] | B1 supports bank statements and external reconciliation. Public Edition documents automatic matching and a manual queue for exceptions. [B1 statements][sap-b1-bank] · [Bank statement processing][sap-bank] | **Partial.** `settlement` has incoming/outgoing payments, allocations, terms, aging, and customer statements. Bank statement import and manual reconciliation are open. Preserve unapplied cash and valid allocations independently of invoices. Match starting cash to statement evidence and the ledger. |
| **General ledger and close** | Journal entries, closing and reports. Multi-currency, assets, and deeper finance functions depend on enabled apps and edition. [Accounting][odoo-account] · [Editions][odoo-editions] | B1 offers trial balance, balance sheet, and P&L templates. Public Edition documents financial statement hierarchies and actual postings to the Universal Journal, including support for additional ledgers. [B1 reports][sap-b1-reports] · [Statement version][sap-fsv] · [Actuals and ledgers][sap-actuals] | **Partial.** `accounting` owns periods, exact money postings, chart setup, and journal history with PostgreSQL as financial authority. Trial balance exists in the API. A pilot needs imports with opening-balance evidence and usable P&L and balance sheet. Unsupported foreign-currency or parallel-ledger positions are scope decisions before loading them. |
| **Tax and Indonesia** | `l10n_id` and `l10n_id_efaktur_coretax` cover the Indonesian setup and Coretax XML flow documented for 20.0. [Indonesia][odoo-id] | Public Edition publishes Indonesian withholding reports and VAT OUT Coretax XML changes. [Indonesia][sap-id] · [Coretax 2608][sap-coretax] | **Partial.** Neutral `tax` owns computation and codes. `localization_id` Stage A supplies Indonesian chart/PPN and NPWP/NIK rules. Map codes and registrations by entity, retain historic filing evidence, and keep importer contracts neutral. Stage B covers dated rates, withholding and Coretax. The handoff excludes Coretax from month one of the existing pilot assumption. Reconfirm for a real tenant. |
| **Document trace, output, and communication** | QWeb PDF output, email/chatter, and edition-specific Documents and Sign apps. [QWeb Reports][odoo-report] · [Editions][odoo-editions] | Public Edition has output determination for PDF, email, print, and EDI by document type and configuration. [Output Management][sap-output] | **Partial.** `documents` composes read-only links across transaction owners. `communication` registers a PO-confirmation consumer. Invoice currently prints in the browser. Keep historic document bytes, references, and prior dispatch evidence where available. The pilot needs an immutable stored artifact and explicit delivery outcome before automating sends. |
| **Approvals and process operations** | Activities and automations, with additional Studio features in Enterprise. [Editions][odoo-editions] | Public Edition exposes business roles and standard process scope. Fulfillment and GR/IR show how an operator resolves a case. [Roles][sap-roles] · [Scope][sap-scope] | **Partial.** `framework/modules/approvals` is used in the procurement/bill variance paths. `process` has catalogs, validation and operational surfaces. Do not assume arbitrary source workflows can be imported as executable behavior. Map active cases to supported states, retain history, and require review of any approved replacement workflow. |
| **Onboarding and data portability** | CSV/XLSX import/export with External IDs for relation mapping and repeat imports. [Odoo import][odoo-import] | B1 Data Transfer Workbench uses business object templates. Public Edition Migration Cockpit simulates migration and monitors outcomes. [B1 DTW][sap-b1-dtw] · [Migration Cockpit][sap-migration] | **Gap.** Schema migrations, a bounded internal backfill, and localized setup exist. None provide a general operator import, preflight, rehearsal, and reconciliation experience. This gap cuts across every module above. |

Source links for the active RITSEI surfaces are the [module manifests](../../../erp/modules),
[database ownership registry](../../../db/ownership.toml), and [chain tests](../../../tests/chains).
The [document-chain ADR](../../decisions/0107-read-document-chains-through-a-documents-module.md)
is still Proposed in the snapshot even though its read path exists.
[Invoice output direction](../../decisions/0110-issue-invoices-as-immutable-numbered-artifacts-and-send-by-communication.md)
and [Indonesia Stage A and B](../../decisions/0111-sequence-localization-id-on-public-contracts.md)
are accepted decisions with work remaining.

### Breadth beyond the first segment

| Area | Market evidence | RITSEI choice under the migration premise |
| --- | --- | --- |
| **CRM and service** | Odoo Community has CRM. Enterprise bundles separate service apps. SAP Sales Cloud and SAP Service Cloud are adjacent offerings, with their own scope. [Odoo add-ons][odoo-addons] · [SAP Connect][sap-connect] | `party` and `sales` already cover trading identities and orders. Preserve the customer reference to the incumbent CRM. Add lead/opportunity or service authority when a named workflow needs it. |
| **Manufacturing, quality, maintenance** | Odoo includes MRP and Maintenance add-ons, with edition-dependent depth. Public Edition documents production engineering, planning, execution, and quality. [Odoo add-ons][odoo-addons] · [SAP Manufacturing][sap-mfg] | No equivalent flagship owner yet. Identify the work in progress and traceability evidence that would otherwise be lost before agreeing to migrate a manufacturer. |
| **Projects, time, HR, payroll, field service** | Odoo has Project, Timesheets and HR add-ons with edition differences. SAP offers separate suite capabilities at different scopes. [Odoo editions][odoo-editions] · [SAP suite direction][sap-sapphire] | Keep these workflows with their current owners for the first trading pilot. Exchange scoped parties, project references, or accounting outcomes only where a released contract serves the pilot. |
| **Commerce, POS, and channel operations** | Odoo has Point of Sale and Website Sale add-ons. SAP ecosystem coverage varies by product and add-on. [Odoo add-ons][odoo-addons] | Start with one channel connector when there is a named seller. Decide which system owns orders, item identity, inventory availability, and refunds before moving a channel. |
| **Advanced finance and group operations** | SAP Public Edition documents broader closing and consolidation scenarios. Odoo can also operate across companies, with edition-dependent functionality. [SAP Group Financial Close][sap-group] · [Odoo multi-company][odoo-company] | RITSEI can represent legal entities. Multi-entity posting and cutover scenarios need named tests. Parallel ledgers, financial consolidation, tax across countries, and detailed FX stay separate from a one-entity first close. |

## 3. Framework and extensibility

| Layer in RITSEI | Responsibility at the snapshot | What migration should ask of it |
| --- | --- | --- |
| [`framework/foundation`](../../../framework/foundation) | Shared contracts and primitives for money, identifiers, time, database, jobs, concurrency, rendering, and communication | Keep values and lifecycles stable across adapters. Extract a shared primitive after an ERP migration makes its reusable requirements concrete. |
| [`framework/platform`](../../../framework/platform) | Implementations for PostgreSQL, crypto, and document rendering | Operate schema upgrades, durable work, and resource bounds. Storage and provider choices remain behind their current boundaries. |
| [`framework/modules`](../../../framework/modules) | Auth, identity, authorization, approvals, custom fields, integrations, messaging, HTTP, numbering, and module/catalog infrastructure | Reuse typed authorization, contracts, delivery, and job semantics. Keep import adaptation separate from permission to execute a business command. |
| [`erp/modules`](../../../erp/modules) and [`erp/runtime`](../../../erp/runtime) | Flagship business owners and the composition of API, workers, migrator, and registered cross-module ports | Interpret the meaning and validity of records. The runtime can compose a sequence or an integration while each owner controls the mutation of its own facts. |
| [`apps/web/src/ui`](../../../apps/web/src/ui) and [`extensions`](../../../extensions) | Application design system and the intended location of third-party code. The extension folder contains its README at this snapshot. | Reuse existing workspace patterns for migration review and recovery. Prove a contributor slot with one real extension before publishing a more general UI SDK. |

| Concern | Odoo 20.0 | SAP public approach | RITSEI approach and next evidence |
| --- | --- | --- | --- |
| **Module composition** | `__manifest__.py` declares dependencies, version and data files. Database installation loads dependencies, and `auto_install` enables link modules such as `sale_crm`. [Manifest][odoo-manifest] | Public Edition activates approved scope and configuration content. Side-by-side apps integrate via released APIs and events. B1 separately publishes its Service Layer and SDK interfaces. [Scope][sap-scope] · [B1 Service Layer][sap-b1-api] | `manifest.ts` declares ownership, dependencies, capabilities, action/event catalogs, HTTP, and pages. Generation currently scans `erp/modules` and produces static imports. Keep this composition model for the first external package and prove one extension fits it. |
| **Cross-module composition** | Link add-ons bind independent apps, often using shared ORM extension. [`sale_crm`][odoo-sale-crm] | Public Edition defines extension and consumption contracts. RAP business behavior can be exposed in a service projection. [RAP][sap-rap] | Reuse Odoo's small link-module idea via released ports, commands, and events. Sales credit exposure already shows runtime wiring across Sales and Billing. An optional export or import adapter should connect owners without imposing a new dependency on either core. |
| **Model semantics and UI** | Python ORM inheritance, computed fields, XML view inheritance, and web registries. [ORM][odoo-orm] · [Views][odoo-views] · [Registries][odoo-web] | ABAP RAP exposes selected data and behavior through service definitions and bindings. Published C0 points include key user custom fields and selected UI adaptations. [RAP][sap-rap] · [C0][sap-c0] | Effect Schema, typed services, Drizzle persistence, and Solid workspaces already separate semantics from presentation. Reuse owner-released typed extension points. Keep the contract shared when a UI action is also a migration action. Avoid applying Odoo-style model or view patches to the flagship. |
| **Key user and external extensibility** | Studio and configurable settings supplement code add-ons. [Editions][odoo-editions] | Key user, developer, and side-by-side extension routes have distinct surfaces. BTP can consume released remote APIs/events. [Extensibility][sap-ext] · [Side by side][sap-side] | Custom fields on Product and Sales Customer are a concrete key user surface, backed by their released owner hooks. A first trusted extension can be built with RITSEI. A remote consumer can use the integration boundary where supported. Sandbox and arbitrary tenant runtime remain target designs. |
| **API lifecycle and compatibility** | Module upgrade scripts run at version transitions. External data identity is explicit when External IDs are used. [Upgrades][odoo-upgrades] · [Import][odoo-import] | C0 extends, C1 allows system-internal use, and C2 covers remote API use under stability contracts. Published states and successor objects help consumers migrate. [C0][sap-c0] · [C1][sap-c1] · [C2][sap-c2] · [Lifecycle][sap-released] | The existing catalog already has version, compatibility ranges, stability, and action/event semantics. The useful next increment is a compatibility fixture for a real older consumer, a documented successor for an actual deprecation, and support expectations for that consumer. The current catalog metadata check is a starting point. |
| **Authorization and company scope** | ACLs per model, record rules, and company-dependent settings. [Access][odoo-access] · [Companies][odoo-company] | Business-role catalogs bundle app access. Restrictions can bind access to organization attributes. [Roles][sap-roles] | Business capabilities, explicit tenant scope, and database defense in depth remain the basis. A source role called “Manager” needs review of the target grants and scope. Proposed migration duties can separate uploader, approver, and executor for high-impact facts. |
| **SDK versus transport** | Application model extensions and external data interfaces provide separate paths. | RAP distinguishes business behavior from its service transport. B1 Service Layer is OData V4. [RAP][sap-rap] · [B1 API][sap-b1-api] | Keep Effect service semantics and the HTTP/integration adapters separate. Use platform-owned connectors for source protocols and stable failure translation. Portability comes from consistent meaning, not adopting either vendor's transport as the internal domain model. |
| **Integrations, events, and recovery** | Add-ons and automated actions share the application environment. | Released business events, communication arrangements, and external runtime consumers define a controlled exchange surface. [SAP events][sap-events] · [Communication management][sap-comm] | RITSEI has a transactional outbox, jobs, and connector governance. Publish committed facts through the existing boundary. Import jobs need resumability and intentional event behavior. An external recipient belongs outside the transaction that changes stock or posts a journal. |
| **Configuration and onboarding** | Module data/demo fixtures, settings, and flat-file import provide a low-friction start. [Manifest][odoo-manifest] · [Import][odoo-import] | Scope, organizational configuration, migration objects and simulation split setup into reviewable steps. [Scope][sap-scope] · [Migration Cockpit][sap-migration] | Build on the existing Indonesian setup command, typed module contracts, and the idea of a Business Pack. A pack can explain which defaults and prerequisites to configure. Business data still goes through owners, and activation or grants require their authorized path. |
| **Release and upgrade rehearsal** | Versioned pre/post/end module upgrade scripts and tooling give explicit places for conversion. [Upgrades][odoo-upgrades] | Public Edition supports post-upgrade smoke tests against quality/test tenants and transports controlled changes. [Post-upgrade testing][sap-test] | Keep forward, ordered and checksummed schema migrations. Add rehearsal of one customer fixture on the new release with a real older extension, verify the in-flight job policy, then exercise the first transaction and close. Schema drift checks alone cannot establish semantic compatibility. |
| **Analytics and AI** | Reporting and BI depth depend on apps and edition. | Public Edition exposes CDS projections and analytical queries. SAP has announced additional managed data products and agent experiences. [CDS][sap-cds] · [SAP Business Data Cloud][sap-data] | Start with owner-defined, reconciled report queries, consistent as-of dates, and typed commands. Operational transactions stay authoritative. The separate analytics and workload isolation designs remain inactive under [ADR-0093](../../decisions/0093-retain-isolation-runtime-and-analytic-target-designs.md). |

The implementation anchors for the comparison are the
[module manifest and registry checks](../../../framework/modules/module/src/manifest.ts),
[released contract catalog](../../../framework/modules/module/src/catalog.ts),
[compatibility test](../../../erp/runtime/catalog-compatibility.test.ts),
[PostgreSQL migration catalog](../../../framework/platform/postgres/migrations.ts),
[custom-fields decision](../../decisions/0109-release-custom-fields-as-an-extension-point.md),
and [FinancialLedgerPort composition](../../../erp/runtime/adapters/financial-ledger.ts).
ADR-0091 already chooses extension by contribution and delays heavier governance until there
is a real extension developer. The recommendation is to test that promise with one deployment
before adding any new extension platform.

### What can be inferred from SAP news and release notes

| Public observation | RITSEI design inference | Where the evidence stops |
| --- | --- | --- |
| SAP 2608 publishes an overview of changes to objects released for developer, key user, and remote use. [Release notes][sap-ext-notes] | Communicate changes at the owner boundary. A small changelog for actions, events, and released slots is more useful to a real extension than describing every internal refactor. | The notes describe supported surfaces. They do not show the underlying implementation or guarantee that any two deployments have the same active scope. |
| SAP added supply blocks to fulfillment monitoring and documents GR/IR worklists. [Supply block release][sap-fulfillment] · [GR/IR][sap-grir] | Make unresolved business conditions visible and actionable. One operator view for received goods with no supplier invoice can help migration reconciliation and serve daily operations afterward. | The worklist does not reveal SAP transaction boundaries or matching internals. RITSEI can compose owner queries on PostgreSQL with explicit freshness. |
| SAP announced Business Data Cloud, managed data products, and Joule experiences grounded in business context. [Business Data Cloud][sap-data] · [SAP Connect][sap-connect] | Agents benefit from the same stable IDs, traceable origin, permission-scoped queries, and typed actions that migration needs. A future agent should be able to explain why a payment is unallocated using the evidence the operator sees. | Product announcements indicate direction. They do not establish general availability, licensing, or safety guarantees for all installations. |
| SAP publishes separate setup guidance for output, withholding, and Coretax changes. [Output][sap-output] · [Coretax 2608][sap-coretax] | Separate statutory versioned output from core sales and make the rendering and sending stages visible. Keep the bytes and version already used for a sent document. | The sources establish SAP's exposed output behavior, not the retention and audit design appropriate for RITSEI. |

## 4. The migration experience RITSEI should prove

Odoo demonstrates approachable tabular intake, a test step, and identifiers that preserve
relations across imports. SAP provides a useful discipline for scope, migration objects,
mapping tasks, and rehearsals. Business One's opening balance guidance makes the accounting
risk concrete. Open documents may already establish partner and stock balances, so importing
those balances separately can duplicate them. These are examples to learn from. The steps
below are proposed for RITSEI. [Odoo import][odoo-import] · [SAP migration process][sap-migration-steps] · [SAP B1 opening balances][sap-b1-opening]

### A. Scope the cutover before reading files

Record the source instance and version, target release, tenant, legal entity, warehouses,
fiscal period, time zone, cutoff instant and business date, supported currencies, and expected
source counts and totals. Agree which team owns finance, stock, customer and supplier data,
and the operational handover. Inventory source reports, SQL-free extraction options, and
independently reviewable control totals before choosing a connector.

If the cohort includes an installed module, build its
[capability and customization tree](#7-migrate-the-module-and-its-custom-behavior) during
scope review. Customers can keep a cohort in the source when a required leaf has no target
owner or no safe successor.

Decide the disposition of each class of record. SAP's published initial migration scope
includes open items and open orders and distinguishes them from closed historical processes.
RITSEI should make the same distinction in its own terms. [SAP initial data scope][sap-initial]

| Disposition | When to use it | How operations continue |
| --- | --- | --- |
| **Native master** | An item, party, unit, warehouse, or tax identity is needed on day one | A RITSEI owner validates it and records the source reference. Existing documents can resolve it consistently. |
| **Opening position** | Stock quantities and values, ledger balances, open AR/AP, and unapplied cash affect today's business | Owners establish approved starting positions at the cutoff. Proposed default below. |
| **Open process** | An order or receipt is partly fulfilled and must continue after the move | Preserve the line-level remainder, the supported open state, and its source links. Test the next normal business action in RITSEI. |
| **Read-only history** | A closed record is needed for audit, returns, reference, or customer support | Retain the approved evidence and a reference. If a later action requires a link or a reversal, its owner defines the supported route from that reference. |
| **Retained in source** | The target lacks a required semantic, contract, or jurisdictional capability | Keep that scope owned by the source and document its handoff condition. A blocked capability is visible in scope review before anyone changes authority. |

**Proposed default for opening positions.** Each open AR, AP, and stock item is loaded by its
owner (`billing`, `settlement`, `inventory`) with the offsetting entry in a `migration clearing`
account. Every other GL balance, such as cash, fixed assets, equity, and accruals, enters through
one opening journal per legal entity. Control accounts for AR, AP, and stock receive their
balance only from the owner loads, never from the opening journal, so no amount is counted
twice. Sign-off requires the clearing account to be exactly zero per legal entity at the
cutoff. A nonzero balance is a blocking exception. This is the duplication the Business One
guidance warns about, turned into a testable rule.

**Valuation at cutover.** RITSEI values stock at moving average. When the source uses FIFO or
standard cost, load quantities with the source's value, revalue once to moving average at the
cutoff, and record the difference as a named, owner-approved opening adjustment. Report it
beside the control totals. Do not carry the source's valuation layers into the target.

**Cutover date and tax period.** Default to the first day of a month, ideally the start of a
fiscal year. A cutoff in the middle of a tax period splits one SPT Masa PPN across two systems
and needs its own written filing plan.

**Indonesia-specific cases to state before the pilot.**

- An invoice that already has a faktur pajak in Coretax and is returned or corrected after
  cutover needs a nota retur or replacement faktur that references the original. While Coretax
  is excluded from month one, this runs manually and the runbook names who does it.
- Partial payments on open receivables must state how PPh 23 withheld by the customer is
  treated: the bukti potong, the residual, and the receivable it clears.
- Identifiers such as NIK, NPWP, and employee data are personal data under UU PDP (No. 27 of
  2022). Minimization, access, retention, and deletion in the staging area follow from that
  law, and the legal basis is recorded for the pilot. Legal review is outside this document.

**Parallel run.** Customers will ask for one. Allow a read-only shadow comparison, where the
target is loaded from the same snapshot and its controls are compared with the source while
the source stays authoritative. Do not allow dual-write. Two writers produce two stock and
ledger histories that cannot be reconciled, which breaks the one-writer-per-scope rule in
section 4E.

### B. Stage and map without producing business effects

Start with one well-understood CSV/XLSX export for a named distributor. Record the file checksum,
source/version, mapping revision, uploader, and scope. A repeat intake should identify the same
source record through a namespace combining target tenant, source instance, object kind, and
stable source ID. Use a documented, explicitly approved business key only when there is no
stable exported ID. Ambiguous matches, reused keys, or changed content after approval become
visible exceptions.

The identity map relates the source reference to a native ID. RITSEI creates new persistent IDs
according to its UUIDv7 policy. Source document numbers and receipt or payment references remain
business references. Preserve an already issued number in its proper audit context, and review
any collision with native numbering before cutover. The source snapshot and sensitive fields
need scoped access, minimal retention, and a clear deletion or archival policy. Import logs
carry safe references and errors, without leaking supplier bank data, identity numbers, or
credentials. [Identifier policy](../../../AGENTS.md#identifier-policy) · [Document numbering](../../decisions/0095-adopt-gapless-document-numbering.md)

Treat the mapping as an owner-reviewed dependency plan. A typical order is legal entity and
chart setup, then parties and products, then stock and open obligations, then live order and
receipt remainders and cross-checks. The precise posting order depends on the approved
opening-balance policy. Domain commands own the meaning of the transfer. The intake format
does not authorize an administrator to write arbitrary persistence rows.

### C. Rehearse inputs and the operating position

A validation preview shows accepted rows, blocking errors, unresolved matches, reviewed
exceptions, and the expected impact by legal entity. For each blocker, identify the source
record, field or condition, owner who can decide it, and an actionable remedy. A spreadsheet
import may parse and validate in stages. When checking behavior needs real posting semantics,
rehearse against an isolated, approved target with outbound channels disabled. Use source
fixtures and exact owner validators where available. Avoid claiming that a parser check proves
what real posting, authorization, numbering, and corrections will do.

The dry run must leave live numbering, stock, ledger, communication, and authorization
untouched. Save the rehearsal's counts, exception dispositions, totals, and durations. If a
source bundle or mapping changes, invalidate the affected rehearsal approval. Verify the same
bundle can be durably resumed after interruption and a retry does not repeat an already
committed business effect.

Existing pieces to evaluate first include the
[Accounting opening-balance verifier](../../../erp/modules/accounting/src/financial-readiness.ts),
which compares exact mapped balances,
[the scoped internal P0 backfill](../../../erp/runtime/migrator/p0-backfill.ts),
which checks mapping coverage for its narrow purpose, and
[Indonesia Stage A setup](../../../erp/modules/localization_id/src/layers.ts),
which uses owner services. The
[PostgreSQL migrator](../../../erp/runtime/migrator/mod.ts) updates schema, independently of
customer import. None of these pieces establishes the proposed operator experience by itself.

### D. Sign off against independent control totals

Compare source controls captured at the agreed cutoff with target data read back through
authorized paths. Record the source report, target query, owner, approver, accounting date,
dimensions, and explanation of any permitted adjustment. Use exact minor units and the
owner's currency semantics for comparisons. A missing source report is an evidence exception,
not an assumed zero.

| Control | What should match or be explained |
| --- | --- |
| **Identity and permissions** | Every in-scope record is mapped, deliberately excluded, or blocked with an owner. Validate cross-references, tenant and entity scope, and positive and negative access checks. Privileged source users do not gain implicit target privileges. |
| **General ledger** | Opening trial balance per legal entity and account ties to the approved source and balances exactly. The migration summary can be traced to owning entries and auditable adjustments. |
| **AR, AP, and cash** | Document residuals, due dates, credits, and unapplied payments tie to control accounts as of the cutoff. Outstanding charges and already paid amounts are represented once. Imported bank evidence distinguishes cleared amounts from genuine outstanding items. |
| **Stock** | Quantities, reservations, goods in transit, and valuation agree by the dimensions supported by the cohort. Inventory value reconciles to the appropriate ledger control account. Lot, expiry and unit conversion exceptions are visible. |
| **GR/IR and open orders** | Purchase receipts, invoices and returns explain received-but-not-invoiced amounts per line. Sales delivered and invoiced quantities plus the remaining quantities agree with the source. A subsequent receipt, delivery, or bill exercises that position without duplicating history. |
| **Tax and output** | Statutory identity and dates are preserved. Historic issued documents are retrievable under proper authorization; the first new invoice has its own correct numbering and output. Pending historical dispatches are reviewed separately. |
| **Operational handover** | A permitted operator can receive, sell, invoice, collect, pay and close in the target. Failed inputs have a human recovery path. Source exports and migration jobs stay within bounds measured on the pilot. |

The native [O2C and P2P fixtures](../../../tests/chains) already check that aging ties to the
ledger at an as-of date and that purchase valuation and GR/IR resolve correctly. The
[Accounting HTTP contract](../../../erp/modules/accounting/http.ts) already exposes trial
balance. Reuse that evidence to design import verification. Opening positions from an incumbent
need their own test inputs and an operator-facing close, including P&L and balance sheet.

### E. Transfer authority once per scope

Rehearse the operational freeze and recovery procedure before scheduling the live cutover.
Use a final snapshot at the agreed cutoff. Add a delta only when the source offers a meaningful
change boundary with verified coverage. For each legal entity or process in scope, record
which system can accept writes, when that changes, and how inbound automation behaves.
Authorized migration operations can prepare the target while its ordinary operators and
integrations remain blocked. Release the freeze on target operations after approval of the
cutoff controls. Concurrent operation across scopes can work if the ownership split is
explicit and tested.

Apply the approved plan through owner commands and record durable checkpoints for the completed
effects. A stable per-operation idempotency key is distinct from a job lease or the approved
snapshot identifier. Use transactions for synchronous invariants, the outbox for appropriate
committed facts, and jobs for resumable work. Historical import should not trigger routine
customer email, EDI, stock requests to external providers, or automatic payments. The owners
still record the change and can decide which facts require a dedicated, explicit notification.
[State and consistency](../state-and-consistency.md) · [Events and messaging](../pgque-messaging.md)

Before the target accepts authoritative live writes, an unsuccessful cutover can leave or
return operational authority to the source under the agreed runbook. Once the target has
accepted live obligations, deliveries, payments, or other authoritative facts, changing
authority becomes incident recovery. Assess what committed, freeze the affected scope, and
use approved reconciliation, reversals, compensation, or data recovery. Restoring a pre-cutover
snapshot can erase live facts and must never be the default fallback at that point.

### F. Prove continuity after go-live and at exit

Run the first sale, delivery, invoice, receipt, purchase receipt, bill, and payment with sampled
links back to the starting state. Reconcile bank and ledger at the first close. Give the
tenant a portable, permission-scoped extract of masters, open positions, journal evidence,
and document references for the agreed scope. Version the export and include currency,
unit, identifier, and as-of definitions. Demonstrate that someone independent of the import
can reproduce the key control totals from the export. The source archive remains readable
for its agreed retention window.

| Pilot measure | Proposed success rule |
| --- | --- |
| Unexplained differences in financial and stock controls | **Zero** before handover within the agreed scope. Approved adjustments have owner and audit evidence. |
| Duplicate committed effects on retry, resume, or replay | **Zero** business duplicates for the tested operations. Exercise failure after a commit but before acknowledgment. |
| Known scope and exceptions | Every in-scope source object has a disposition. No blocking exception is left unresolved at go-live. |
| Cutover and recovery time | Record rehearsal, freeze, verify and reopen times and meet a target agreed with the named pilot. Record the measured recovery time independently. |
| Operator continuity | No off-system re-keying for the accepted contract and first-close scope. Measure manual interventions and reasons. |
| First close | Evidence includes the signed opening controls, subsequent stock and cash movement, AR/AP, trial balance, P&L, balance sheet, and traceable corrections. |
| Operational impact | Measure command latency and resource use with the migration job at its intended batch size. Use the results to choose bounds or a maintenance window before making an isolation claim. |

## 5. Work examples that make the requirements testable

### Opening invoices and payments

A customer invoice was issued for Rp10 million, with Rp6 million received before the cutoff.
The customer still owes Rp4 million. Preserve the original invoice number, due date, evidence,
currency, and original/residual distinction. An opening receivable and the GL control balance
must each represent the same outstanding Rp4 million under the agreed posting design.
Do not rerun the old delivery, charge the customer again, or treat the already received
Rp6 million as a new target payment. An unapplied credit or advance requires its own approved
disposition. After cutover, collecting the remaining Rp4 million should settle the open item
and produce exactly one new payment effect.

### Receipt with no supplier invoice

A supplier PO ordered 100 units. Sixty were received and capitalized before cutoff. None of
those sixty have been billed. Establish what is in stock, its approved value, the GR/IR
obligation for the received quantity, and the forty-unit delivery remainder. Test billing
the sixty against their approved receipt basis and receiving the remaining forty afterward.
The first action clears the corresponding GR/IR position without increasing stock a second
time. The second creates a new receipt at the correct date. Flag any missing receipt cost
or unsupported receipt-to-bill history before transferring write authority.

### Batch identity that must survive

Two batches of the same item have different expiry dates and quantities. A target SKU-level
balance might match the total while losing the evidence needed for expiry-based picks and
recalls. For a pilot that relies on that capability, track each batch with origin, dates,
quantity, location, and valuation treatment or keep the affected stock under source authority
until the target can carry it. A matched total alone cannot approve this cutover.

### One trusted extension through an upgrade

A supplier portal wants a copy of a confirmed PO. A concrete first extension can consume the
[public `procurement.purchase_order.confirmed` event](../../../erp/modules/procurement/src/events.ts).
The event is versioned and delivered at least once. The payload is deliberately small.
The extension reads the additional required fields through an authorized query from the
owner, maps to the partner format, and handles retries through the integration boundary.
If delivery acknowledgment is uncertain, reconcile the partner reference or quarantine the
case according to the connector contract. Demonstrate that upgrading RITSEI with an older
extension fixture does not duplicate logical delivery, grant broader reads, or change what
the owner considers a confirmed order.

## 6. Upgrade, coexistence, and product decisions

### Product and extension upgrades

The product uses one SemVer authority and versioned released contracts. Bundled ERP modules
are composed with the product. The customer-facing promise is about which combinations
remain supported, including an older extension fixture, rather than giving every flagship
folder an independent version. [Product versioning](../../decisions/0066-adopt-single-product-semver-authority.md) · [Module registry](../../decisions/0094-adopt-module-manifest-registry-and-generator.md)

For the first supported release-to-release path, restore a scoped and authorized rehearsal
snapshot, verify the migration catalog, and compare business control totals before and after.
Test deserializing supported older event/command payloads. Review unresolved jobs and outbound
deliveries before enabling replacement workers. When a change requires coexistence of older
and newer processes, prefer adding compatible storage or fields first, switching the
application, then performing a resumable backfill. Remove the older representation after
its last supported consumer and data are accounted for. Exact support windows, retirement,
and backward compatibility are release decisions, not implied by this reference.

Odoo's environments document upgraded test databases and the need to update custom modules.
SAP Public Edition documents post-upgrade tests on quality/test tenants. RITSEI should use
a real migration fixture and domain tests for the proof, then run the same operating path
after upgrade. A schema-compatible application rollback and restoring a production data
snapshot have very different effects on work accepted after an upgrade. [Odoo upgrade rehearsal][odoo-upgrade-test] · [SAP upgrade rehearsal][sap-test]

### Coexistence and exports

A customer may keep payroll, CRM, or a specialist warehouse outside RITSEI. Write down who
owns each exchanged fact, whether data is a snapshot or an event, the identifier relationship,
and how lag or mismatches are resolved. A source-to-target export for entering the ERP and a
target-to-recipient export for evidence serve different contracts. Both should be versioned
and permission-scoped. Supporting one Odoo file layout or one Business One export proves that
adapter and profile; broader source support needs its own fixtures.

### Recommended sequence

| Step | First slice | Evidence to proceed |
| --- | --- | --- |
| **1. Identify a first customer and cutover cohort** | One Indonesian legal entity, one known source export, a stated base currency, and a documented list of required features such as lot tracking | Validated exports, source control totals, agreed historical disposition, and a named approver per domain. |
| **2. Rehearse an opening position** | Scoped master and opening imports, owner commands, approved mapping, per-record errors, checkpoints, and reconciliation | Retry and interruption do not duplicate effects, stock and AR/AP tie to the ledger, and an operator can continue one partial order and one partial receipt. |
| **3. Support the first reconciled close** | Bank statement import and manual matching, report output and drill-through, and invoice artifact delivery in the existing manual-first direction | Run a representative month in the rehearsal environment. Capture the first live close and any remaining work that required a spreadsheet. |
| **4. Handle the first real recurring exception** | An owner-composed GR/IR worklist is a candidate. Another is an order blocked by credit or stock, depending on pilot volume and cost | Every listed case has a reason, authority, and valid next action. Correcting it changes the owner facts and clears the worklist case. |
| **5. Prove external contribution and upgrade** | One supplier PO exporter or other named extension, built through the same composition path, running against a supported old fixture | Install, exercise, upgrade, retry and retire it with explicit contract expectations. Extract common framework code only after seeing real repeated needs. |
| **6. Expand depth and portability** | A second source format, a second tenant cohort, a measured need for lot/expiry or pricing, or an explicit localization requirement | Capture what changed in mapping, cutover, reconciliation and support. Evidence determines the next ERP owner or framework primitive. |

The first design reviews should settle the items in [Decisions requested from reviewers](#decisions-requested-from-reviewers).
Pick the first source adapter from the pilot's actual incumbent and market data, not from
whose documentation is tidiest. Section 7 is a follow-on experiment that starts only after
steps 1 and 2 have run. It is not one of the six steps. Volumes (SKUs, open documents, ledger
lines), the target cutover duration, and team size are not yet known. The pilot agreement must
state them, because the pilot measures below depend on them.

## 7. Migrate the module and its custom behavior

> **Status:** a bounded follow-on experiment, outside the recommended sequence. It is not
> committed roadmap and starts only after a real opening-position cutover has run.

**What it costs and what it assumes.** Finding the effective behavior of an Odoo customer is
hard. Behavior comes from `super()` chains, monkeypatches, server actions, Studio changes,
`ir.rule` records, stored computed fields, and OCA modules, and no static reading is complete.
Using source fixtures as an oracle also requires a runnable copy of the customer's Odoo at
the customer's version. That copy, its hosting, and the person who can operate it are a
precondition the customer must supply. Customers are more likely on Odoo 14 to 17 than 20, so
the first fixtures should match their release. Verify any claim about release 20 changes
(for example bank-journal consistency, simplified access rights, and MCP) against the
official release notes before relying on it.

Data migration carries the records. Module migration also carries what the source
does with those records and how that behavior differs for this customer. The proposed unit of
review is **one source module as a tree of business capabilities**. The root is the module,
branches are recognizable jobs or submodules, and leaves are separately observable rules,
fields, actions, outputs, or side effects. Each leaf has its own migration decision. The
tree also records standard behaviors whose semantics matter to the imported customizations.

**Preserve the full inventory even when conversion is partial.** The generator must produce
a verified mapping or implementation, a draft awaiting evidence, or an explicit blocker
for every discovered custom behavior in the agreed scope. This is **inventory closure**.
Discovery can be incomplete where evidence is inaccessible if the report names the missing
coverage. The detailed inventory stays traceable even when AI has resolved the work.

**Who decides what.** AI can close technical findings alone: format mismatches, type and
dependency errors, missing fixtures, and failing replay checks. Any leaf that touches money,
stock, or authorization still needs a human sign-off by the fact's business owner, however
fast the review is. So an operator may have nothing left to decide on technical findings,
but a signature remains for those leaves.

### The tree places capabilities and the graph records dependencies

The tree gives the reviewer a stable place to ask where a customization belongs. A source
file can implement several leaves. Conversely, a single effective rule may be assembled
from standard code, a later override, a local setting, and a scheduled action. The migration
keeps each source artifact and its provenance linked to the affected leaves. It also records
dependencies across branches and modules as a graph. A source dependency cycle is evidence
to inspect before the target is composed. The compiled RITSEI module graph still follows
the existing ownership and acyclicity rules. [Module registry](../../decisions/0094-adopt-module-manifest-registry-and-generator.md)

This illustrative tree uses a distributor's Sales module because it is the first segment in
scope. It is a migration example and does not describe a particular customer's implementation.

```text
Sales
├── Order entry
│   ├── Carton quantity custom field and unit conversion
│   ├── Per-salesman discount approval threshold
│   └── Order confirmation notification
├── Credit
│   ├── Customer credit limit per salesman
│   ├── Block on overdue invoices
│   └── Release of a blocked order by a manager
└── Pricing
    ├── Customer-specific pricelist
    ├── Custom rounding rule on carton price
    └── Monthly price export to a channel
```

The monthly price export depends on Pricing, Product, and an external channel contract. The
credit leaves depend on open receivables owned by `billing` and `settlement`. Where the source
Sales module also reads an Accounting model, capture what it reads or changes and why. Target
composition would use released contracts owned by those modules. The tree remains navigable
even if the target implementations span several packages.

### Analyze the installed behavior before generating

1. **Capture the source and the visible scope.** Record the source product, release, installed
   module versions, tenant/company settings, custom packages, and the evidence available
   through authorized exports or source access. For Odoo, compare the installed add-ons and
   extensions with a version-matched baseline, including model and view inheritance, enabled
   rules, scheduled actions, and tenant data that configures behavior. For SAP, use authorized
   extension inventories, configuration, released APIs, event contracts, and observed test
   outcomes. Public documentation can establish a supported surface. It cannot establish how
   an unpublished customer extension works. [Odoo manifests][odoo-manifest] · [Odoo view inheritance][odoo-views] · [SAP Extensibility][sap-ext]
2. **Inventory definitions and effective behavior separately.** Keep standard, customized,
   dormant, and unknown definitions in the inventory where they are within scope. Describe
   which override wins in the captured environment, which conditions affect it, and whether
   it runs as an action, a batch job, an integration, or a read. An inactive definition can
   still matter for retention or a future configuration. A custom view that hides a field
   and a policy that denies reading that field are distinct leaves.
3. **Describe the business consequences.** Record inputs, outputs, dates and units, actors
   and scope, owned facts, validation, failure and recovery paths, audit evidence, side
   effects, and dependencies. For important behavior, capture representative source cases
   and expected outcomes. Use authorized, minimized fixtures, especially for customer,
   pricing, and credit data. Analyze source artifacts as evidence. Any observation
   that requires execution belongs in a separately approved rehearsal environment.
4. **Find the target leaf and its owner.** Place a customization where its invariant belongs.
   If there is no owner or released contribution point, describe the missing piece and
   generate a blocked draft. Choose the target after understanding the behavior. A source
   SQL trigger, custom method, or inherited view is a clue about implementation, and its
   business role determines whether it belongs in a service, policy, projection, or
   integration on the target.
5. **Generate a traceable review package.** Include a capability tree, dependency map,
   source-to-target coverage report, working target changes or drafts, and test cases or
   evidence requests. Assign a stable ID to each discovered source behavior and keep its
   source reference, source version or fingerprint, assumptions, target owner, dependencies,
   mapping disposition, and reason for any blocker. Preserve the record for each source
   rule even if several rules ultimately share a target implementation. When one source
   customization has several effects, split those effects into leaves and keep the parent
   reference so all of them can be checked.

### What the generator can propose for each leaf

| Disposition | Distributor example | Draft to produce |
| --- | --- | --- |
| **Use an existing public capability** | An order above a limit needs approval under a supported policy and escalation mechanism | A mapping to the named capability, required scope and grants, and acceptance cases that compare source and target. |
| **Contribute through a released extension point** | A carton-quantity field on a product, where the owner supports typed custom fields | A typed contribution and its data mapping. Generate the permission checks and UI proposal as separate concerns. |
| **Compose a workflow** | A discount above 10 percent by a given salesman needs a second approval and a notification | A draft flow using released actions, with the original conditions, default branches, denial path, and task visibility represented. |
| **Add an adapter or projection** | A channel expects a monthly price export; Sales owns the prices | A connector or read projection draft that uses published data and translates the partner format. Include the data scope, schedule, cutoff, and redelivery behavior. |
| **Propose a new owner capability** | A credit limit per salesman needs an authoritative exposure the owner does not model today | A domain proposal with source cases, invariants, and unresolved design questions. Creating a new owner requires a reviewed domain decision. |
| **Retain in source or block** | A pricing rule affects money and its exact behavior cannot be established from available evidence | A blocked leaf with provenance, scope, and mitigation. Keep the pricing write authority at the source until the approved replacement can reproduce the required behavior. |

For extensions, use the [contribution model](../plugin-architecture.md#contribution-model).
Generated drafts live outside the active ERP composition until the owner reviews them.
A trusted extension may own new facts under its own schema and invoke the target's
released interfaces. A customization that changes who can approve something, computes
a balance, changes an issued document, or posts to the ledger requires review by that
fact's owner. Generating an extension cannot create public permissions, prove
organizational segregation, or install customer code by itself.

### Let AI turn the reviewed mapping into a working submodule

The proposed default is an implementable change in a review branch. A draft is lightweight
on a resolved leaf. Its source reference, mapping, code diff or configuration, and validation
results are the draft. Reviewers can inspect that evidence when they need it. The migration
summary groups complete work by submodule and calls out the few decisions that remain.
A submodule can reach review with zero blockers when all of its required behavior has
supporting evidence, a valid target owner, and passing acceptance checks.

Use the smallest target surface that carries the behavior. A leaf can become configuration
on an existing extension point. A coherent branch can become a submodule in the owner
package when it belongs to that owner, or a contribution in the customer's extension
when it is customer-specific. A branch becomes a separately registered module only when
it needs its own owner or deployment boundary. Keep the source tree intact so reviewers
can trace several leaves to the same implementation without losing any individual rule.
The current CLI scaffolds flagship module structure. Direct generation of customer
submodules and integration into a review build are proposed capabilities. Reuse the
existing code and conventions wherever they fit. [Module generator](../../decisions/0094-adopt-module-manifest-registry-and-generator.md)

| Situation | What AI can complete in the review branch | What remains visible |
| --- | --- | --- |
| **Exact match to a released capability** | Generate configuration or mapping, use the owner's existing API, and verify the source examples against the target. | The resolved leaf, target contract version, and verification result. |
| **Several leaves form a known submodule** | Generate the submodule's code, typed mappings, adapters or workflow configuration, and focused fixtures. Compose it in the review build through approved contracts and run the relevant checks. | One submodule change with traceability and evidence for each source leaf. |
| **Fixable technical obstacle** | Resolve a documented format mismatch, add a source fixture, or repair the implementation against a known contract. Rerun the failing check and keep the original semantic expectation. | A resolved finding in the evidence. It no longer needs operator attention. |
| **A missing business decision or capability** | Complete independent leaves and prepare the smallest safe scaffold for affected work. Keep the dependent behavior out of active composition. | One concise question or blocker with the affected leaves, an example, the owner, and the available choices. |

The AI should work through a bounded cycle of generating, checking, and fixing in the
review branch. It can use the source fixtures as an oracle and the target checks to catch
type, dependency, authorization, and replay errors. Domain or browser checks matter
where UI behavior affects the outcome. Evidence comes from source records and approved
examples independent of the generated implementation. Passing TypeScript and exercising
the happy path provide evidence for those checks alone. Missing evidence, a surprising
currency or permission change, or a new owner/invariant remains a review item. A model's
confidence score does not resolve it.

**First slice.** A Product packaging submodule can carry a source custom field for carton
quantity plus the mapping that reads and writes it through Product's existing
[`product.product` extension point](../../../erp/modules/product/manifest.ts). Given the
field type, source ID, unit, and expected round trip, AI can generate the mapping and code,
run an isolated import, verify repeat import and authorized reads, and present one reviewable
change. If source configuration also uses the field to convert stock between cartons and
pieces, that behavior is a separate leaf. It becomes executable only through the
Inventory owner's supported unit conversion semantics. Otherwise the operator gets one
short item explaining the missing semantics, while the field migration stays ready.

The review build and its tests do not transfer operational authority. Activating a
generated extension or switching live writes follows the existing owner review and
the [cutover procedure](#e-transfer-authority-once-per-scope). For the credit-limit
example, AI could still generate a separately testable scaffold and approved independent
contributions. Per-salesman exposure needs a Sales owner decision before activation.

### Verify that the tree lost no leaves

| Check | Evidence |
| --- | --- |
| **Inventory closure** | Every discovered source artifact and behavior is linked to a leaf with a disposition. Unknown or inaccessible source coverage is listed separately. A second scan of the same source distinguishes unchanged, changed, and newly discovered leaves. |
| **Semantic closure** | Compare source and target scenarios for normal paths, boundary conditions, permission denials, failures, and corrections. For a discount threshold, test one rupiah below, exactly at, and above the threshold, including a salesman whose assignment changes while the order is pending approval. |
| **Dependency closure** | Every target draft names the contracts it needs. Unavailable or unapproved dependencies keep the affected leaf blocked. Confirm that one branch can stay with the source without sending the same price export twice. |
| **Release closure** | Required leaves are verified, or a documented coexistence arrangement keeps their source behavior available under one authority. A business owner signs off by capability. A generated count cannot substitute for this outcome. |

An initial experiment should map one existing module or submodule with a real customization,
using authorized, sanitized evidence. It should produce one testable submodule and show
that resolved technical findings need no manual ticket, while leaves touching money, stock, or authorization are signed off by their owner. Include a case with one missing business
decision to check that the operator sees only the remaining decision and that all source
behavior stays accounted for. Extract reusable generation around that first proven mapping.

## Public sources

- Odoo 20.0 product and architecture — [add-on tree][odoo-addons], [edition matrix][odoo-editions], [module manifests][odoo-manifest], [ORM][odoo-orm], [external data import][odoo-import], [upgrade scripts][odoo-upgrades], [upgrade rehearsal][odoo-upgrade-test].
- SAP Business One 10.0 — [product help][sap-b1], [Data Transfer Workbench][sap-b1-dtw], [opening balances][sap-b1-opening], [Service Layer API][sap-b1-api].
- SAP S/4HANA Cloud Public Edition — [product help][sap-public], [Migration Cockpit][sap-migration], [extensibility][sap-ext], [released APIs][sap-released], [extensibility changes in 2608][sap-ext-notes].
- SAP public announcements used for inference — [Business Data Cloud, February 2025][sap-data], [SAP Sapphire, May 2026][sap-sapphire], [SAP Connect, October 2026][sap-connect].

[odoo-addons]: https://github.com/odoo/odoo/tree/20.0/addons
[odoo-editions]: https://www.odoo.com/page/editions
[odoo-inventory]: https://www.odoo.com/documentation/20.0/applications/inventory_and_mrp/inventory.html
[odoo-sale]: https://github.com/odoo/odoo/tree/20.0/addons/sale_management
[odoo-sale-stock]: https://github.com/odoo/odoo/blob/20.0/addons/sale_stock/__manifest__.py
[odoo-sale-crm]: https://github.com/odoo/odoo/blob/20.0/addons/sale_crm/__manifest__.py
[odoo-account]: https://www.odoo.com/documentation/20.0/id/applications/finance/accounting.html
[odoo-bank]: https://www.odoo.com/documentation/20.0/id/applications/finance/accounting/bank/reconciliation.html
[odoo-id]: https://www.odoo.com/documentation/20.0/applications/finance/accounting/fiscal_localizations/localizations/indonesia.html
[odoo-report]: https://www.odoo.com/documentation/20.0/developer/reference/backend/reports.html
[odoo-import]: https://www.odoo.com/documentation/20.0/applications/general/base_import.html
[odoo-company]: https://www.odoo.com/documentation/20.0/id/applications/general/companies/multi_company.html
[odoo-manifest]: https://www.odoo.com/documentation/20.0/developer/reference/backend/module.html
[odoo-orm]: https://www.odoo.com/documentation/20.0/developer/reference/backend/orm.html
[odoo-views]: https://www.odoo.com/documentation/20.0/developer/reference/user_interface/view_records.html
[odoo-web]: https://www.odoo.com/documentation/20.0/developer/reference/frontend/registries.html
[odoo-upgrades]: https://www.odoo.com/documentation/20.0/developer/reference/upgrades/upgrade_scripts.html
[odoo-upgrade-test]: https://www.odoo.com/documentation/20.0/administration/upgrade.html
[odoo-access]: https://www.odoo.com/documentation/20.0/developer/tutorials/restrict_data_access.html
[sap-public]: https://help.sap.com/docs/r/product/SAP_S4HANA_CLOUD
[sap-b1]: https://help.sap.com/docs/SAP_BUSINESS_ONE
[sap-bp]: https://help.sap.com/docs/SAP_S4HANA_CLOUD/88520ff2932b479090ed3b7b116b2e91/45efed579120bc12e10000a4450e5.html
[sap-org]: https://help.sap.com/docs/SAP_S4HANA_CLOUD/b249d650b15e4b3d9fc2077ee921abd0/e4f3db048a544f70aff470d4bfa131f5.html
[sap-b1-item]: https://help.sap.com/docs/SAP_BUSINESS_ONE/68a2e87fb29941b5bf959a184d9c6727/451fa75c8ffb4a2fe10000000a11466f.html
[sap-b1-lots]: https://help.sap.com/docs/SAP_BUSINESS_ONE_WEB_CLIENT/2554bf7e9aa347729b0547a737e123ac/8ffb6cecac50475499ba20884aa10f09.html
[sap-docflow]: https://help.sap.com/docs/SAP_S4HANA_CLOUD/a630d57fc5004c6383e7a81efee7a8bb/43336e5621eb9d24e10000a44147b.html
[sap-pricing]: https://help.sap.com/docs/PRODUCT_ID/a376cd9ea00d476b96f18dea1247e6a5/b78dc95360267214e10000000a174cb4.html
[sap-fulfillment]: https://help.sap.com/docs/SAP_S4HANA_CLOUD/ee9ee0ca4c3942068ea584d2f929b5b1/e4784bd2f66f4ca5bf76394e88acc790.html
[sap-grir]: https://help.sap.com/docs/SAP_S4HANA_CLOUD/0fa84c9d9c634132b7c4abb9ffdd8f06/8700d78b2faf49f6aff17857bd674f27.html
[sap-output]: https://help.sap.com/docs/SAP_S4HANA_CLOUD/a376cd9ea00d476b96f18dea1247e6a5/d9cc17d1aa404aee9bf2d10599c9a8d1.html
[sap-b1-bank]: https://help.sap.com/docs/SAP_BUSINESS_ONE/68a2e87fb29941b5bf959a184d9c6727/a6de2ac0d9134dd89d5f104a6d59f5c2.html
[sap-bank]: https://help.sap.com/docs/SAP_S4HANA_CLOUD/918bca53037f408f91a2295d04ac16bc/e042e6cb0bae4718ba0e025825f73e88.html
[sap-b1-reports]: https://help.sap.com/docs/sap_business_one/68a2e87fb29941b5bf959a184d9c6727/45114bb429fc4805e10000000a1553f6.html
[sap-fsv]: https://help.sap.com/docs/SAP_S4HANA_CLOUD/0fa84c9d9c634132b7c4abb9ffdd8f06/c064c2531bb9b44ce10000000a174cb4.html
[sap-actuals]: https://help.sap.com/docs/SAP_S4HANA_CLOUD/93bd0b1e72ca4cbcbfb942d4497529f7/f5d97f82ce144b13a61324486edf114d.html
[sap-id]: https://help.sap.com/docs/SAP_S4HANA_CLOUD/a8e130351783496f90c2750ef623bcb1/8ba0dc7f2f664f8ba137972da02f07b0.html
[sap-coretax]: https://help.sap.com/docs/SAP_S4HANA_CLOUD/ee9ee0ca4c3942068ea584d2f929b5b1/24ec1dafd3bc4dcc9a0992caa5075247.html
[sap-roles]: https://help.sap.com/docs/SAP_S4HANA_CLOUD/53e36b5493804bcdb3f6f14de8b487dd/b8c8128b86ae4e90b0ebb582d27a1980.html
[sap-scope]: https://help.sap.com/docs/SAP_S4HANA_CLOUD/b249d650b15e4b3d9fc2077ee921abd0/fe6a9b55eb17473ebec206b05e596d1b.html
[sap-b1-dtw]: https://help.sap.com/docs/SAP_BUSINESS_ONE/25bde9551224405e84e69c760e272e89/4925db7db34d14cde10000000a42189b.html
[sap-b1-opening]: https://help.sap.com/docs/PRODUCT_ID/25bde9551224405e84e69c760e272e89/225e2f5591fba20ce10000000a44176d.html
[sap-migration]: https://help.sap.com/docs/PRODUCT_ID/d5699934e7004d048c4801b552f3b013/121b34742a904d10bca907bbf2fd5617.html
[sap-migration-steps]: https://help.sap.com/docs/SAP_S4HANA_CLOUD/d5699934e7004d048c4801b552f3b013/b3fd91a776ea496fa79368613228fa8b.html
[sap-initial]: https://help.sap.com/docs/SAP_S4HANA_CLOUD/d5699934e7004d048c4801b552f3b013/886e1b9bf25245d093a98e0c635818e5.html
[sap-mfg]: https://help.sap.com/docs/SAP_S4HANA_CLOUD/a376cd9ea00d476b96f18dea1247e6a5/5c00965653691e5ee10000000a4450e5.html
[sap-group]: https://help.sap.com/docs/sap_s4hana_cloud/0fa84c9d9c634132b7c4abb9ffdd8f06/4bd4e6f16fde424cac273a8ffd4ce3e6.html
[sap-b1-api]: https://help.sap.com/doc/056f69366b5345a386bb8149f1700c19/10.0/en-US/Service%20Layer%20API%20Reference.html
[sap-rap]: https://help.sap.com/docs/abap-cloud/abap-rap/abap-restful-application-programming-model
[sap-c0]: https://help.sap.com/docs/SAP_S4HANA_CLOUD/25cf71e63940453397a32dc2b7676947/2ce344a782d74d8aab073fa188af5116.html
[sap-c1]: https://help.sap.com/docs/SAP_S4HANA_CLOUD/c0c54048d35849128be8e872df5bea6d/b6fe6846e9c7488e8c7e6d4289918fe3.html
[sap-c2]: https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/use-as-remote-api-c2
[sap-released]: https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/released-apis
[sap-ext]: https://help.sap.com/docs/SAP_S4HANA_CLOUD/0f69f8fb28ac4bf48d2b57b9637e81fa/533228e1e854433ab16d013f161ca509.html
[sap-side]: https://help.sap.com/docs/SAP_S4HANA_CLOUD/2bba750d1e124e1ea2a039bb1cd9b6c5/2a17a3e1525f4f46a9c5156bd2d3bc87.html
[sap-events]: https://help.sap.com/docs/SAP_S4HANA_CLOUD/a630d57fc5004c6383e7a81efee7a8bb/18658e70de3043cf894e41c38538f488.html
[sap-comm]: https://help.sap.com/docs/SAP_S4HANA_CLOUD/0f69f8fb28ac4bf48d2b57b9637e81fa/2e84a10c430645a88bdbfaaa23ac9ff7.html
[sap-test]: https://help.sap.com/docs/SAP_S4HANA_CLOUD/2ab07d21f68c41109a2eef21b8fd8466/acaf51440ec84e409895cd8cde9486cb.html
[sap-cds]: https://help.sap.com/docs/SAP_S4HANA_CLOUD/c0c54048d35849128be8e872df5bea6d/f96b3d9e8aa34c4d95ef67f20aca4696.html
[sap-ext-notes]: https://help.sap.com/docs/SAP_S4HANA_CLOUD/ee9ee0ca4c3942068ea584d2f929b5b1/1df8b8b1799a4d07899d9fb6c72835cf.html
[sap-data]: https://news.sap.com/2025/02/sap-business-data-cloud-databricks-turbocharge-business-ai/
[sap-sapphire]: https://news.sap.com/2026/05/sap-sapphire-sap-unveils-autonomous-enterprise/
[sap-connect]: https://news.sap.com/2026/10/sap-connect-sap-puts-autonomous-enterprise-to-work/
