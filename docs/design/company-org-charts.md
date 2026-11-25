# Company Org Charts for Ticketing and ERP Design

> **Status:** Reference and brainstorming input. Not binding: nothing here changes a rule, a
> contract, or the roadmap. Companies, headcounts, and ticket volumes are made up scenarios.
>
> **Purpose:** Fourteen organization charts, from a four-person company to a global group, each
> with the ticket flows that cross it and what RITSEI does and does not offer today. It is the
> material a designer reads before drawing screens for roles, inboxes, and scopes.
>
> **Related documents**
>
> - Scope contract: [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md#scope-and-user-account-contract)
> - Authorization: [`../architecture/authorization.md`](../architecture/authorization.md)
> - Scope and identity decisions: [`../decisions/0021-define-p0-scope-and-identity-model.md`](../decisions/0021-define-p0-scope-and-identity-model.md)
> - Odoo and SAP functional map: [`../proposals/erp-module-parity-plan.md`](../proposals/erp-module-parity-plan.md)
> - Communication platform: [`../architecture/communication.md`](../architecture/communication.md)
> - Process Studio (deferred): [`../architecture/process-studio.md`](../architecture/process-studio.md)
> - Search: [`../architecture/search-architecture.md`](../architecture/search-architecture.md)
> - Design system and screens: [`../architecture/design-system.md`](../architecture/design-system.md), [`./kontainer/screens.md`](./kontainer/screens.md)

## 1. How to use this file

Read section 2 once: it is the identity RITSEI already has, with its sources. Then read the charts
in order or jump to the size nearest the customer being designed for. Every chart has the same five
parts, so two charts can be set side by side.

1. **Org chart.** Who reports to whom, and where the legal entities and sites are.
2. **Ticket flows.** The kinds of ticket that exist at this size, who raises, approves, resolves,
   and where it escalates.
3. **In RITSEI.** The scope tree, roles, approvals, and modules the chart would use, and what is
   missing. Capability names are illustrative and follow the `module.object.verb` shape.
4. **Odoo and SAP.** How the same company is usually covered, taken from the parity plan, not from
   memory of either product.
5. **Design hooks.** Questions a screen design has to answer for this size.

Roles carry the Indonesian title where it is common (Direktur Utama, HRD, Komisaris), because that
is how the people in these companies name themselves.

## 2. What RITSEI already says about identity

Everything below is existing, and each line names its source. A chart may use more than this, but
the extra is marked as a gap in section 7.

| Fact                                                                                                                                                                                      | Source                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| The scope tree is Tenant, then Legal Entity, then optional Branch and Warehouse. In P0 a legal entity is one-to-one with an organization, and a warehouse belongs to a legal entity.      | [Scope contract](../architecture/architecture-spec-v4.md#scope-and-user-account-contract)                   |
| A grant may be limited to tenant, legal entity, branch, warehouse, department, cost center, project, owned records, one resource, or a hierarchy subtree.                                 | [Authorization, Scope](../architecture/authorization.md#scope)                                              |
| Permissions are business capabilities (`accounting.invoice.approve`). Broad `manage`, `admin`, and `full_access` are forbidden.                                                           | [Authorization, Permission shape](../architecture/authorization.md#permission-shape)                        |
| A role bundles capabilities, and scope is a property of the grant. Role variants such as `FINANCE_MANAGER_PT_A_JAKARTA` are not allowed: one role, several scoped grants.                 | [Authorization, Scope](../architecture/authorization.md#scope)                                              |
| Separation of duties is a policy layer: the creator is not the approver, and an amount above a threshold needs a designated approver.                                                     | [Authorization, SoD](../architecture/authorization.md#process-execution-authority-and-separation-of-duties) |
| Principals are human, service, process, or delegated. A delegated principal keeps the delegating authority, scope, expiry, and reason.                                                    | same                                                                                                        |
| A party holds tenant-wide roles such as customer, supplier, employee, or partner. A role or relationship never grants authorization by itself.                                            | [ADR-0021](../decisions/0021-define-p0-scope-and-identity-model.md)                                         |
| Approvals today are threshold policies per subject type, with self-approval refused. Approver resolution beyond that, delegation, and the link to human tasks in a process are open.      | `framework/modules/approvals`; parity plan decision D10                                                     |
| The process engine is deferred until order-to-cash and procure-to-pay run end to end.                                                                                                     | [`AGENTS.md`](../../AGENTS.md#framework-and-erp), [Process Studio](../architecture/process-studio.md)       |
| Messages go through an outbox, with an activity timeline as a projection.                                                                                                                 | [Communication](../architecture/communication.md)                                                           |
| Support tickets are named as lexical search content. A search result is a candidate, never proof of authorization.                                                                        | [Search](../architecture/search-architecture.md)                                                            |
| Helpdesk is "no in flagship; candidate for `extensions/`". HR core and leave are an extension. Payroll is not in the flagship. Group consolidation is not planned; intercompany is later. | [Parity plan](../proposals/erp-module-parity-plan.md)                                                       |
| Employees are a party role. Projects, expenses, quality, and maintenance are later modules or extensions.                                                                                 | same                                                                                                        |

So: **there is no ticketing module.** A ticket in these charts is a design object that would live in
an extension, built on the party roles, the approvals service, the scoped grants, the outbox, and
the numbering service that exist.

## 3. Vocabulary used in the charts

| Term        | Meaning here                                                                                                                                                                 |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ticket      | A request or a problem with an owner, a state, a queue, and a history.                                                                                                       |
| Requester   | The person, or the service principal, that raises it.                                                                                                                        |
| Queue       | The set of tickets a team may pick up. A queue is scoped, not global.                                                                                                        |
| Resolver    | The person who does the work.                                                                                                                                                |
| Approver    | The person whose approval a rule requires before the work or the payment.                                                                                                    |
| Escalation  | Moving a ticket to a higher tier, a more senior person, or another team.                                                                                                     |
| Dotted line | A reporting or approval line that crosses the formal hierarchy.                                                                                                              |
| SoD         | Separation of duties: the same person may not raise and approve.                                                                                                             |
| Scope tag   | `[T]` tenant, `[LE]` legal entity, `[BR]` branch, `[WH]` warehouse, `[DEP]` department, `[CC]` cost center, `[PRJ]` project, `[REC]` own records, `[SUB]` hierarchy subtree. |

Ticket kinds used across the charts: **access** (account, role, permission), **device** (laptop,
phone), **leave and HR**, **purchase request**, **expense claim**, **finance exception** (invoice
variance, payment hold), **incident** (something is broken), **problem** (why it keeps breaking),
**change** (a planned risky change), **security**, **audit finding**, **legal and compliance**.

## 4. The charts

### C1. Four-person company

Scenario: a software studio. Four people, one legal entity, no branch, no warehouse. Everyone does
everything, and the owner approves what matters.

```text
CEO (Direktur Utama)
├── Director (Direktur)            finance, contracts, bank
├── HRD                            people, leave, devices
└── Senior Engineer                builds, deploys, supports customers
```

**Ticket flows**

```text
Senior Engineer ──"laptop broke"──────────▶ HRD (device) ─────▶ closed
HRD ──"new hire needs accounts"──────────▶ Senior Engineer (access) ─▶ closed
Anyone ──"buy a license, Rp 3 jt"────────▶ Director ───────────▶ bought
Customer ──"bug"─────────────────────────▶ Senior Engineer ───▶ closed
CEO ──"approve the contract"─────────────▶ CEO signs; Director files
```

- Four ticket kinds cover the company: access, device, purchase, incident.
- Escalation is a message to the CEO. There is no queue, no SLA, no tier.

**In RITSEI**

- Scope: tenant only `[T]`; one legal entity; no branch. A single `employee` party role per person.
- Grants: four roles at tenant scope. The Director holds the purchase and bill capabilities; the CEO
  holds the approval capability for amounts above a small threshold; the Senior Engineer holds
  `authorization.role.assign` only if the studio accepts that an engineer grants access (the
  alternative is the CEO).
- Approvals: one threshold policy per subject type. SoD still applies: the CEO cannot approve a
  purchase the CEO raised, so in a four-person company the Director raises and the CEO approves, or
  the reverse.
- Gap: no ticket object. Today the only way to record "laptop broke" is outside RITSEI.

**Odoo and SAP.** Odoo covers this with a few apps and one company; SAP Business One is the nearest
SAP fit. Helpdesk would be a separate Odoo app, which the parity plan marks as outside the flagship.

**Design hooks**

- One inbox, not four workspaces. Is "my tickets" the home screen?
- With so few people, SoD forces a person to switch hats. How does a screen show "you raised this,
  so someone else must approve" without a dead end?
- Does a tiny company need roles at all, or only a list of people with a short list of powers?

### C2. Startup, 25 people

Scenario: a product startup. One legal entity, one office. Engineers outnumber everyone, and a part
time accountant keeps the books.

```text
CEO
├── CTO
│   ├── Senior Engineer (platform)
│   ├── Senior Engineer (product)
│   ├── Engineers (x8)
│   └── Designer (x2)
├── Head of Operations
│   ├── Customer Support (x3)
│   └── Office Admin
├── HRD
└── Finance (part time, external accountant)
```

**Ticket flows**

```text
Customer ─▶ Support (L1) ─▶ Senior Engineer (L2) ─▶ CTO     incident, 3 tiers in 3 people
Engineer ─▶ Office Admin ─▶ Head of Operations              device, purchase up to a limit
Anyone ─▶ HRD ─▶ CEO                                        leave beyond policy, salary
Engineer ─▶ CTO                                             access to production
Head of Operations ─▶ Finance ─▶ CEO                        purchase above Rp 10 jt
```

- Two real queues appear: customer support and internal requests.
- Production access is the first ticket that needs a second person on purpose.

**In RITSEI**

- Scope: tenant `[T]`, plus `[DEP]` for Engineering and Support, once departments exist as a scope.
- Approvals: purchase threshold in two steps (Head of Operations up to a limit, CEO above it). The
  existing policy has one threshold per subject type, so the second step is a gap (D10).
- External accountant: a human principal with read and post capabilities and no approval capability.
- Customer tickets: the requester is a customer party, not a user. That is a different identity
  from every internal ticket.

**Odoo and SAP.** Odoo Helpdesk plus Approvals; SAP is rarely chosen at this size.

**Design hooks**

- Two inboxes with different vocabulary (customer problem, internal request). One screen or two?
- Is the external accountant a guest with a narrow view?
- The L1 to L2 handoff is a conversation. How much of it must be kept as history?

### C3. Trading and distribution SME, 120 people

Scenario: the flagship segment of the parity plan. One legal entity, head office and two
warehouses, quote-to-cash and procure-to-pay every day.

```text
Direktur Utama
├── Direktur Operasional
│   ├── Purchasing Manager ── Buyers (x3)
│   ├── Warehouse Manager ─┬─ Warehouse A (Jakarta)   Staff (x10)
│   │                      └─ Warehouse B (Cikarang)  Staff (x8)
│   └── Logistics Coordinator ── Drivers (x6, outsourced)
├── Direktur Komersial
│   ├── Sales Manager ── Sales (x12)
│   └── Customer Service (x4)
├── Direktur Keuangan
│   ├── Finance Manager ── AR (x2), AP (x2), Tax
│   └── Accounting (x2)
├── HRD ── HR Staff (x2)
└── IT ── IT Support (x2), Senior Engineer (internal systems)
```

**Ticket flows**

```text
Sales ─"discount above limit"──────▶ Sales Manager ─▶ Direktur Komersial       approval
Buyer ─"PO above Rp 100 jt"────────▶ Finance Manager ─▶ Direktur Keuangan      approval
AP ─"supplier bill differs from receipt"─▶ Finance Manager                     finance exception
Warehouse ─"stock count variance"──▶ Warehouse Manager ─▶ Finance (adjust)     inventory exception
Anyone ─"reset my password"────────▶ IT Support ─▶ Senior Engineer            access
Anyone ─"give me the AR report"────▶ Finance Manager ─▶ IT (access)            access
Customer Service ─"customer disputes an invoice"─▶ AR ─▶ Finance Manager       dispute
```

- Most tickets here are approvals that come from a document (discount, PO, bill), not a free text
  request.
- A dispute crosses three departments and ends in a credit note.

**In RITSEI**

- Scope: tenant, legal entity, two warehouses `[WH]`, department scope for Sales, Purchasing,
  Finance. Warehouse staff hold stock capabilities scoped to their warehouse only.
- Approvals that exist today: purchase order above its limit, and supplier bill above its
  receipt. These two are the first tickets this company would see in "Needs action".
- Modules touched: `sales`, `procurement`, `inventory`, `billing`, `settlement`, `accounting`,
  `party`, `product`, `tax`, `localization_id`.
- Gaps: a two-step approval chain, delegation when a director travels, and the ticket object for
  IT and finance disputes.

**Odoo and SAP.** The parity plan names this segment as the target: Odoo Community's Sales,
Purchase, Inventory, and Invoicing, and SAP Business One. Odoo Approvals and Helpdesk are separate
apps; SAP uses flexible workflow for approvals.

**Design hooks**

- Needs action here is mostly document approvals. Is the ticket just another row in the same list?
- A warehouse manager acts in one warehouse. How does the screen make that scope obvious?
- Who sees a dispute: the one who raised it, the one resolving it, or both with different views?

### C4. Multi-branch retail company, 600 people

Scenario: one legal entity, a head office, five regional offices, and 40 branches. Branches sell and
hold small stock; the regions manage them.

```text
Direktur Utama
├── Direktur Operasional
│   ├── Regional Manager ─ Region 1 ─┬─ Branch Manager ─ Branch Staff (x8)
│   │                                ├─ Branch Manager ─ Branch Staff (x8)
│   │                                └─ ... (8 branches)
│   ├── Regional Manager ─ Region 2 ... Region 5
│   └── Central Warehouse Manager ─ Central Warehouse
├── Direktur Keuangan ── Finance, Tax, Treasury
├── Direktur Merchandising ── Category Managers ── Buyers
├── HRD ── HR Business Partners (one per region)
└── IT ── Service Desk (x6), Senior Engineers (x3), Store Systems
```

**Ticket flows**

```text
Branch Staff ─"POS terminal down"──▶ Service Desk ─▶ Store Systems ─▶ vendor      incident
Branch Manager ─"stock transfer"───▶ Regional Manager ─▶ Central Warehouse       transfer
Branch Manager ─"cash difference"──▶ Regional Manager ─▶ Finance                  finance exception
Branch Staff ─"sick leave"─────────▶ Branch Manager ─▶ HR Business Partner        HR
Category Manager ─"price change"───▶ Direktur Merchandising                       approval
Regional Manager ─"new branch"─────▶ Direktur Operasional ─▶ Direktur Utama      change
```

- The branch is the unit of almost every ticket. The same incident type repeats across 40 places.
- A ticket often needs the branch and its region at once: the branch resolves, the region approves.

**In RITSEI**

- Scope: tenant, legal entity, branches `[BR]` as a first-class scope, warehouses `[WH]`, and a
  region as a hierarchy subtree `[SUB]`. The scope contract has branches today. A region above
  branches is not a defined level; it would be a hierarchy subtree of branches.
- Grants: a Branch Manager holds capabilities on one branch; a Regional Manager on a subtree of
  eight. One role, scoped grants, never "Branch Manager Jakarta 3" as a role.
- Gaps: a hierarchy subtree needs the hierarchy graph, which is a design in the references
  ([graph models](../architecture/reference/graph-models.md),
  [ltree notes](../architecture/reference/ltree-notes.md)), not a shipped scope.

**Odoo and SAP.** Odoo uses companies and warehouses; SAP uses company code, plant, and sales or
purchasing organization. A branch maps to a plant or a warehouse in both.

**Design hooks**

- A regional manager works over eight branches. Is the main screen a map of branches with counts of
  open tickets, a list, or a queue?
- Repetition: the same incident in 12 branches is one problem. How does a screen show that?
- Switching scope should be one gesture, and the current scope must always be visible.

### C5. Manufacturer, 900 people, two plants

Scenario: one legal entity with two plants and a distribution warehouse. Production, quality, and
maintenance matter as much as sales.

```text
Direktur Utama
├── Direktur Produksi
│   ├── Plant Manager (Plant 1) ─┬─ Production Supervisors (x4) ── Operators
│   │                            ├─ Quality Manager ── QC Inspectors
│   │                            └─ Maintenance Manager ── Technicians
│   ├── Plant Manager (Plant 2) ─ same shape
│   └── Supply Chain Manager ── Planner, Buyers, Warehouse (x3)
├── Direktur Komersial ── Sales, Key Accounts, Customer Service
├── Direktur Keuangan ── Finance, Cost Accounting, Tax
├── HRD ── HR, Safety (K3)
└── IT/OT ── Service Desk, Senior Engineer (ERP), OT Engineer (plant systems)
```

**Ticket flows**

```text
Operator ─"machine stopped"────────▶ Maintenance Manager ─▶ Technician ─▶ closed     work order
QC Inspector ─"batch fails"────────▶ Quality Manager ─▶ Plant Manager ─▶ hold/release quality hold
Supervisor ─"material short"───────▶ Planner ─▶ Buyer ─▶ PO approval                  procure
Technician ─"spare part, Rp 40 jt"─▶ Maintenance Manager ─▶ Supply Chain ─▶ Finance   purchase
Anyone ─"safety incident"──────────▶ Safety (K3) ─▶ Plant Manager ─▶ Direktur Produksi  incident
Planner ─"change a recipe"─────────▶ Quality Manager + Plant Manager (two approvers)   change
```

- Two tickets have no equivalent in the trading company: the quality hold and the change of a
  recipe or routing, which need two approvers from different functions.
- A machine stoppage is a ticket and also an inventory and cost event.

**In RITSEI**

- Scope: tenant, legal entity, plants as branches or warehouses `[BR]` `[WH]`, cost centers `[CC]`.
- Modules: manufacturing, quality, and maintenance are later or extensions in the parity plan. Only
  the procurement, inventory, and accounting parts exist.
- Approvals: a change needs two approvers from different functions, which one threshold per
  subject type cannot express (D10).
- Gap: OT systems (plant floor) would connect through the integration surface as service
  principals, with no human at the keyboard.

**Odoo and SAP.** Odoo MRP, Quality, and Maintenance apps; SAP PP, QM, and PM. The parity plan
marks all three "later, evidence-gated".

**Design hooks**

- Shop-floor users do not sit at a desk. A ticket from a tablet or a QR code at the machine?
- A quality hold blocks stock. The ticket has a business effect beyond its own state.
- Two approvers from two functions: the screen must show both are needed and who is missing.

### C6. Software company with tiered support, 400 people

Scenario: a SaaS company. One legal entity, two offices, and a 24-hour product. Ticketing is part
of the product and of the company: customers raise tickets, engineers fix them, and a change board
approves risky releases.

```text
CEO
├── CTO
│   ├── VP Engineering ─ Engineering Managers (x6) ─ Teams of 6 ─ Senior Engineers, Engineers
│   ├── Head of SRE ── SRE on-call rota (x8)
│   └── Head of Security ── Security Engineers (x4)
├── Chief Customer Officer
│   ├── Support Director ─┬─ L1 Support (x20)
│   │                     ├─ L2 Support (x8)
│   │                     └─ Customer Success Managers (x6)
│   └── Solutions Engineers (x4)
├── CFO ── Finance, Billing Operations, Revenue Operations
├── CHRO ── HRD, Talent, People Operations
└── General Counsel ── Legal, Compliance (SOC 2, data protection)
```

**Ticket flows**

```text
Customer ─▶ L1 ─▶ L2 ─▶ Engineering Manager ─▶ Senior Engineer ─▶ fix ─▶ release     incident, 4 tiers
Customer ─"same bug, 40 customers"─▶ Problem record owned by Engineering Manager      problem
Engineer ─"risky migration"──▶ Change Advisory Board (CTO, Head of SRE, Security)     change
SRE ─"page at 3 a.m."────────▶ on-call SRE ─▶ Senior Engineer on-call ─▶ CTO         major incident
Customer ─"data deletion request"─▶ Legal ─▶ Security ─▶ Support                      compliance
Support ─"refund, Rp 50 jt"──▶ Support Director ─▶ CFO                                finance exception
```

- Three kinds are different objects with links, not one list: **incident** (one customer),
  **problem** (the cause), **change** (the fix that is risky).
- On-call is a schedule, not a person: the owner of a major incident changes every shift.

**In RITSEI**

- Scope: tenant, one legal entity. Customers are parties with the customer role, so a ticket's
  requester is a party and an internal ticket's requester is a user account: two identities.
- Roles: one Support role with L1 and L2 queues expressed as scoped grants on the queue, not as two
  roles.
- This is the one chart where RITSEI would also be the ticketing product's host, and the product's
  own customers would be tenants of RITSEI. That is a different scale question: ticket volume and
  search load ([search](../architecture/search-architecture.md): bounded top-k, tenant scope).
- Gaps: on-call schedules, SLA timers, and the problem-incident-change links. Timers would need
  the process engine.

**Odoo and SAP.** Odoo Helpdesk is a separate app. For SAP the parity plan lists helpdesk among the "various LoB clouds", not the core.

**Design hooks**

- The owner of a ticket changes by tier and by shift. Does the screen show "who has it now" and "who
  had it", and is that the same view?
- A problem record collects incidents. The link must be visible from both sides.
- A major incident needs a different screen: one place, one timeline, everyone watching.

### C7. Professional services firm, 350 people

Scenario: an engineering consultancy that sells projects. One legal entity, three offices. Revenue,
cost, and people are organized by project, not by department.

```text
Managing Partner (Direktur Utama)
├── Partner, Infrastructure ─┬─ Project Director A ── Project Manager ── Engineers, Drafters
│                            └─ Project Director B ── Project Manager ── ...
├── Partner, Energy ── Project Directors (x3)
├── Director of Practice (quality, methods) ── Senior Engineers (principal level)
├── Director of Finance ── Project Accounting, Billing, Tax
├── HRD ── Resourcing (assigns people to projects), Recruiting
└── IT ── Service Desk, Senior Engineer (internal tools)
```

**Ticket flows**

```text
Engineer ─"need a licence for project X"──▶ Project Manager ─▶ Project Director   purchase, charged to project
Project Manager ─"extra 200 hours"────────▶ Project Director ─▶ Partner           change order
Engineer ─"expense claim, travel"──────────▶ Project Manager ─▶ Finance            expense
Resourcing ─"move an engineer"─────────────▶ both Project Managers agree           staffing
Client ─"scope change"─────────────────────▶ Project Manager ─▶ Project Director ─▶ Finance (invoice)
Project Manager ─"timesheet incomplete"────▶ Engineer ─▶ Project Manager           reminder
```

- Almost every ticket carries a project. The project decides who approves and which budget pays.
- Staffing is a ticket that two managers must agree on, and neither is above the other.

**In RITSEI**

- Scope: `[PRJ]` is a named grant scope. A Project Manager holds approval capabilities on the
  projects they manage, and nothing else.
- Cost center `[CC]` and project would be dimensions on journal lines (parity plan: analytic
  dimensions later). Projects, timesheets, and service billing are a later module.
- Approvals: a change order is amount-based and project-based at once.
- Gap: there is no project module, so every project ticket here is hypothetical.

**Odoo and SAP.** Odoo Project and Timesheets; SAP PS and CATS. Both are later in the parity plan.

**Design hooks**

- The main screen of a manager is a project, not an inbox. Do tickets live inside the project?
- A person works on several projects. Their own view groups by project or by date?
- A project closes: what happens to its open tickets and its approvers?

### C8. Holding with four subsidiaries, 1,500 people

Scenario: a family holding that owns four operating companies in Indonesia, each its own legal
entity. The holding runs finance, legal, HR policy, and IT as shared services.

```text
Komisaris Utama
└── Board of Directors (Direksi Holding)
    ├── Direktur Utama Holding
    │   ├── Corporate Finance ── Group Controller, Treasury, Tax
    │   ├── Corporate Legal ── Legal Counsel, Compliance
    │   ├── Corporate HR ── Head of HRD, Compensation, Talent
    │   └── Corporate IT ── CIO, Shared Service Desk, Senior Engineers (ERP, data, security)
    ├── PT Alpha Distribusi  ── Direktur, Finance, Sales, Warehouse
    ├── PT Beta Manufaktur   ── Direktur, Plants, Finance, HRD
    ├── PT Gamma Retail      ── Direktur, Branches, Finance, HRD
    └── PT Delta Properti    ── Direktur, Projects, Finance
```

**Ticket flows**

```text
Subsidiary Finance ─"intercompany invoice"──────▶ counterpart Finance ─▶ Group Controller   intercompany
Subsidiary HRD ─"hire a director"───────────────▶ Corporate HR ─▶ Direktur Utama Holding    HR
Any subsidiary ─"new user in ERP"───────────────▶ Shared Service Desk ─▶ Subsidiary admin    access
Subsidiary Direktur ─"loan above Rp 5 miliar"───▶ Corporate Finance ─▶ Board                finance
Corporate Legal ─"contract template change"─────▶ all subsidiaries' Legal contacts          legal
Shared Service Desk ─"ERP incident"─────────────▶ Corporate IT Senior Engineer              incident
```

- A ticket often has two legal entities: the one that raises and the one that owns the answer.
- The holding sees every subsidiary but does not do their work. Visibility is wide, action is narrow.

**In RITSEI**

- Scope: one tenant and four legal entities, or four tenants. The scope contract has several legal
  entities in one tenant ("multi-company"), but a group above them is explicitly deferred in
  ADR-0021, and group consolidation is "not planned" in the parity plan.
- Grants: the Group Controller holds read capabilities on all four entities and approval on none.
  A subsidiary's finance staff hold post capabilities on their own entity only.
- Intercompany: decision D11 is open. An intercompany invoice is two documents in two entities.
- Gap: no group level, so "all four" is four grants, not one scope.

**Odoo and SAP.** Odoo multi-company with inter-company rules; SAP company codes with Intercompany
and Group Reporting. The parity plan lists intercompany as later and consolidation as not planned.

**Design hooks**

- A holding user switches between entities all day. Switch, or see all at once with an entity column?
- The corporate team reads across, the subsidiary writes within. Two different shells?
- An intercompany ticket belongs to two entities. Which inbox shows it?

### C9. Conglomerate, 8,000 people, 18 legal entities

Scenario: a conglomerate in four industries (manufacturing, retail, property, energy), each a
business unit with several legal entities, a shared service center, and a board with committees.

```text
Komisaris Utama ── Board of Commissioners
├── Audit Committee ── Internal Audit
├── Risk and Compliance Committee
└── Nomination and Remuneration Committee
Group CEO
├── Group CFO ── Group Finance, Treasury, Tax, Investor Relations
├── Group COO
│   ├── BU Manufacturing ─ CEO BU ─ 5 legal entities ─ plants, sales, finance
│   ├── BU Retail        ─ CEO BU ─ 6 legal entities ─ regions, branches
│   ├── BU Property      ─ CEO BU ─ 4 legal entities ─ projects
│   └── BU Energy        ─ CEO BU ─ 3 legal entities ─ sites
├── Group CHRO ── HRD Group, HRD per BU, Learning
├── Group CIO ── Shared Service Center (finance ops, procurement ops, IT ops, HR ops)
│                └── Service Desk (T1), Application Support (T2), Architects, Senior Engineers (T3)
└── Group General Counsel
```

**Ticket flows**

```text
Employee ─▶ Service Desk (T1) ─▶ Application Support (T2) ─▶ Senior Engineer (T3)    incident
Entity Finance ─▶ SSC Finance Ops ─▶ Entity Finance Manager ─▶ Group Controller       finance ops request
Entity Buyer ─"PO Rp 2 miliar"──▶ SSC Procurement ─▶ BU CFO ─▶ Group CFO ─▶ Board      approval, 4 levels
BU Manufacturing ─"new plant"───▶ Group COO ─▶ Group CEO ─▶ Board                       investment
Internal Audit ─"finding"───────▶ Entity Director ─▶ Audit Committee                    audit finding
Group HRD ─"policy change"──────▶ all BU HRD ─▶ entity HRD                              HR, broadcast
```

- Approval chains reach four levels and depend on amount, BU, and entity at once.
- The shared service center is a team that works for 18 entities: its queue is scoped to many
  entities, and its people may act in each one.

**In RITSEI**

- Scope: 18 legal entities in one tenant, or one tenant per BU for isolation. The scope tree stops
  at legal entity; BU and group are not levels. A hierarchy subtree `[SUB]` could express a BU.
- Grants: an SSC clerk holds scoped grants on 18 entities, which means 18 grants, kept in sync by
  the tenant admin. This is the case where a hierarchy scope would pay off.
- SoD: the SSC clerk who posts must not be the one who approves in the same entity.
- Approvals: four-level chains are decision D10 (approver resolution, delegation). Today there is
  one threshold.
- Gap: the board and audit committee approve outside the ERP, but the record of the decision
  would be an object in it.

**Odoo and SAP.** The parity plan maps this to Odoo multi-company and SAP company codes, profit
centers, and flexible workflow. It scopes RITSEI to the SME first and lists consolidation as not
planned.

**Design hooks**

- A person with 18 grants needs "act as entity X" visible all the time, or they will post to the
  wrong entity.
- A four-level approval needs a screen that shows the chain, the current step, and who is next.
- The board is a user class with a tiny number of very high-stakes actions. Design for rarity.

### C10. Regional group, six countries in Southeast Asia, 5,000 people

Scenario: a company headquartered in Jakarta with legal entities in Indonesia, Malaysia, Singapore,
Thailand, Vietnam, and the Philippines. A regional headquarters and a shared service center. Local
law differs per country: tax, language, currency, working days.

```text
Group CEO (Jakarta)
├── Regional CFO ── Regional Finance ── Country Finance Controller (x6)
├── Regional COO ── Country Managing Director (x6) ── Country functions (sales, ops, HR)
├── Regional CHRO ── Regional HRD ── Country HRD (x6)
├── Regional CIO
│   ├── Shared Service Desk (Jakarta, hours 06:00 to 22:00 SGT)
│   ├── Regional Application Support
│   └── Senior Engineers (regional ERP team, localization engineers per country)
└── Regional Legal and Compliance ── Country counsel (x6)
```

**Ticket flows**

```text
Country employee ─▶ Shared Service Desk (English or local language) ─▶ Country IT partner   access, device
Country Finance ─"VAT filing question"─▶ Country Tax ─▶ Regional Tax ─▶ external advisor      tax
Country MD ─"hire above band"─▶ Country HRD ─▶ Regional CHRO                                  HR
Country Procurement ─"PO in MYR"─▶ Country Finance ─▶ Regional CFO (above USD threshold)      approval
Regional Application Support ─"e-invoice rejected in Vietnam"─▶ localization engineer         incident
```

- Each ticket has a country, a language, a currency, and a legal basis.
- The approval threshold is in one currency and the document is in another.

**In RITSEI**

- Scope: a legal entity per country. Currency and fiscal rules are per legal entity (`accounting`
  owns base currency and precision). Localization is outside the primitive core:
  `localization_id` is the Indonesian one, and each other country is another localization module.
- Timezone: tenant default, branch override, and warehouse override exist; a ticket SLA across six
  timezones uses them.
- Multi-currency and revaluation are post-pilot. A threshold across currencies needs it first.
- Language: one language per screen is a design choice, not a stored property of a ticket.
- Gap: five of the six localizations do not exist.

**Odoo and SAP.** The parity plan names Odoo's `l10n_*` localizations as the comparison. RITSEI starts with
Indonesia only.

**Design hooks**

- The same ticket is read by people in three languages. What is translated, and what stays as the
  author wrote it?
- The Service Desk hours do not cover all six timezones. Does the ticket show "next person online"?
- A threshold in USD, an amount in VND: show both, and show the rate and date used.

### C11. Global matrix multinational, 60,000 people

Scenario: a company in 60 countries, organized as a matrix. Every person has a function (finance,
engineering, sales), a business line, and a country. Reporting lines cross, and approvals follow
whichever line owns the decision.

```text
Group CEO ── Executive Committee
├── Functions                           ├── Business Lines                 ├── Regions
│   ├── CFO                             │   ├── Line A (industrial)        │   ├── Americas
│   ├── CHRO                            │   ├── Line B (consumer)          │   ├── EMEA
│   ├── CIO                             │   └── Line C (services)          │   └── APAC
│   ├── CTO                             │                                  │
│   ├── General Counsel                 │                                  │
│   └── Chief Risk Officer              │                                  │
└── Each person:  solid line to a function  +  dotted line to a business line  +  home in a country

Example:  Senior Engineer (Line A, Germany)
          solid  ─▶ Head of Engineering Line A      (work, promotion)
          dotted ─▶ CTO function                    (standards, architecture)
          home   ─▶ Country Manager Germany         (employment, local law)
```

**Ticket flows**

```text
Engineer (Germany) ─"need a prod database"─▶ Line A Engineering ─▶ CIO function (security) ─▶ DBA team   access
Country Finance ─"close the month"─▶ Regional Controller ─▶ Group Consolidation                          finance
Business Line CFO ─"capex Rp 50 miliar"─▶ Line CEO ─▶ Group CFO ─▶ Executive Committee ─▶ Board          approval
Employee ─"works council question"─▶ Country HRD ─▶ Regional CHRO ─▶ Group Employment Law                HR, local law
Anyone ─"suspected data breach"─▶ Security Operations ─▶ Chief Risk Officer ─▶ General Counsel ─▶ regulators  security
```

- A single approval can have three valid approvers (function, line, country). The rule that picks
  one is part of the policy, and it differs per ticket kind.
- Regulation is per country, so who may see a ticket depends on where the person who raised it
  works, not only on who they report to.

**In RITSEI**

- Scope: today, tenant, legal entity, branch, warehouse. A matrix needs at least three independent
  dimensions on one person. The scope list has department, cost center, project, and hierarchy
  subtree, which together can express function, line, and country, but a grant carries one scope.
- Tenancy: one tenant for 60 countries, or one per region for data residency. The architecture
  isolates by tenant and by legal entity; residency by region is a deployment question, not a scope.
- Approvals: this is the hardest case for D10. The approver is resolved from a function, a line, and
  a country at once, with delegation and SoD on top.
- Scale: the target designs for workload isolation, an analytic plane, and an entity runtime are
  inactive in the architecture documents and would be the first things this customer asks about. The
  charts are input for that evidence, not a reason to activate them.
- Consolidation: not planned. A customer of this size keeps its consolidation system.

**Odoo and SAP.** The parity plan lists company codes, profit centers, flexible workflow, and Group
Reporting as the SAP side of these needs. It does not target this size.

**Design hooks**

- A person has three bosses. Which one does "my manager" mean on each screen?
- The matrix produces ties: two valid approvers disagree. Does the screen show both and the rule
  that decides?
- A global user navigates by country, line, and function. One of the three must be the default.

### C12. Franchise and dealer network, 300 own staff, 1,200 partner sites

Scenario: a company that sells through franchisees and dealers. Few employees, many outside
parties that use the system and are not employees.

```text
Direktur Utama
├── Head of Network ── Area Managers (x12) ── Franchise Business Consultants
├── Head of Supply ── Distribution Centers (x4), Logistics
├── Head of Brand ── Marketing, Training
├── Finance ── Franchise Accounting (royalties), Credit Control
├── HRD (own staff only)
└── IT ── Partner Support Desk, Senior Engineer (partner portal, integrations)

Outside the company
├── Franchisee A ── Owner, Store Managers (x6), Staff (x40)
├── Franchisee B ── ...
├── Dealer C ── Owner, Sales (x4)
└── Extension Partner (logistics app) ── service principal
```

**Ticket flows**

```text
Franchise Store Manager ─"stock out"──────▶ Area Manager ─▶ Distribution Center                 order
Franchise Owner ─"royalty invoice is wrong"─▶ Franchise Accounting ─▶ Credit Control             dispute
Franchisee ─"change store layout"─────────▶ Franchise Business Consultant ─▶ Head of Brand       change
Dealer ─"warranty claim"──────────────────▶ Partner Support Desk ─▶ Head of Supply                claim
Partner app ─"shipment status"────────────▶ service principal ─▶ Distribution Center              automated
```

- Most requesters are not employees and have no account in the company's HR. They are parties
  with the partner or customer role.
- A partner sees only its own tickets and its own data. Nothing else may leak.

**In RITSEI**

- Scope: a franchisee is a party; if it has its own legal identity it can be a legal entity of the
  tenant or only a party with a relationship to the company's entity. Party relationships are
  scoped records that do not grant authorization by themselves.
- Grants: a store manager of a franchisee holds capabilities scoped to their own records `[REC]`
  or their own branch `[BR]`. The partner is a different kind of user from an employee.
- Extensions: the partner app is exactly what `extensions/` and service principals are for. It
  holds machine capabilities and no administrator rights.
- Gap: a partner portal is a different product surface from the employee application.

**Odoo and SAP.** The parity plan does not cover partner portals, so no comparison is drawn.

**Design hooks**

- Two applications or one with two modes? A partner must never see employee navigation.
- A franchisee's tickets must be quick to raise and plain to read, because the user is a shop owner.
- Automated tickets from a partner app arrive in volume. How are they separated from human ones?

### C13. Listed company with three lines of defense, 12,000 people

Scenario: a company listed on an exchange. The board has committees, internal audit reports to the
board, and compliance is a standing function. The structure exists to show control.

```text
Shareholders
└── Board of Commissioners (Dewan Komisaris)
    ├── Audit Committee ──────── Internal Audit (3rd line)
    ├── Risk Committee ───────── Chief Risk Officer (2nd line)
    ├── Nomination and Remuneration Committee
    └── Corporate Secretary
Board of Directors (Direksi)
└── Direktur Utama
    ├── Direktur Keuangan ── Finance, Treasury, Tax, Investor Relations      (1st line)
    ├── Direktur Operasi ── Business units, Plants, Supply Chain             (1st line)
    ├── Direktur SDM ── HRD, Learning, Employee Relations                    (1st line)
    ├── Direktur TI ── CIO, Security, Senior Engineers                       (1st line)
    ├── Chief Compliance Officer ── Compliance, Legal                        (2nd line)
    └── Chief Risk Officer ── Enterprise Risk, Information Security Risk     (2nd line)
Internal Audit ── reports to the Audit Committee, not to the Direktur Utama    (3rd line)
```

**Ticket flows**

```text
Internal Audit ─"finding: no second approver on journals"─▶ Direktur Keuangan ─▶ Audit Committee   audit finding
Employee ─"whistleblower report"─▶ Compliance (anonymous) ─▶ Audit Committee                        compliance
Finance ─"manual journal"─▶ second person ─▶ Finance Manager                                        SoD approval
IT ─"privileged access for 4 hours"─▶ Security ─▶ system owner ─▶ auto-revoked                      access, time-boxed
Risk ─"new risk accepted"─▶ Risk Committee                                                          risk acceptance
Corporate Secretary ─"related party transaction"─▶ Audit Committee ─▶ disclosure                    governance
```

- Evidence matters more than speed: who did what, who approved, with which authority, on which
  date, and that nobody did both.
- Some tickets must be invisible to the line that is being investigated.

**In RITSEI**

- Scope and SoD are the core of this chart. RITSEI states static and dynamic separation of duties
  as a policy layer, with audit and explainability as architecture sections of their own.
- Process authority: a process or a ticket does not become a superuser; delegated authority keeps
  the delegating person, scope, expiry, and reason.
- Access tickets for time-boxed privileges need delegated principals with expiry.
- Audit trail: committed facts go through the outbox, and compensation is a new command, never a
  deletion. A ticket must not be edited away either.
- Gap: restricted visibility (a ticket only the Audit Committee may read) is an object-level
  authorization case. The relationship layer exists; the ticket does not.

**Odoo and SAP.** The parity plan maps approvals to Odoo Approvals and SAP flexible workflow, and
places approvals and SoD in the RITSEI framework as core.

**Design hooks**

- Evidence screens: one page that proves a control was followed, printable, with names and times.
- Invisible tickets: how does a user know a ticket exists that they cannot read? (Usually they do
  not, and the design must not leak it.)
- A time-boxed privilege needs a visible clock and a visible end.

### C14. The ticket operation itself, at global scale

Scenario: the organization that runs tickets, drawn on its own. It is the service operation of C11
and C13 seen from inside, with the same ticket moving across tiers, regions, and vendors.

```text
Head of Service Operations
├── Service Desk, follow the sun
│   ├── Americas desk (16:00 to 01:00 UTC)
│   ├── EMEA desk     (07:00 to 16:00 UTC)
│   └── APAC desk     (23:00 to 08:00 UTC)
├── Resolver groups (one queue each)
│   ├── Identity and Access        ├── Network and Infrastructure
│   ├── Business Applications      ├── End User Devices
│   ├── Security Operations        └── Data and Reporting
├── Vendor management ── contracted resolver groups with their own SLA
├── Problem Management ── Problem Managers
├── Change Management ── Change Manager ── Change Advisory Board
└── Service Quality ── SLA reporting, customer satisfaction, knowledge base
```

**Ticket flows**

```text
Ticket created ─▶ Service Desk (on shift) ─▶ classify ─▶ resolver group queue ─▶ resolver
                       │                                          │
                       │                                          └─ not mine ─▶ back to desk with a reason
                       └─ duplicate? ─▶ link to the existing problem

Priority = impact x urgency            Escalation:  SLA at 75 percent ─▶ team lead
                                                     SLA breached      ─▶ duty manager
                                                     major incident     ─▶ bridge call, one owner
Handoff between desks: the ticket keeps its history, and the next desk sees the last note first.
Close: requester confirms, or the ticket closes itself after a period (and says so).
```

- Time is the main subject: shifts, SLA clocks, business calendars per country, and pauses while
  waiting for the requester.
- Quality is measured on the ticket history, so history must be complete and not editable.

**In RITSEI**

- Scope: the resolver groups are queues scoped to entities or to the tenant. A vendor group is a
  party with a partner role and a service principal or a user account of its own.
- Time: timers, calendars, and pauses are durable work. The architecture notes that a workflow
  fiber is not durable, and durable execution is its own document; an SLA clock would use the job
  table or the process engine, not an in-memory timer.
- Search and knowledge: ticket text is lexical search content; knowledge articles too. Results are
  candidates and the owner revalidates access.
- Notifications: through the communication outbox, with recipient resolution and snapshots, so
  "who was told, and when" is evidence.
- Gap: all of it. This is the part of the product that does not exist and is largest in volume.

**Odoo and SAP.** The parity plan lists helpdesk as a separate app in Odoo and among the line of
business clouds in SAP, and as a candidate for `extensions/` in RITSEI.

**Design hooks**

- The desk agent works through 60 tickets an hour. Which controls are on the keyboard, and which
  are never one keystroke away?
- The SLA clock is the one thing everyone watches. Is it a bar, a number, a color, or a sentence?
- The same ticket is read by a requester, an agent, a manager, and an auditor. Four views of one
  object, or four objects?

## 5. The charts side by side

| Chart                  | People         | Legal entities | Sites     | Scopes in play             | Approval depth       | Ticket kinds that appear                                |
| ---------------------- | -------------- | -------------- | --------- | -------------------------- | -------------------- | ------------------------------------------------------- |
| C1 Four-person company | 4              | 1              | 0         | `[T]`                      | 1                    | access, device, purchase, incident                      |
| C2 Startup             | 25             | 1              | 1         | `[T]` `[DEP]`              | 1 to 2               | adds customer incident, production access               |
| C3 Trading SME         | 120            | 1              | 3         | `[T]` `[WH]` `[DEP]`       | 2                    | adds document approvals, disputes, stock exceptions     |
| C4 Multi-branch retail | 600            | 1              | 46        | `[BR]` `[SUB]` `[WH]`      | 2 to 3               | adds branch incidents, transfers, cash differences      |
| C5 Manufacturer        | 900            | 1              | 3         | `[BR]` `[WH]` `[CC]`       | 2, two functions     | adds quality hold, maintenance, recipe change, safety   |
| C6 Software company    | 400            | 1              | 2         | `[T]` queue grants         | 2 to 3               | adds problem, change, major incident, compliance        |
| C7 Services firm       | 350            | 1              | 3         | `[PRJ]` `[CC]`             | 2 by project         | adds change order, staffing, expense                    |
| C8 Holding             | 1,500          | 5              | many      | `[LE]` many grants         | 3                    | adds intercompany, group policy                         |
| C9 Conglomerate        | 8,000          | 18             | hundreds  | `[LE]` `[SUB]` `[CC]`      | 4                    | adds investment, audit finding, SSC requests            |
| C10 Regional group     | 5,000          | 6              | dozens    | `[LE]` per country         | 3, by currency       | adds tax, localization incident, language               |
| C11 Global matrix      | 60,000         | 100+           | thousands | function x line x country  | 4+, resolved by rule | adds works council, breach, capex                       |
| C12 Franchise network  | 300 + partners | 1 to many      | 1,200     | `[REC]` `[BR]`, partner    | 2                    | adds royalty dispute, warranty claim, automated tickets |
| C13 Listed company     | 12,000         | 20+            | many      | `[LE]` `[REC]`, restricted | 3, with SoD          | adds audit finding, whistleblower, time-boxed access    |
| C14 Ticket operation   | 500            | n/a            | 3 desks   | queues, vendors, time      | n/a                  | the whole life of a ticket and its clock                |

What RITSEI has against that table, today:

| Need                                                     | Today                                                                                           |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Tenant, legal entity, branch, warehouse scope            | Yes ([scope contract](../architecture/architecture-spec-v4.md#scope-and-user-account-contract)) |
| Department, cost center, project, record, subtree grants | Named in the model; the hierarchy design is a reference                                         |
| One role plus scoped grants                              | Yes, and role variants are forbidden                                                            |
| Threshold approval per subject, SoD on self-approval     | Yes (`framework/modules/approvals`)                                                             |
| Multi-step and resolved approvers, delegation            | Open (D10)                                                                                      |
| Several legal entities per tenant                        | Yes; a group above them is deferred (ADR-0021)                                                  |
| Intercompany                                             | Later (D11); consolidation is not planned                                                       |
| Customers and partners as non-employee requesters        | Party roles exist; a portal does not                                                            |
| Employee as a party role                                 | Yes; HR core is an extension, payroll is out of the flagship                                    |
| Notifications as evidence                                | Yes (communication outbox and timeline projection)                                              |
| Durable timers and SLA clocks                            | Not built; the process engine and durable execution are the homes                               |
| A ticket object                                          | No. Helpdesk is a candidate for `extensions/`                                                   |

## 6. Prompts for brainstorming

Use these with one chart open, or with two side by side.

1. **Home screen.** For each role in the chart, what is the first thing they must see when they
   open the application? Is it the same list for the CEO and the Senior Engineer, filtered, or a
   different screen?
2. **Where am I acting.** Which scope is active (entity, branch, project, queue)? How is it shown
   so that nobody posts to the wrong place? Compare C4, C9, and C11.
3. **Whose is it.** For one ticket, list everyone who may see it, change it, approve it, and who
   must not see it. Do this for an HR ticket in C3, C13, and C14.
4. **Who is next.** Draw the approval chain of C3, C9, and C11 as one component. What does it have
   to show at 1 step and at 4 steps?
5. **Switching.** How does a person with several grants, or several bosses, move between them?
6. **Outsiders.** In C12 and C6 the requester is not an employee. Does the same list work, or does
   the outsider get a different, smaller product?
7. **Time.** Draw one SLA clock in C14. Then draw the same ticket for a requester who only wants to
   know "when will it be done?"
8. **Rare and heavy.** The board in C9 and C13 acts a few times a year on very large decisions.
   Design the screen for someone who will not remember how it works.
9. **Volume.** C4 has 40 branches raising the same incident. C14 has 60 tickets an hour per agent.
   What changes in the list, the filters, and the bulk actions?
10. **Language and place.** In C10 and C11 one ticket is read in three languages and across
    timezones. What is translated, what keeps the author's words, and how is local time shown?
11. **Walk one ticket.** Take "give an engineer access to production" through C1, C6, C9, and C13.
    Count the people, the approvals, and the records it leaves behind. Where does it become too
    heavy, and where too light?

## 7. Gaps these charts expose

These are not decisions. Each names the place the question already lives.

| Gap                                                       | Where it lives                                                                                         | Charts that need it        |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------- |
| A ticket object, queues, SLA, problem and change links    | A new extension; helpdesk is a candidate in the [parity plan](../proposals/erp-module-parity-plan.md)  | C1 to C14                  |
| Multi-step approvals, approver resolution, delegation     | Parity plan D10                                                                                        | C2, C3, C5, C8 to C13      |
| A level above legal entity (group, business unit, region) | [ADR-0021](../decisions/0021-define-p0-scope-and-identity-model.md) deferral; hierarchy subtree grants | C4, C8, C9, C11            |
| Several scope dimensions on one person (matrix)           | [Authorization](../architecture/authorization.md#scope): one scope per grant                           | C11                        |
| Intercompany tickets and documents                        | Parity plan D11                                                                                        | C8, C9, C10                |
| Non-employee users and a partner surface                  | Party roles and service principals; no portal                                                          | C6, C12, C14               |
| Durable timers, on-call, business calendars               | [Durable execution](../architecture/durable-execution.md), Process Studio                              | C6, C13, C14               |
| Restricted visibility for sensitive tickets               | Object-level authorization through the relationship layer                                              | C13                        |
| Localizations beyond Indonesia                            | One module per country, outside the primitive core                                                     | C10, C11                   |
| Manufacturing, quality, maintenance, projects, HR         | Later modules or extensions, evidence-gated                                                            | C5, C7 and every HR ticket |

Before any of these turns into a module, it needs a named user who needs it, which is the rule in
[`AGENTS.md`](../../AGENTS.md#framework-and-erp): extract, do not speculate. These charts are for
choosing which named user to ask first.
