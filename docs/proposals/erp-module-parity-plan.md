# Proposal: ERP Module Parity Plan

> **Status:** Proposal, not yet approved. Nothing here is binding until the owner accepts it and the
> decisions it flags are recorded as ADRs.
>
> **Owns:** The functional map from Odoo apps and SAP S/4HANA areas to RITSEI modules, the per-module
> gap analysis, and the proposed sequence for closing those gaps after the framework reset.
>
> **Does not own:** Module invariants (owned by each module's architecture document), framework
> phase gates 3–8 (owned by the framework reset proposal), or any decision listed in Section 7.
>
> **Related documents**
>
> - Framework and flagship ERP decision:
>   [`../decisions/0091-adopt-framework-and-flagship-erp.md`](../decisions/0091-adopt-framework-and-flagship-erp.md)
> - Framework reset phases and flagship scope: [`./framework-reset.md`](./framework-reset.md)
> - Canonical architecture: [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)
> - Repository rules: [`../../AGENTS.md`](../../AGENTS.md)
> - Documentation ownership: [`../documentation-boundaries.md`](../documentation-boundaries.md)
> - Financial ledger: [`../architecture/financial-ledger.md`](../architecture/financial-ledger.md)
> - Sales: [`../architecture/sales.md`](../architecture/sales.md)
> - Procurement: [`../architecture/procurement.md`](../architecture/procurement.md)
> - State and consistency: [`../architecture/state-and-consistency.md`](../architecture/state-and-consistency.md)
> - Authorization: [`../architecture/authorization.md`](../architecture/authorization.md)
> - Process Studio (deferred): [`../architecture/process-studio.md`](../architecture/process-studio.md)
> - Integration surface: [`../architecture/integration-architecture.md`](../architecture/integration-architecture.md)
> - Semantic areas (reference): [`../architecture/reference/orthogonal-erp-areas.md`](../architecture/reference/orthogonal-erp-areas.md)
> - ERP standards (reference): [`../architecture/reference/erp-standards.md`](../architecture/reference/erp-standards.md)

## 1. Summary

"Parity with Odoo and SAP" is not a reachable goal for a small team, and copying either product's
module list would reintroduce the speculation ADR-0091 removed. The useful target is narrower:

1. **Functional parity for the flagship segment first.** An Indonesian distribution or trading SME
   should be able to run a month of quote-to-cash, procure-to-pay, stock, and the general ledger on
   RITSEI without a spreadsheet on the side. That is roughly what Odoo Community's Sales, Purchase,
   Inventory, and Invoicing apps give such a company, and what SAP Business One (not S/4HANA) gives
   the same segment.
2. **Architectural parity with SAP's clean core.** Every module is extended through public
   contracts, events, and released extension points, never by patching another module's tables or
   logic. The long-term differentiator beyond both is non-interference: reports, imports,
   integrations, and derived work never slow the commands that record business facts. It is kept as
   a target design by
   [ADR-0093](../decisions/0093-retain-isolation-runtime-and-analytic-target-designs.md) and becomes
   a product claim only once measured.
3. **Breadth only by evidence.** Manufacturing, projects, assets, quality, maintenance, CRM depth, and
   HR are added one module at a time, each when a named pilot needs it, and each in the smallest
   form that serves that need.

Today RITSEI has seven ERP modules with real code, but no module yet closes a business loop: there
is no product master, price list, delivery, invoice, payment, tax, valuation, or financial statement.
The plan below closes Order-to-Cash and Procure-to-Pay first (framework reset Phases 4–6), then adds
finance depth, supply-chain depth, and only then secondary areas.

## 2. Ground rules this plan applies

The rules are owned elsewhere; this list says which ones shape the plan and where they live.

| Rule | Owner | Effect on this plan |
| --- | --- | --- |
| `framework/` never imports `erp/`; modules extend each other only through public contracts, events, and released extension points | [ADR-0091](../decisions/0091-adopt-framework-and-flagship-erp.md), [`AGENTS.md`](../../AGENTS.md#framework-and-erp) | Every Odoo `_inherit` or SAP user-exit pattern is replaced by a named extension point on the owning module |
| Extract, don't speculate: a framework capability ships only with an ERP consumer | ADR-0091 §4 | Framework prerequisites in Section 6 are scheduled in the phase whose ERP module first needs them |
| One semantic owner per invariant | [ADR-0015](../decisions/0015-one-semantic-owner-per-invariant.md) | New areas (product, tax, settlement, valuation) each get exactly one owner; Section 7 lists the ones that need a decision |
| Owner-local business documents, no universal `documents` table | [ADR-0046](../decisions/0046-adopt-owner-local-business-surface-and-generated-ergonomics.md) | Invoices, deliveries, and payments are owned by specific modules, not by a generic document engine |
| Jurisdiction-neutral cores; localization in separate modules | [ADR-0016](../decisions/0016-isolate-jurisdiction-localization.md), [ADR-0013](../decisions/0013-version-external-standard-adapters.md) | Tax semantics are core; Indonesian PPN, PPh, and Coretax output are a localization module |
| PostgreSQL is the only active financial authority; TigerBeetle is the designated future engine; exact money | [ADR-0091](../decisions/0091-adopt-framework-and-flagship-erp.md), [ADR-0092](../decisions/0092-retain-tigerbeetle-as-designated-ledger-engine.md), [ADR-0042](../decisions/0042-exact-financial-amount-boundary.md) | Every phase posts through `FinancialLedgerPort` so the engine can change later; no dual authority, no floating point, base currency first |
| Process engine deferred until O2C and P2P run end to end | ADR-0091 §6, [`process-studio.md`](../architecture/process-studio.md) | Until then, composite flows are coded coordinators under the Composite Process Contract in the [architecture specification](../architecture/architecture-spec-v4.md#composite-process-contract) |
| Operational domains only by evidence | [`../roadmap/domain-maturity.md`](../roadmap/domain-maturity.md) (D3) | Manufacturing, quality, assets, maintenance, projects, HR stay out until a requested capability needs an owner |

## 3. Current state (master `2858f33`)

### 3.1 ERP modules

| Module | Capabilities today | Tables (`db/schema/`) | HTTP API | Web UI | Notes |
| --- | --- | --- | --- | --- | --- |
| `party` | Create party, legal entity, branch; assign role (customer, supplier, employee, partner); attach external identifier; relationships and representations; related-party path query | `parties`, `legal_entities`, `branches`, `party_roles`, `party_relationships`, `related_party_paths`, `party_identifiers`, `party_representations` | `/parties`, `/legal-entities/:id/branches` | Parties screen | No addresses, contacts, bank accounts, or payment terms anywhere in the schema |
| `sales` | Customer create/read; quotation create/read (draft only); sales order create, confirm, cancel with idempotent confirmation and `SalesOrderConfirmedEvent` | `customers`, `quotations`, `orders`, `order_lines` | `/sales/customers`, `/sales/quotations`, `/sales/orders` | Sales workspace | Customers are a Sales-local record (name, email), not a Party role, unlike Procurement's Supplier Account. No pricing, tax, discount, currency, delivery, or invoicing ([`sales.md`](../architecture/sales.md#maturity-and-deferred-scope)) |
| `procurement` | Supplier account create/list; purchase order create, confirm, cancel; goods receipt with partial receipts and cumulative over-receipt guard | `supplier_accounts`, `purchase_orders`, `purchase_order_lines`, `purchase_receipts`, `purchase_receipt_lines` | `/procurement/supplier-accounts`, `/procurement/purchase-orders`, `.../receipts` | Procurement workspace | Supplier accounts reference a Party relationship. No bill, matching, returns, or payables ([`procurement.md`](../architecture/procurement.md#invoice-matching-and-payables-gate)) |
| `inventory` | Item and warehouse create; receive, adjust, reserve, release, fulfill stock; warehouse transfers (create, confirm, complete) | `items`, `warehouses`, `stock_balances`, `reservations`, `movements`, `stock_transfers`, `stock_transfer_lines` | `/inventory/*` | Inventory workspace | Items carry `sku`, `name`, one immutable stock UOM; whole-number quantities; warehouse-level location only; no valuation ([ADR-0035](../decisions/0035-define-p1-inventory-primitives.md)) |
| `accounting` | Legal entity accounting configuration (base currency); accounts (five types); periods open/close; manual journal post; revenue posting and reversal for a sales order; projection rebuild | `accounts`, `accounting_periods`, `journal_entries`, `journal_lines`, `revenue_posting_profiles`, `legal_entity_accounting_configurations`, plus TigerBeetle-era tables (`financial_operations`, `financial_cutover_controls`, `financial_staging_evidence`, reconciliation and orphan-transfer tables) | `/accounting/*` | Accounting workspace | About 19,700 lines, much of it the TigerBeetle cutover and evidence path, inactive today and kept by ADR-0092. No COA template, statements, AR/AP, tax, or multi-currency |
| `billing` | None (`mod.ts` exports nothing) | None | None | None | Billing is back in scope per ADR-0091 §7 |
| `process` | Order-confirmation coordinator (confirm, cancel, fulfill order across Sales, Inventory, Accounting) with recovery and manual recovery; job table with lease fencing; Process Studio catalog, release, runtime, inbox | `process_jobs`, `workflow_runs`, `job_fence_scopes`, `process_runtime_checkpoints`, `process_releases`, `process_deployments`, operator controls and audits | `/process/*` | Process Studio screen | Mixes three concerns that the reset separates: the job table (framework data), the deferred process engine (framework process), and an ERP composite flow (O2C coordinator) |
| `communication` | Deliver and retry an email for `PurchaseOrderConfirmed` | None (memory store) | None | None | One event, test transports only |

### 3.2 Framework modules

| Module | What it provides | ERP-relevant gap |
| --- | --- | --- |
| `auth` | Tenants, sessions, provider-neutral authentication | None for this plan |
| `identity` | User accounts and external subject mapping | None for this plan |
| `authorization` | Tenant membership, capability grants, scope checks, native relationship engine, SoD primitives | No approval workflow; SoD is not yet applied to any ERP action |
| `messaging` | Transactional outbox and consumer receipts | None; every new module publishes through it |
| `integrations` | Connector reliability, governance, CloudEvents, OpenAPI | No provider adapters (bank, tax authority, e-commerce) |
| `catalog` | Shared schemas for typed action and event catalog entries (stability, idempotency, compensation, compatibility range); every ERP module's `catalog.ts` and `events.ts` publishes through it, and Process Studio reads it | Name collides with "catalog" as a product catalog (Section 10.3) |
| `framework/foundation`, `framework/platform` | IDs, money, time, database, jobs contract, document rendering, crypto, PostgreSQL adapter | No numbering, approvals, attachments, custom fields, import, or report kit |

### 3.3 What this means

The framework kernel and correctness foundation are ahead of the ERP. The ERP has the order and
stock halves of both loops but neither money half: there is nothing a customer can be invoiced for
or a supplier paid against, and no stock value to reconcile with the ledger. The first priority is
therefore not breadth but closing those two loops.

## 4. Functional map: Odoo and SAP S/4HANA to RITSEI

Legend for **Stance**: **Core** = built in the flagship before or during pilots; **Later** = built
after pilots when a named user needs it; **Extension** = belongs in `extensions/` or a localization
module, not in the flagship core; **No** = deliberately not copied (Section 9).

| Functional area | Odoo | SAP S/4HANA | RITSEI home | Layer | Stance |
| --- | --- | --- | --- | --- | --- |
| Organization, legal entities, branches | Companies, multi-company | Company code, plant, sales/purchasing org | `party` (legal entity, branch); `inventory` (warehouse) | erp | Core (exists) |
| Business partners, contacts, addresses | Contacts | Business Partner | `party` | erp | Core |
| Product master, UoM, categories | Product, UoM | Material master, MM classification | new `erp/modules/product` (Section 7, D1) | erp | Core |
| Pricing and discounts | Pricelists | SD condition technique | `sales` (sales price lists); `procurement` (supplier prices) | erp | Core, simple; condition technique **No** |
| Quotation and sales order | Sales | SD sales documents | `sales` | erp | Core (partly exists) |
| Delivery and shipping | Inventory pickings | LE-SHP outbound delivery | `sales` delivery evidence + `inventory` movement (Section 7, D4) | erp | Core |
| Customer invoicing, credit notes | Invoicing | SD billing, FI-AR | `billing` | erp | Core |
| Incoming and outgoing payments, allocation | Accounting payments, reconciliation | FI-AR/AP clearing | new `erp/modules/settlement` (Section 7, D2) | erp | Core |
| Receivables and payables, aging, statements | Accounting reports | FI-AR, FI-AP | `billing` open items + `settlement` | erp | Core |
| Purchasing | Purchase | MM-PUR | `procurement` | erp | Core (partly exists) |
| Supplier bills, three-way match | Vendor bills | MM-IV logistics invoice verification | `billing` (supplier bill) with `procurement` match data | erp | Core |
| Stock, transfers, adjustments | Inventory | MM-IM | `inventory` | erp | Core (exists) |
| Inventory valuation | Stock valuation layers | Material ledger, moving/standard price | `inventory` cost layers, posted by `accounting` (Section 7, D3) | erp | Core (moving average only) |
| Lots, serials, bins, pick-pack-ship | Inventory advanced routes | Batch management, EWM | `inventory` | erp | Later (lots, bins); full EWM **No** |
| Replenishment | Reordering rules | MRP for procurement | `inventory` min/max proposing purchase requests | erp | Later |
| General ledger, journals, periods | Accounting | FI-GL | `accounting` | erp | Core (rewrite) |
| Chart-of-accounts templates | Fiscal localization COA | Chart of accounts | `accounting` (neutral) + localization module (Indonesian template) | erp | Core |
| Financial statements | Accounting reports | Financial statements, Fiori apps | `accounting` SQL reports | erp | Core |
| Tax determination and tax lines | Taxes, fiscal positions | Tax procedure, condition-based tax | new `erp/modules/tax` (Section 7, D5) | erp | Core (neutral) |
| Indonesian PPN, PPh withholding, e-Faktur/Coretax | `l10n_id`, `l10n_id_efaktur` | Country version Indonesia, DRC | `erp/modules/localization-id` | erp (localization) | Core during pilots |
| Multi-currency, FX revaluation | Multi-currency | Currency translation, FX valuation | `accounting` + `framework/foundation/money` | erp + framework | Later (Section 7, D6) |
| Bank accounts, statements, reconciliation | Bank sync, reconciliation | Bank accounting, cash management | `settlement`; bank file adapters in `framework/modules/integrations` | erp + framework | Core (import); live bank feeds Later |
| Treasury, hedging, liquidity planning | — | TRM, liquidity planning | — | — | No |
| Cost centers, profit centers, analytic dimensions | Analytic accounting | CO-OM, profit center accounting | `accounting` analytic dimensions on journal lines | erp | Later |
| Product costing, actual costing, CO-PA | — (partial) | CO-PC, material ledger actual costing, CO-PA | — | — | No |
| Budgets | Budgets | Budgeting, planning | `accounting` | erp | Later |
| Fixed assets and depreciation | Assets | FI-AA | new `erp/modules/assets` | erp | Later |
| Intercompany and consolidation | Inter-company rules | Intercompany, Group Reporting | `accounting` (intercompany basic) | erp | Intercompany Later; consolidation No |
| Revenue recognition, leases | Deferred revenue | RAR (IFRS 15), lease accounting (IFRS 16) | `accounting` deferred revenue schedules | erp | Later (deferral only); RAR and leases No |
| Subscriptions and recurring billing | Subscriptions | Subscription billing (BRIM) | `billing` recurring invoices on the job table | erp | Later |
| CRM pipeline, activities | CRM | SAP Sales Cloud | new `erp/modules/crm` | erp | Later |
| Manufacturing, BOM, work orders | MRP, PLM | PP, PP-DS, PLM | new `erp/modules/manufacturing` | erp | Later, light (BOM, production order, backflush) |
| MRP planning | MRP scheduler | MRP Live, PP-DS | — | — | No (min/max replenishment instead) |
| Quality | Quality | QM | `extensions/` or a small `quality` module | erp/extension | Later, evidence-gated |
| Maintenance | Maintenance | PM / EAM | `extensions/` | extension | Later, evidence-gated |
| Projects, timesheets, service billing | Project, Timesheets | PS, CATS | new `erp/modules/project` | erp | Later |
| Expenses | Expenses | Travel management | `extensions/` or `project` | extension | Later |
| HR core, leave | Employees, Time Off | SuccessFactors / H4S4 | Employee is a `party` role; HR module in `extensions/` | extension | Later |
| Payroll | Payroll (`l10n_*_payroll`) | Payroll | Localization extension or a partner integration | extension | No in flagship |
| Approvals | Approvals | Flexible workflow | `framework` approvals service + `authorization` SoD | framework | Core |
| Document numbering | Sequences | Number ranges | `framework` numbering service | framework | Core |
| Custom fields, form changes | Studio | Key-user extensibility, custom fields | `framework` extension points (custom fields on owner documents) | framework | Core, limited |
| Workflow automation | Automated actions | Workflow, BTP build process automation | `framework/process` (Process IR) after O2C/P2P | framework | Later (ADR-0091 §6) |
| Reporting and analytics | Reporting, spreadsheets | Embedded analytics (CDS), SAC | Module-owned SQL views and materialized views; framework report kit | erp + framework | Core (fixed reports); BI No |
| Printed documents | QWeb reports | Output management, Adobe Forms | `framework` document rendering, PDF templates | framework | Core |
| Import and export | Import wizard | Migration cockpit | `framework` spreadsheet import per owner command | framework | Core |
| Attachments, audit trail, chatter | Mail thread, attachments | Attachments, change documents | `framework` attachments port + owner audit facts | framework | Core (audit, attachments); chat No |
| Email and notifications | Discuss, mail | Output management | `communication` (move to framework when a second consumer exists) | erp → framework | Core |
| Point of sale, eCommerce, website, marketing | POS, Website, eCommerce, Marketing | Commerce Cloud, Marketing Cloud | `framework/modules/integrations` connectors to external shops | integration | No as modules |
| Documents, sign, knowledge, helpdesk, fleet, field service, rental, planning | Separate apps | Various LoB clouds | — | — | No in flagship; candidates for `extensions/` |

## 5. Gap analysis per module

Each subsection lists the gap against what the flagship segment needs, not against everything Odoo
or SAP ship. Owning invariants stay in the module's architecture document; this section only scopes.

### 5.1 Party (master data)

- **Exists:** parties, legal entities, branches, roles, identifiers, relationships, representations.
- **Odoo/SAP reference:** contacts and business partner with addresses, contact persons, bank
  accounts, tax IDs, payment terms, credit limit, and partner functions (bill-to, ship-to).
- **Gap for the flagship:** postal addresses with purpose (billing, shipping), contact persons, bank
  accounts, tax registration identifiers (NPWP/NIK through the existing identifier scheme per
  [ADR-0014](../decisions/0014-separate-internal-and-external-identifiers.md)).
- **Ownership questions:** payment terms and credit limits are commercial policy, not identity. Put
  payment terms in `settlement` (they define due dates) and credit limits in `sales` (they gate order
  confirmation). Sales customers should reference a Party customer role the way Supplier Accounts
  reference a Party relationship (Section 7, D7).

### 5.2 Product (new)

- **Exists:** `inventory.items` with SKU, name, and one immutable stock UOM.
- **Odoo/SAP reference:** product template and variants, categories, sales/purchase UoM, service and
  consumable types, sales and purchase descriptions, default taxes and accounts; SAP material master
  views per org level.
- **Gap:** a product master that Sales, Procurement, Billing, and Inventory all reference, with
  product type (stockable, consumable, service), category, UoM categories and conversions, and
  default tax and account mappings supplied through extension points rather than columns owned by
  other modules. Inventory keeps stock-keeping facts (stock UOM, balances, movements) for stockable
  products only.
- **Deliberately excluded:** variants and attributes until a pilot sells configurable goods; SAP
  variant configuration never.
- **Decision:** moves item identity out of Inventory, which ADR-0035 assigned to Inventory (Section
  7, D1).

### 5.3 Sales

- **Exists:** customers, draft quotations, orders with confirm and cancel, confirmation event.
- **Odoo/SAP reference:** quotation lifecycle and online acceptance, price lists, discounts,
  taxes, delivery and invoicing status per line, down payments, returns, credit check, ATP.
- **Gap for Order-to-Cash:** quotation send/accept/expire and conversion to order; order lines on
  products with price-list pricing, discounts, and tax codes; legal-entity and branch scope on orders;
  delivery evidence with partial deliveries; per-line delivered and invoiced quantities; credit-limit
  check at confirmation; customer returns as a correction document.
- **Later:** down payments, sales teams, blanket orders, drop-ship (coordinated with Procurement).

### 5.4 Procurement

- **Exists:** supplier accounts, purchase orders, confirmation, goods receipt.
- **Odoo/SAP reference:** RFQ, purchase requisitions and approvals, supplier price lists, receipt
  and bill status per line, three-way match, purchase returns, landed costs.
- **Gap for Procure-to-Pay:** prices and taxes from supplier price info and the tax module; billed
  quantity per line; matching data exposed to Billing; purchase returns and receipt reversal as
  correction commands ([`procurement.md`](../architecture/procurement.md#goods-receipt-boundary)
  lists these as separate gates); approval of purchase orders above a threshold.
- **Later:** purchase requisitions, RFQ comparison, blanket agreements, landed costs.

### 5.5 Inventory

- **Exists:** warehouses, items, balances, reservations, movements, transfers, adjustments.
- **Odoo/SAP reference:** locations and bins, routes, pick/pack/ship, lots and serials, expiry,
  cycle counts, replenishment, valuation layers, landed costs, EWM.
- **Gap for the loops:** moving-average cost layers per movement and a valuation fact Accounting can
  post (Section 7, D3); stock count (physical inventory) as an adjustment document; inventory
  valuation report that reconciles with the inventory GL account.
- **Later:** lots and serials with expiry (likely needed for pharma or food distributors), bins
  within a warehouse, min/max replenishment that proposes purchase orders, UoM conversion at
  receipt, landed cost allocation.
- **No:** EWM-style task management, wave planning, yard and labor management.

### 5.6 Accounting

- **Exists:** accounts, periods, manual journals, revenue posting and reversal, plus the
  TigerBeetle-ready financial-operation and cutover code that
  [ADR-0092](../decisions/0092-retain-tigerbeetle-as-designated-ledger-engine.md) keeps as the path
  to the designated future engine.
- **Odoo/SAP reference:** COA templates, journals by type, automatic postings from documents, period
  close, reconciliation, financial statements, analytic accounting, multi-currency, assets, budgets,
  consolidation.
- **Gap:** the PostgreSQL ledger rewrite of reset Phase 4 through `FinancialLedgerPort`, keeping the
  TigerBeetle path reachable as ADR-0092 requires (deterministic operation identity, outcome
  states, reconciliation hooks); account
  hierarchy and a neutral COA template mechanism; posting rules that map Billing, Settlement, and
  Inventory facts to accounts (replacing the order-specific revenue posting profile); trial balance,
  profit and loss, balance sheet, general ledger detail; period close checklist with pending-work
  guard; reopen and adjusting periods.
- **Later:** analytic dimensions (cost center, project) on journal lines, multi-currency and
  revaluation, deferred revenue schedules, budgets, intercompany.

### 5.7 Billing

- **Exists:** nothing.
- **Odoo/SAP reference:** customer invoices, credit notes, supplier bills, debit notes, recurring
  invoices, invoice PDFs, e-invoicing.
- **Gap:** customer invoice from delivered (or ordered) quantities, credit note as a correction,
  supplier bill with three-way match against Procurement receipts, open-item balance per invoice,
  posting through Accounting, printed invoice, and the tax lines computed by the tax module.
- **Later:** recurring invoices, down-payment invoices, e-invoice exchange through integrations.

### 5.8 Settlement (new)

- **Exists:** nothing. The architecture specification keeps Settlement gated "until its obligation
  and payment contracts are decided".
- **Odoo/SAP reference:** payments, partial payments, allocation against invoices, bank statements,
  reconciliation, payment terms, dunning, payment runs.
- **Gap:** incoming and outgoing payments, allocation to Billing open items, payment terms and due
  dates, receivables and payables aging, customer statement, bank account master, bank statement
  import and manual reconciliation.
- **Later:** dunning levels, batch supplier payment runs with bank file export, live bank feeds.
- **Decision:** Section 7, D2.

### 5.9 Tax (new) and Indonesian localization (new)

- **Exists:** `branches.local_tax_registration` text only.
- **Odoo/SAP reference:** tax codes, tax groups, price-included taxes, fiscal positions, withholding,
  tax reports; country packages.
- **Gap (neutral `tax` module):** tax codes with rate, tax account mapping, inclusive or exclusive
  pricing, tax determination by product tax category and party tax status, tax lines on documents,
  and a tax summary report.
- **Gap (`localization-id`):** Indonesian COA template, PPN rates and the DPP basis rules in force,
  PPh 23 and PPh 4(2) withholding on supplier bills, NPWP/NIK identifier schemes, Coretax e-Faktur
  export through a versioned adapter in `framework/modules/integrations`. The specific rules belong in
  the localization module's own document, not here.
- **Decision:** Section 7, D5.

### 5.10 Process

- **Exists:** order-confirmation coordinator, job table, Process Studio runtime and designer.
- **Plan:** split along the reset's lines when the restructure reaches it: the job table moves to
  framework data, Process Studio to `framework/process` (frozen per ADR-0091 §6), and the O2C
  coordinator stays in `erp/` as a coded composite process until Process IR returns.

### 5.11 Communication

- **Exists:** one event handler (`PurchaseOrderConfirmed`) and test transports.
- **Plan:** add invoice and statement emails in Phase 5; move delivery mechanics into the framework
  once Billing and Procurement both consume it, keeping message content owned by each module.

## 6. Framework prerequisites

Each prerequisite is built in the phase whose ERP module first needs it (ADR-0091 §4). "ADR" means a
new decision record is needed before implementation (details in Section 7).

| Prerequisite | First consumer (phase) | Home | Owning document today | ADR |
| --- | --- | --- | --- | --- |
| Module manifest and registry | All modules (3) | `framework/module` | [`framework-reset.md`](./framework-reset.md) §6; [`plugin-architecture.md`](../architecture/plugin-architecture.md) is stale | Yes, D8 |
| Extension points: custom fields, validation hooks, document actions, event subscriptions | Product and Sales (5) | `framework/module` | same | Yes, D8 |
| Document numbering (series per legal entity and fiscal year, gap policy) | Journals, invoices, orders (4) | `framework` service | None; [`financial-ledger.md`](../architecture/financial-ledger.md) awaits rewrite | Yes, D9 |
| Approvals (threshold rules, approver resolution, SoD) | Purchase orders, journals, credit overrides (4–6) | `framework` service + `framework/modules/authorization` | [`authorization.md`](../architecture/authorization.md#process-execution-authority-and-separation-of-duties) | Yes, D10 |
| Capabilities for every new action | Every phase | `framework/modules/authorization` catalog | [`authorization.md`](../architecture/authorization.md), [ADR-0031](../decisions/0031-capability-naming-and-business-verb-conventions.md) | No (routine) |
| Multi-company (several legal entities per tenant) | Accounting scope (4) | `party`, `accounting` | [Scope contract](../architecture/architecture-spec-v4.md#scope-and-user-account-contract), [ADR-0021](../decisions/0021-define-p0-scope-and-identity-model.md) | No for scoping; yes for intercompany (D11) |
| Multi-currency and exchange rates | Finance depth (post-pilot) | `accounting`, `framework/foundation/money` | [ADR-0042](../decisions/0042-exact-financial-amount-boundary.md), `financial-ledger.md` | Yes, D6 |
| Tax semantics and localization | Billing (5) | `erp/modules/tax`, `erp/modules/localization-id` | [ADR-0016](../decisions/0016-isolate-jurisdiction-localization.md), [ADR-0013](../decisions/0013-version-external-standard-adapters.md) | Yes, D5 |
| Reports: module-owned SQL views, a small report registry, CSV/XLSX export | Trial balance (4), aging (5) | each `erp/` module + `framework` report kit | Spec says reports are SQL and materialized views; [`state-and-consistency.md`](../architecture/state-and-consistency.md#read-consistency-classes) owns read classes | No; the analytic plane ([`analytics-architecture.md`](../architecture/analytics-architecture.md)) is the target, activated only by its own ADR (ADR-0093) |
| Jobs and scheduling (recurring invoices, dunning, period-end tasks) | Settlement (5) | `framework/data` | [`durable-execution.md`](../architecture/durable-execution.md), [`state-and-consistency.md`](../architecture/state-and-consistency.md) | No |
| Events and outbox | Every phase | `framework/events` | [`pgque-messaging.md`](../architecture/pgque-messaging.md) | No |
| PDF documents (invoice, delivery note, PO, statement) | Billing (5) | `framework/documents` | [`document-rendering.md`](../architecture/document-rendering.md) still describes the superseded Document AST platform | No ADR; rewrite the document |
| Attachments (object storage port) | Supplier bills (6) | `framework` port | ADR-0091 §4 lists the port | No |
| Spreadsheet import through owner commands | Pilot onboarding (7–8) | `framework` | None | No |
| Audit trail per document | Every phase | owner facts + `framework/events` | [`state-and-consistency.md`](../architecture/state-and-consistency.md#command-identity) | No |
| Search for pickers (products, parties) | Sales lines (5) | `framework` PostgreSQL search | [`search-architecture.md`](../architecture/search-architecture.md) | No |
| Process IR and the process engine | After Phase 6 | `framework/process` | [`process-studio.md`](../architecture/process-studio.md) as amended by ADR-0091 | Resumes per ADR-0091 §6 |
| External adapters (bank files, Coretax, marketplaces) | Settlement (5), localization (7–8) | `framework/modules/integrations` | [`integration-architecture.md`](../architecture/integration-architecture.md) | Per adapter, by ADR-0013 rules |

## 7. Decisions that need an ADR

Each item is a difficult-to-reverse ownership or protocol decision. None is decided by this proposal.

| ID | Decision | Why it needs an ADR | Needed before |
| --- | --- | --- | --- |
| D1 | Create `erp/modules/product` as owner of product identity, type, category, UoM and conversions; Inventory keeps stock-keeping facts | Moves authority that [ADR-0035](../decisions/0035-define-p1-inventory-primitives.md) gave Inventory | Phase 5 |
| D2 | Obligation and settlement ownership: Billing owns invoices, credit notes, supplier bills, and open items; a new Settlement module owns payments, allocation, payment terms, bank statements | The spec gates Settlement on this decision; procurement.md requires explicit Billing/Accounting boundaries for supplier bills | Phase 5 |
| D3 | Inventory valuation: Inventory owns moving-average cost layers; Accounting posts valuation facts through posting rules | Amends ADR-0035/[ADR-0036](../decisions/0036-define-p2-document-and-financial-baseline.md), which excluded valuation | Phase 6 |
| D4 | Sales delivery ownership: Sales owns delivery evidence and cumulative allocation, Inventory owns movement (mirrors [ADR-0047](../decisions/0047-define-procurement-goods-receipt-boundary.md)) | Chooses between the Odoo model (picking in Inventory) and the SAP model (delivery in SD); must stay consistent with receipt | Phase 5 |
| D5 | Tax ownership: neutral `tax` module plus `localization-id`; tax lines owned by the document owner, computed by the tax contract | Applies [ADR-0016](../decisions/0016-isolate-jurisdiction-localization.md) to a concrete owner | Phase 5 |
| D6 | Multi-currency: currency registry and exponent, exchange-rate owner, transaction versus base amounts, revaluation | [ADR-0042](../decisions/0042-exact-financial-amount-boundary.md) fixes two-decimal base-currency money | Post-pilot |
| D7 | Sales customers become references to a Party customer role (as Supplier Accounts already do), with a forward migration | Changes customer identity ownership described in [`sales.md`](../architecture/sales.md) | Phase 5 |
| D8 | Module manifest and extension-point contract (custom fields, hooks, document actions, versioning, contract tests), absorbing the action/event catalog as the released-contract section (Section 10.3) | Replaces the superseded plugin model ([ADR-0007](../decisions/0007-adopt-tiered-plugin-trust.md), [ADR-0023](../decisions/0023-adopt-capability-oriented-plugin-contribution.md)) | Phase 3 |
| D9 | Document numbering: scopes, gapless versus gap-tolerant series, allocation at post time, concurrency, correction behavior | Legal numbering for invoices and tax documents is hard to change after go-live | Phase 4 |
| D10 | Approvals service: rule shape, approver resolution, delegation, SoD enforcement, relation to future Process IR human tasks | Crosses authorization and every document owner | Phase 4 |
| D11 | Intercompany transactions between legal entities of one tenant | Cross-entity posting and elimination rules | Post-pilot |
| D12 | First operational module (manufacturing, project, or assets), when a pilot requests it | [`domain-maturity.md`](../roadmap/domain-maturity.md) D3 rule | When requested |

## 8. Phased roadmap

Phases 3–8 are the framework reset phases; [`framework-reset.md`](./framework-reset.md#8-phases) owns
their framework exit criteria. This table adds the ERP content and ERP exit criteria. Phases 9–12
are proposed post-pilot waves; their order is a default that pilot evidence may change.

### 8.1 Core loops (before and during pilots)

| Phase | ERP content | Depends on | Prerequisites (Section 6) | ERP exit criteria |
| --- | --- | --- | --- | --- |
| 3. Module kernel | Manifests for the seven existing modules; no new business scope | Phase 2 | Manifest, registry, generator (D8) | Every `erp/` module declares owned schema, capabilities, events, and routes; boundary checks reject undeclared cross-module imports |
| 4. Ledger and numbering | PostgreSQL ledger rewrite in `accounting` through `FinancialLedgerPort`, keeping the TigerBeetle path (ADR-0092); account hierarchy and COA template mechanism; posting-rule contract; trial balance and GL detail; Party addresses, contacts, bank accounts | 3 | Numbering (D9), approvals (D10), report kit, multi-legal-entity scoping | Balanced journals only (database-enforced); period close rejects pending work; numbered journals per legal entity and fiscal year; trial balance equals the sum of posted lines in tests |
| 5. Order-to-Cash | `product` module (D1); customer as Party role (D7); quotation lifecycle; sales price lists and discounts; neutral `tax` module (D5); delivery (D4); `billing` customer invoices and credit notes; `settlement` receipts, allocation, payment terms, AR aging, customer statement (D2); invoice PDF and email | 4 | Extension points (custom fields on Product and Sales documents), PDFs, jobs, search | A seeded tenant quotes, confirms, delivers partially, invoices with tax, collects, and issues a credit note; AR aging equals the receivables control account; stock movements equal delivered quantities |
| 6. Procure-to-Pay and valuation | Supplier prices; PO approval; supplier bill with three-way match; purchase returns and receipt reversal; outgoing payments and AP aging; moving-average valuation and COGS posting (D3); stock count | 5 | Approvals, attachments | Bill cannot exceed received quantity without an approved variance; AP aging equals the payables control account; inventory valuation report equals the inventory GL account in tests |
| 7. Developer preview | `localization-id` skeleton built as an outside developer would build it (Indonesian COA template, NPWP/NIK schemes) using only public APIs | 6 | Generator, released extension points | The localization module installs, extends Product and Billing only through released extension points, and passes its contract tests |
| 8. Pilots | `localization-id`: PPN, PPh withholding, Coretax e-Faktur export; bank statement import and manual reconciliation; profit and loss and balance sheet; spreadsheet import of masters and opening balances | 7 | Integration adapters, import | 2–3 companies close one real month: invoices, tax output, payments, stock, and statements reconcile without off-system spreadsheets |

### 8.2 Post-pilot waves (default order)

| Wave | Content | Stance | Depends on | Exit criteria |
| --- | --- | --- | --- | --- |
| 9. Finance depth | Multi-currency and revaluation (D6); analytic dimensions; deferred revenue schedules; recurring journals; period reopen and adjusting periods; budgets versus actuals; supplier payment runs with bank file export; dunning; optionally the TigerBeetle adapter as an inactive second implementation of the ledger port (ADR-0092), activated only by its own ADR | Later, realistic | 8 | A foreign-currency invoice and payment post realized and unrealized FX in tests; budgets report against analytic dimensions |
| 10. Supply-chain depth | Lots and serials with expiry; bins; min/max replenishment proposing POs; UoM conversion at receipt and sale; landed costs; drop-ship; credit-limit holds; simple available-to-promise | Later, realistic | 8 | Lot traceability query from receipt to delivery; landed cost changes valuation and GL consistently |
| 11. Commercial and process | Process IR and engine return (ADR-0091 §6) on extension points and events; CRM pipeline and activities; recurring invoicing; intercompany (D11) | Later, realistic in part | 8, and O2C/P2P running end to end | A released process definition coordinates an approval and a document action through public contracts only |
| 12. Operational modules | One at a time, each with D12: light manufacturing (BOM, production order, component backflush, finished-goods valuation); projects with timesheets and service billing; fixed assets and straight-line depreciation; quality checks; maintenance | Later, only on request | 9–10 | The requesting pilot runs the process monthly; the module touches other modules only through released extension points and events |

### 8.3 Dependency graph

```text
3 module kernel
   └─▶ 4 ledger + numbering + approvals
          └─▶ 5 O2C: product, tax, delivery, billing, settlement
                 └─▶ 6 P2P + valuation
                        └─▶ 7 developer preview (localization-id as an outside module)
                               └─▶ 8 pilots (Indonesian tax output, bank import, statements)
                                      ├─▶ 9 finance depth
                                      ├─▶ 10 supply-chain depth
                                      └─▶ 11 process engine, CRM, intercompany
                                             └─▶ 12 operational modules, one per request
```

## 9. Scope honesty

### 9.1 Realistic for a small team

- Phases 3–8 are a full year of focused work for a small team even at this reduced scope; the
  ledger rewrite, tax, and settlement are each larger than any module built so far.
- Waves 9 and 10 are realistic because they deepen existing owners rather than add new ones.
- Wave 11's process engine already has substantial code; its risk is scope, not feasibility.
- Wave 12 is realistic only module by module, and only in the light form described. Each module
  should be sized against what a pilot actually does monthly, not against Odoo's app of the same name.

### 9.2 Deliberately not copied

| Feature | Source | Why not |
| --- | --- | --- |
| Model inheritance and view patching across modules (`_inherit`, XPath view extension) | Odoo | Breaks invariants and upgrades; ADR-0091 rejects it. Released extension points replace it |
| Studio-style arbitrary fields and logic on other modules' tables | Odoo | Same reason; custom fields go through the owner's extension point |
| Condition technique for pricing, tax, and output | SAP | Configuration power far beyond SME needs; price lists, discounts, and a tax module cover the segment |
| IMG customizing tables for every behavior | SAP | Turns business rules into untyped configuration; RITSEI keeps rules in typed owner code |
| Material ledger actual costing, product costing, CO-PA | SAP | Moving average plus analytic dimensions serves distribution SMEs |
| MRP Live, PP-DS, APO-style planning | SAP | Min/max replenishment first; planning only with a named manufacturing user |
| EWM (tasks, waves, yard, labor) | SAP | Bins and pick lists are enough for the segment |
| Treasury, hedging, in-house bank | SAP | No SME need |
| Group consolidation, multi-GAAP parallel ledgers, IFRS 15/16 subledgers | SAP | Enterprise-only; revisit only with a named user and an ADR |
| GRC suite | SAP | SoD and audit live in authorization and owner facts |
| Website builder, eCommerce, POS, marketing suite | Odoo | Integrate with external shops and marketplaces through connectors instead |
| Discuss, Knowledge, Documents, Sign, Helpdesk, Fleet, Rental, Field Service | Odoo | Not ERP core for the segment; candidates for `extensions/` |
| Payroll in the flagship | Odoo, SAP | Heavily localized and regulated; a localization extension or partner integration |
| BI and self-service analytics platform | SAP SAC, Odoo spreadsheets | Fixed SQL reports and CSV/XLSX export first; the analytic plane stays a target design (ADR-0093), not a BI suite |

## 10. Contradictions and stale documents

### 10.1 Aligned in the same change as this proposal

The owner decided to keep TigerBeetle as the designated future ledger engine
([ADR-0092](../decisions/0092-retain-tigerbeetle-as-designated-ledger-engine.md)), and workload
isolation, the Stateful Entity Runtime, and the analytic plane as target designs
([ADR-0093](../decisions/0093-retain-isolation-runtime-and-analytic-target-designs.md)). Their
architecture documents, the `workload` roadmap, and two reference documents were restored from git
with target-design banners. These documents were aligned through status banners and reference fixes,
keeping their content:

- [`financial-ledger.md`](../architecture/financial-ledger.md): current authority stated at the top;
  TigerBeetle sections kept as the target design; the ledger rewrite placed in Phase 4.
- [`architecture-spec-v4.md`](../architecture/architecture-spec-v4.md): the financial execution,
  stateful ownership, overload isolation, and analytic plane rows, and their contracts, now state
  current and target side by side.
- [`overview.md`](../architecture/overview.md): a banner with the current runtime shape; the
  diagram is labeled as the target design.
- [`../roadmap/README.md`](../roadmap/README.md): a track status table (financial and workload
  dormant, process and packs deferred).
- [`plugin-architecture.md`](../architecture/plugin-architecture.md): ADR-0091 §3 named as the active
  rule; trust tiers kept as target design.
- [`document-rendering.md`](../architecture/document-rendering.md): ADR-0081 marked superseded; the
  document kept as the growth path for `framework/documents`.
- [`process-studio.md`](../architecture/process-studio.md): ADR-0091 §6 deferral banner; rules from
  the superseded ADR-0020, ADR-0023, and ADR-0083 pointed to their current owners.

### 10.2 Still open

Reported, not fixed, per [`AGENTS.md`](../../AGENTS.md#source-of-truth-order):

- [`architecture-spec-v4.md`](../architecture/architecture-spec-v4.md) still shows the
  pre-restructure `modules/` tree. (Its Zig row and section, `native-zig-kernel.md`, and the Zig
  notes in the overview and plugin architecture were deleted, following ADR-0091.)
- The restored target-design documents still name pre-restructure paths (`runtime/`, `modules/`);
  each is revised when its subsystem is activated.

### 10.3 Recommendation on "catalog"

`framework/modules/catalog` is not a product catalog. It holds the shared schemas for typed action
and event catalog entries, with stability levels from `PRIVATE` to `RETIRED`, idempotency,
compensation, and compatibility ranges, and every ERP module publishes its actions and events
through it. That is the same concept as ADR-0091's "released, versioned extension points" and SAP's
catalog of released APIs. The reset proposal's `erp/catalog/` for products would give the word two
meanings in one repository.

Recommended:

1. **Name the ERP product master `product`** (`erp/modules/product`, D1). The user interface may
   still call the screen "Product catalog".
2. **Keep `framework/modules/catalog` as it is for now.** Renaming it today churns imports in every
   module for no behavior change.
3. **Fold it into the module kernel in Phase 3.** When the module manifest is built (D8), the action
   and event catalog becomes the manifest's released-contract section, next to extension points, so
   a module declares everything it releases in one place. Record that move and the final name in the
   D8 ADR, and update the reset proposal's target tree (`erp/catalog/` to `erp/product/`) in the D1
   ADR.

## 11. Open questions for the owner

1. Is the PPN and Coretax output a hard requirement for the first pilot month? If so, part of
   `localization-id` moves from Phase 8 into Phase 5.
2. Should supplier bills live in Billing (one obligation owner, as proposed in D2) or in
   Procurement (closer to Odoo's purchase-centric flow)?
3. Do the target pilots need lots and expiry dates (pharma, food) in the first month? If so, part of
   Wave 10 moves before pilots.
4. Which first operational module is most likely to be requested by the pilot candidates:
   light manufacturing, services projects, or fixed assets?
