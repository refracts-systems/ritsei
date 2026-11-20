# ADR-0124: Adopt Alchemy Domain as a Framework Primitive in Phases

- Status: Accepted
- Date: 2026-11-21
- Amends: ADR-0091 (point 6, for the sagas and policies of the phases this ADR activates),
  ADR-0093 (decision 4, for the Alchemy Domain runtime on Effect Cluster: the owner's risk
  acceptance replaces a named workload and measurement)
- Compatible with: ADR-0015, ADR-0123
- Supersedes: None
- Superseded by: None
- Changes: `AGENTS.md`, `docs/documentation-boundaries.md`, `docs/roadmap/README.md`,
  `erp/modules/sales/RULES.md`

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Adoption roadmap: [`../roadmap/alchemy-domain.md`](../roadmap/alchemy-domain.md)
> - Phase review documents: [`../proposals/alchemy-domain/README.md`](../proposals/alchemy-domain/README.md)
> - State and consistency: [`../architecture/state-and-consistency.md`](../architecture/state-and-consistency.md)
> - Durable execution: [`../architecture/durable-execution.md`](../architecture/durable-execution.md)
> - Target runtime: [`../architecture/target/runtime-architecture.md`](../architecture/target/runtime-architecture.md)
> - Sales rules: [`../../erp/modules/sales/RULES.md`](../../erp/modules/sales/RULES.md)
> - Alchemy Domain (external): <https://alchemy.run/domain/>

## Context

Alchemy publishes `@alchemy.run/domain`, a TypeScript and Effect library for domain-driven design.
A `Domain.Model` is one bounded context. Aggregates handle one command at a time per instance; a
pure `decide` turns a command into events or a typed rejection and `evolve` applies them; views and
projections are built from the events; policies react to events with at-least-once delivery, so a
policy must be safe to run twice; sagas are durable Effect workflows with compensation; a receipt is
stored per command id so a retry with the same id returns it; stories state rules as given/when/then
over the real model in memory. The model runs in memory for tests and on Cloudflare (Durable
Objects), Rivet (SQLite per actor), or Effect Cluster (PostgreSQL).

The evaluation read the documentation (overview, "What is DDD", Model, Command, Event, Aggregate,
View, Projection, Stream, Policy, Saga, External System, Api, Story, Query, Backfill, and the Effect
Cluster and Rivet hosts), the npm registry entry, and the installed package source. On 2026-11-21
the package had no stable release: its first version was published on 2026-10-21, `latest` is
`2.0.0-beta.87` (2026-11-12), four betas shipped in three weeks, and its `effect` peer range moved
from `^4.0.5` (beta.84) to `^4.1.4`. It requires the `alchemy` and `foldkit` packages as peers.
RITSEI pins `effect` to `4.0.0`. Production use was not verified.

RITSEI already holds much of the vocabulary: a module is a bounded context behind `mod.ts`, tagged
errors are the typed rejections, `RULES.md` plus named tests are the executable rules, an
idempotency key per command plays the receipt's role, and the outbox delivers events. The sections
below record what the evaluation found, including the evidence against adoption, because the owner
accepted those costs knowingly rather than because they were resolved.

### Costs the evaluation found

- **No transaction spans two aggregates.** A commit is atomic per aggregate instance, and multi-step
  work is a saga whose steps commit alone and are compensated after a failure. RITSEI keeps
  multi-record invariants in one PostgreSQL transaction: a delivery and its stock issue commit
  together or not at all (`SAL-DLV-2`), and the credit check locks the customer before reading
  exposure (`SAL-CREDIT-2`). Of the 66 rules in the seven module `RULES.md` files, 29 touch more
  than one aggregate and 9 of those change business meaning under sagas, all on the money and stock
  path ("What Adoption Changes" below). Widening one aggregate to cover two modules would move
  ownership across them (ADR-0015).
- **The runtime was an inactive design.** Hosting aggregates in a stateful runtime is what ADR-0093
  keeps inactive until a named user or workload and measurements justify it. This ADR amends that
  for Alchemy Domain on the owner's risk acceptance; no workload measurement exists.
- **Moving authority is a migration, not a library choice.** Moving an aggregate to an event stream
  needs a cutover of its existing rows and open documents, with no fact held by two authorities at
  any time. The documentation shows projections into application-owned SQL tables but no cutover.
- **Cost and ownership.** Policies, sagas, and APIs overlap the outbox and messaging, the deferred
  process engine, and the capability model. Each one adopted needs an owner for retries,
  authorization, and recovery.

### The Effect Cluster host, from its source

The installed `@alchemy.run/domain/EffectCluster` host (`layerEntities`) was read to see how it uses
PostgreSQL:

- It opens its **own connection pool** from `CLUSTER_DATABASE_URL` and runs each instance's commit
  in a transaction on that pool. A command therefore cannot share a transaction with RITSEI's
  tables; every class D lag in this ADR is real on this host.
- It keeps every instance's state as **JSON text in one key-value table**,
  `alchemy_domain_objects (object, key, value)`. PostgreSQL constraints, foreign keys, row-level
  security, and typed columns do not apply to aggregate state; tenant scope and integrity become
  application checks inside `decide`, and relational tables cannot reference a stream-held aggregate
  with a foreign key.
- It **creates that table at runtime** with `CREATE TABLE IF NOT EXISTS`, outside RITSEI's migration
  flow and `db/ownership.toml`.

These are gates for the foundation phase, not reasons recorded against adoption.

### What is narrower than it first appeared

- **Read lag applies to read paths, not to decisions.** Aggregate state is readable at the last
  commit. The 10-second `ConsistencyTimeout` applies when a query waits for declared consumers
  (`waitsFor`) with an `atLeast` receipt. The objection stands for credit and stock checks, which
  must be correct when the command is decided; reports that may lag have different needs.
- **History at scale is an operational risk, not a missing feature.** Backfill is documented for
  Effect Cluster and Rivet (it starts on the first call after a deploy) as well as Cloudflare, where
  each Durable Object holds about 10 GB. The documentation states no snapshotting, compaction, or
  retention rule, and event evolution is limited to optional fields and new event types; no
  upcasting mechanism was found. For a ten-year horizon the questions are whether old history still
  decodes, how long one tenant takes to rebuild, and when the rebuilt result is safe to read.

### Pilot: `SAL-DLV-2` on Alchemy

A throwaway pilot outside the repository (`@alchemy.run/domain` 2.0.0-beta.87, `effect` 4.1.4,
in-memory host) modelled the delivery with three aggregates (`SalesOrder`, `StockItem` at moving
average, `Delivery`), a saga with a compensation per step, and a projection for the COGS journal,
in two step orders: A records the delivery on the order and then issues stock; B issues stock and
then records the delivery. Nine stories pass, and stories with a wrong amount fail.

Observed in stories, for a delivery that fails on its second stockable line:

| | RITSEI (rollback) | Variant A | Variant B |
|---|---|---|---|
| Events left | 0 | 6 on 3 streams | 4 on 2 streams |
| Journal rows left | 0 | 2 (issue and return) | 2 (issue and return) |
| Order records then reverses a delivery | no | yes | no |
| Over-delivery refused | before stock moves | before stock moves | after stock is issued and returned |

Inferred from the commit order, not executed (a story settles each command before the next): a
delivery takes 3 + N commits for N stockable lines instead of one; the journal equals the stock
movement only after the projection catches up; in variant A, Billing (`BIL-INV-1`) could bill a
delivered quantity that is later reversed, which variant B avoids. Tenant, authorization, `DO/`
numbering, exact amounts, product lookup, and concurrent sagas were not modelled.

The pilot shows the rule is buildable. What every variant keeps is the loss of one transaction: a
delivery that fails leaves reversal facts in stock and the journal instead of nothing.

### How SAP and Odoo record a reversed goods issue

Both keep reversals as new documents, never deletions. SAP reverses a delivery's goods issue with a
cancellation document that takes the original quantities and valuation, posts the opposite stock
movement (602 for 601), and links into the delivery's document flow; goods issue and its reversal
apply to the whole delivery ([SAP Help: Goods Issue Reversal][sap-gi-reversal]). Odoo returns a
validated delivery through a reverse transfer and a credit note once an invoice exists
([Odoo: Returns and refunds][odoo-returns]); posted entries in a restricted journal are hash-chained
and cannot be edited ([Odoo: Data inalterability check report][odoo-inalterability]).

Those trails record a business event that did happen: goods left and came back, or a posted
movement was wrong. In SAP the goods issue posts for the whole delivery, so a goods issue that
fails leaves no movement to reverse. Odoo validates a transfer as one operation; that it leaves
nothing behind on failure was not verified in its documentation. A saga compensation records an issue and a
return for a delivery that failed before it completed. An auditor can follow such a trail, since it
is linked and immutable, but it records a failure as two movements, and when a period closes
between the issue and the return, the two land in different periods. The views below weigh that.

[sap-gi-reversal]: https://help.sap.com/saphelp_46C/helpdata/EN/dd/560af5545a11d1a7020000e829fd11/content.htm
[odoo-returns]: https://www.odoo.com/documentation/master/applications/sales/sales/products_prices/returns.html
[odoo-inalterability]: https://www.odoo.com/documentation/19.0/applications/finance/accounting/reporting/data_inalterability.html

### Should a failed delivery leave an issue-and-return trail?

The sources above do not answer this case directly. The views below are reasoning, not cited
evidence, and all of them answer no while the steps live in one database. The owner accepted this
as a risk (Decision 7); phases 4 and 5 turn each view into an exit gate or a stop condition:

- **Auditor.** The ledger records economic events. A delivery that fails before completing is not
  one: the goods never left. A linked, immutable trail can be followed, but the auditor must then
  tell a real return from a system failure, and a period close between issue and return misstates
  inventory and COGS in the first period until the return posts.
- **Accountant.** Period cut-off and matching suffer for the same reason: COGS can be recognized in
  a period for goods that never shipped. The inventory subledger and the general ledger agree only
  after the projection catches up, so a reconciliation run in between shows a difference that is
  not an error. COGS account analysis carries pairs of entries that net to zero. Where revenue
  follows delivery, as with Billing's `BIL-INV-1`, a delivery that is recorded and then reversed
  (variant A) can reach an invoice before it is reversed.
- **Systems engineering.** A technical failure calls for a technical rollback, not extra business
  transactions. Compensation is the tool for a step that cannot be undone, such as a call to an
  external system. When every step writes to one PostgreSQL database, atomicity is already
  available; splitting the commit and repairing it with compensations adds failure modes to a
  solved problem.
- **ERP engine development.** SAP posts the goods issue for the whole delivery or not at all, and
  keeps reversal for corrections after a successful posting. Engines separate the two on purpose:
  technical failures stay out of business documents.
- **Warehouse operations.** While a saga holds stock it issued for a delivery that may still fail,
  that stock is unavailable to other orders, which can be refused with `StockUnavailable` for stock
  that comes back moments later. In variant B every refused over-delivery does this.

The answer turns to yes when the steps are separate in the physical world: a third-party warehouse
that confirms the goods issue on its own system, or a carrier that can bring goods back. There the
goods really can leave and return, and a reversal trail records what happened. RITSEI has no such
step today.

### What the spike found

A spike on Sales order confirmation and cancellation found that the lifecycle decision (which
states may transition, same-key retry returns the recorded result, a different key conflicts,
cancelling a cancelled order is a no-op) was written twice, in `memory.ts` and `postgres.ts`. It
also found two differences the rules did not state:

- A confirmation key already used by another order in the tenant failed with
  `EventIdempotencyConflict` in the memory store, from Messaging, but with
  `SalesOrderConfirmationIdempotencyConflict` in PostgreSQL, from the
  `orders_tenant_confirmation_idempotency_key` constraint. The difference predates the spike.
- Confirming with key K, cancelling, and confirming again with K fails with `SalesOrderInvalidState`.
  An Alchemy receipt would return the original confirmation instead.

## What Adoption Changes

Adopting Alchemy is not a library swap. Where a rule spans more than one aggregate, it changes
three layers at once: what a bounded context owns and guarantees, how a business flow runs and
fails, and what the business sees and must approve. Where a rule fits one aggregate, little
changes. This section states which rules fall where and what each layer change means.

The classification reads the text of each rule in the seven module `RULES.md` files (66 rules) and
asks how it would be modelled with per-aggregate commits. It is reasoning over rule text, checked by
implementation only for `SAL-DLV-1` and `SAL-DLV-2` (the pilot). Modules without a `RULES.md`
(Party, Product, Documents, Communication, Onboarding, Localization, Process) are not classified.

### Summary

| Class | Meaning on Alchemy | Rules |
|---|---|---|
| A. Fits one aggregate | Same rule; validation, authorization, a read of stable reference data, or a state machine inside one instance | 34 |
| B. Simpler | The rule exists to commit an event with its state; Alchemy does this by construction | 3 |
| C. Cross-aggregate, easy | A derived id, a uniqueness claim aggregate, or a policy whose delay harms nothing | 9 |
| D. Cross-aggregate, medium | Becomes several commits with the same business facts, plus a lag or a new legitimate state | 11 |
| E. Cross-aggregate, heavy | Becomes several commits whose failure or interleaving changes the business facts | 9 |

29 rules (C + D + E) touch more than one aggregate today. The 9 heavy rules sit in Sales (3),
Billing (3), Settlement (1), Procurement (1), and Inventory (1). Tax has none outside class A, and
Accounting has none in class E.

### Layer 1: the nature of a bounded context

- **The consistency boundary shrinks from a transaction to an aggregate.** Today a command can keep
  an invariant across modules in one PostgreSQL transaction through public contracts: Process
  delivers through Sales and Inventory (`SAL-DLV-2`), Procurement receives through Inventory
  (`PRC-RCPT-1`, `PRC-VRCPT-1`), Inventory and Billing post through Accounting (`INV-VAL-2`,
  `BIL-DOC-1`). On Alchemy an invariant holds only inside one aggregate instance; anything wider is
  a saga or a policy.
- **Ownership moves to new aggregates.** Several invariants that today read another module's rows
  under a lock need an aggregate of their own, owned by one module:
  - Billing: an invoiced-quantity tracker per sales order (`BIL-INV-1`) and a billed-quantity
    tracker per purchase order (`BIL-BILL-1`), fed by delivery and receipt events instead of
    reading Sales and Procurement under a lock.
  - Sales: a credit exposure aggregate per customer that holds reservations for confirmed orders
    and receives receivables from Billing as events (`SAL-CREDIT-1`, `SAL-CREDIT-2`).
  - A numbering sequence per legal entity and document kind (`BIL-DOC-1` for `INV/`, `CN/`,
    `BILL/`, `DN/`; `SAL-DLV-1` for `DO/`; `PRC-VRCPT-1` for `GR/`; `PRC-RET-1` for `RET/`).
  - Settlement: a match capacity per statement line and per payment (`SET-BANK-3`).
  - Uniqueness claims: customer email per tenant (`SAL-CUST-1`), price list name per tenant
    (`SAL-PRICE-1`), one Supplier Account per relationship (`PRC-SUP-1`).
- **Reports become projections.** The general ledger, the valuation report (`INV-VAL-1`), open items
  and aging (`BIL-OPEN-1`), and the migration-clearing balance (`ACC-OPEN-3`) are folded from events
  after they commit, so each answers "as of the last event it applied", not "as of now".
- **Process becomes the saga layer.** Cross-module flows that Process runs as one transaction today
  become sagas and policies. That activates the process engine that `AGENTS.md` defers until
  Order-to-Cash and Procure-to-Pay run end to end.

### Layer 2: the flow

- **One synchronous step becomes a staged process.** A delivery takes 3 + N commits for N stockable
  lines (pilot). New states must be stored, shown, and supported: a delivery requested but not
  completed, a transfer confirmed on some lines (`INV-XFER-1`), a return recorded but not issued
  (`PRC-RET-1`), a payment received but not allocated (`SET-WHT-1`), a credit reservation held for
  an order.
- **Failure stops being "nothing happened".** A rollback becomes compensation commands that record
  reversal facts: in the pilot, 4 to 6 events and 2 journal rows for a delivery that failed
  (variant B and A). Compensations must never refuse, and a period may close between a step and
  its compensation.
- **Step order becomes a business decision.** The pilot's variant A records the delivery first and
  lets Billing see quantity that may be reversed; variant B issues stock first and moves stock for
  refused over-deliveries. Every multi-step flow has the same choice.
- **Reads lag their writes.** A read that must see a write waits on a receipt (`atLeast`), failing
  after 10 seconds when a query waits on its projections. Checks taken at decision time (credit,
  stock, billable quantity) must read aggregate state, not a projection.
- **Idempotency changes meaning.** Alchemy returns the stored receipt for a repeated command id even
  after later commands; `SAL-ORDER-2` returns the recorded result only while the order is still
  confirmed. Each rule's retry contract must be restated.
- **Concurrency changes shape.** Two confirmations that each fit a customer's limit but not together
  (`SAL-CREDIT-2`), two invoices for the same deliveries (`BIL-INV-1`), and two matches against one
  statement line (`SET-BANK-3`) are serialized today by a row lock across modules. On Alchemy each
  needs the invariant inside one aggregate, or a reservation step with its own failure path.

### Layer 3: the business

- **Accounting and audit.** Failed flows leave reversal entries for events that did not happen
  economically; cut-off and matching suffer when a period closes between a step and its
  compensation; subledger-to-ledger reconciliation shows differences until projections catch up;
  `ACC-OPEN-3` sign-off must wait for the ledger projection. Gapless numbering (`BIL-DOC-1`) becomes
  gapless with voided numbers when a step fails after allocation.
- **Credit control and receivables.** Exposure arrives from Billing as events, so a customer can be
  confirmed past the limit in the lag unless exposure moves into a reservation aggregate
  (`SAL-CREDIT-1`, `SAL-CREDIT-2`). Receipts can sit unallocated when allocation fails
  (`SET-WHT-1`), which is a known receivables state but a new one for RITSEI.
- **Payables.** Bill matching (`BIL-BILL-1`) depends on received and returned quantities that arrive
  as events; a bill entered right after a receipt may be refused until the tracker catches up.
- **Warehouse.** Stock held by a saga that may still fail is unavailable to other orders and can
  cause false `StockUnavailable` refusals; a transfer can be visible half applied (`INV-XFER-1`); a
  return to supplier can fail after it is recorded when the stock was consumed (`PRC-RET-1`).
- **Sales and customer service.** A delivery or order shows intermediate states and, on failure,
  reversed records; staff need to know what "requested" and "failed" mean for a customer.
- **Treasury and bank reconciliation.** Two people matching the same line or payment can both pass
  a check and one is compensated, unless match capacity is one aggregate (`SET-BANK-3`).
- **Approvals and policy.** Rules whose meaning changes need sign-off from their business owner, not
  only code review: the 9 class E rules below at least.
- **Operations.** History is kept for good; changing a view or projection triggers a backfill over
  that history, and old events must keep decoding for as long as the system runs.

### What does not change

The 34 class A rules keep their meaning: authorization (`*-AUTH-1`), tax calculation and rate
periods (`TAX-*`), immutable snapshots and derived totals (`PRC-PO-1`, `PRC-PO-2`), state machines
inside one document (`SAL-ORDER-1`, `SAL-QUOT-2`), statement import validation (`SET-BANK-1`), and
append-only stock and journals (`INV-STOCK-2`, `ACC-OPEN-4`), which match Alchemy's model natively.
Three rules get simpler (class B). Contexts with no cross-aggregate rule, such as Tax, could adopt
the model with little change in meaning; the cost there is the runtime and the dependency, not the
business.

### Rule-by-rule classification

| Rule | Class | What changes on Alchemy |
|---|---|---|
| `ACC-OPEN-1` | C | Journal id derived from the legal entity |
| `ACC-OPEN-2` | A | Validation inside the journal |
| `ACC-OPEN-3` | D | Sign-off reads a projected balance; must wait for catch-up |
| `ACC-OPEN-4` | A | Append-only, native |
| `BIL-RENDER-1` | A | Not active; unaffected |
| `BIL-RENDER-2` | A | Artifact integrity inside one artifact |
| `BIL-DOC-1` | E | Number, tax, and journal no longer commit together; failed steps leave voided numbers |
| `BIL-INV-1` | E | Billing owns an invoiced-quantity tracker fed by delivery events; ownership moves |
| `BIL-SET-1` | A | Open amount guarded inside the document |
| `BIL-OPEN-1` | D | Open items and aging become projections that lag the control account |
| `BIL-BILL-1` | E | Billing owns a billed-quantity tracker fed by receipt and return events |
| `BIL-BILL-2` | A | Reads a decided approval, which is final |
| `BIL-BILL-3` | D | Journal posted from bill events; ledger lags the bill |
| `BIL-CREDIT-1` | D | Credit cap inside the credited document; re-billable quantity reaches Procurement as an event |
| `INV-STOCK-1` | A | Receive and reserve inside one stock item |
| `INV-STOCK-2` | A | Append-only, native |
| `INV-STOCK-3` | B | Correction and its event commit together by construction |
| `INV-STOCK-4` | A | Inside one stock item |
| `INV-STOCK-5` | A | Validation against warehouse reference data |
| `INV-XFER-1` | E | All-or-nothing over many items becomes a saga; a transfer can be half applied, then compensated |
| `INV-AUTH-1` | A | Authorization |
| `INV-VAL-1` | D | Valuation exact per item; "inventory account equals valuation report" holds only after catch-up |
| `INV-VAL-2` | D | Movement and journal commit separately; journal lags stock |
| `INV-VAL-3` | A | Inside one stock item |
| `INV-OPEN-1` | A | Authorization |
| `INV-OPEN-2` | A | Validation of the load |
| `INV-OPEN-3` | A | Reads a decided approval |
| `INV-OPEN-4` | C | Load id derived from `openingId` |
| `INV-OPEN-5` | D | Load and journal commit separately; a failed load leaves a reversal journal |
| `PRC-PO-1` | A | Immutable snapshot inside the order |
| `PRC-PO-2` | A | Derived inside the order |
| `PRC-PO-3` | B | Confirmation and its event commit together by construction |
| `PRC-PO-4` | A | Tenant scope |
| `PRC-SUP-1` | C | One Supplier Account per relationship through a claim aggregate |
| `PRC-AUTH-1` | A | Authorization |
| `PRC-READ-1` | C | Replica wait becomes a receipt wait (`atLeast`) |
| `PRC-RCPT-1` | D | Receipt then stock receive; a receive cannot be refused, so only lag |
| `PRC-DOC-1` | A | Inside the order |
| `PRC-PRICE-1` | A | Keyed by supplier account and product |
| `PRC-DRAFT-1` | C | Approval request submitted by a policy; release still requires it |
| `PRC-REL-1` | A | Reads a decided approval |
| `PRC-VRCPT-1` | D | Receipt, `GR/` number, stock, and GRNI journal commit separately |
| `PRC-RET-1` | E | Return recorded, then stock issue can fail if the stock was consumed; compensation needed |
| `SAL-ORDER-1` | A | State machine inside the order |
| `SAL-ORDER-2` | B | Confirmation and its event commit together; retry contract to restate |
| `SAL-ORDER-3` | A | References checked against immutable quotation and customer data |
| `SAL-CUST-1` | C | Email uniqueness through a claim aggregate |
| `SAL-AUTH-1` | A | Authorization |
| `SAL-CREDIT-1` | E | Exposure from Billing arrives as events; a reservation aggregate or a lag window |
| `SAL-CREDIT-2` | E | Serialization by customer lock moves into that aggregate |
| `SAL-CUST-2` | A | Reads the Party relationship at creation |
| `SAL-PRICE-1` | C | Price list name uniqueness through a claim aggregate |
| `SAL-QUOT-1` | A | Prices read at drafting |
| `SAL-QUOT-2` | A | State machine inside the quotation |
| `SAL-QUOT-3` | C | Order id derived from the quotation |
| `SAL-DLV-1` | D | Cumulative guard inside the order (piloted); `DO/` number from a sequence aggregate |
| `SAL-DLV-2` | E | Piloted: 3 + N commits; a failure leaves reversal facts in stock and the journal |
| `SET-BANK-1` | A | Validation of one file |
| `SET-BANK-2` | C | Statement id derived from its checksum |
| `SET-BANK-3` | E | Capacity on both the line and the payment; needs one aggregate or a reservation saga |
| `SET-WHT-1` | D | Payment, allocation, and journal commit separately; a payment can sit unallocated |
| `TAX-CALC-1` | A | Calculation |
| `TAX-CALC-2` | A | Validation |
| `TAX-RATE-1` | A | Periods inside one tax code |
| `TAX-AUTH-1` | A | Authorization |
| `TAX-PROD-1` | A | Reads code direction, which does not change |

### Where Alchemy is the better fit

By rule, only class B is better on Alchemy: `SAL-ORDER-2`, `PRC-PO-3`, and `INV-STOCK-3` exist to
commit an event with its state, which RITSEI does with an outbox append in the same transaction and
Alchemy does by construction. Class A and C are equal: append-only history and derived ids are
native to Alchemy, but PostgreSQL triggers and unique indexes already hold them. Classes D and E
are worse.

Three benefits are not tied to a rule class:

- **Stories**: given/when/then tests that fail on any event, rejection, or external call they do not
  assert. `RULES.md` identifiers with named tests cover part of this today.
- **Replayable history**: new views and projections are built from past events.
- **Live views**: `watch` pushes view changes to clients over WebSocket. The RITSEI frontend
  invalidates queries after a mutation instead; it has no live read today.

## Alchemy Beyond the Domain Package

Alchemy's main product is not the Domain package but "Infrastructure as Effects": a TypeScript and
Effect program declares an application's infrastructure and code together and deploys them. On
2026-11-21 the `alchemy` package was `2.0.0-beta.87`, with the same Effect 4.1 requirement as the
Domain package. The survey read the homepage, getting started, "What is Alchemy", state store,
test harness, and secrets pages, and the `llms.txt` index; the Docker, GitHub, Workflows, CLI,
Neon, and Prisma pages were known only from the index.

| Feature | What it does | Fit for RITSEI |
|---|---|---|
| Infrastructure as code | Stacks, resources, and providers with plan, deploy, drift, destroy, and adopt, for AWS, GCP, Cloudflare, Fly, Hetzner, Railway, Docker, and Kubernetes | The strongest candidate. It serves deployment and staging tooling, not domain code, so no business rule changes. RITSEI does not lock operators into one topology (`docs/deployment/README.md`), so it fits environments the project runs itself, not a requirement of the product |
| PostgreSQL state store | `postgresState()` keeps infrastructure state in PostgreSQL with an advisory lock per stack and stage | Consistent with PostgreSQL as the only stateful dependency |
| Managed PostgreSQL resources | Neon and PlanetScale with branches, RDS, Cloud SQL, Railway, and others | A database branch per pull request for preview environments. Support for PostgreSQL 19, which RITSEI requires, was not checked |
| Test harness (`@alchemy.run/test`) | Tests against a deployed stack, or local emulators | Useful for end-to-end deployment tests, not for domain tests |
| Durable workflow engines | Run `effect/workflow` on Durable Objects or Effect Cluster | `effect/workflow` belongs to Effect, not Alchemy; Alchemy supplies engines. Domain sagas run on the Effect Cluster engine, while `durable-execution.md` names `pg_durable` as the workflow candidate and a job layer until then. This conflict is open; phase 4 resolves it before the first saga reaches production |
| Secrets and configuration | `Config.Redacted`, Doppler, Infisical, secret stores | `Config.Redacted` is Effect's and usable without Alchemy; the providers help deployment only |
| Telemetry | Built-in OpenTelemetry | Effect's; usable without Alchemy |

Beyond the Domain package, infrastructure as code for deployment and preview environments is the
Alchemy feature with the least risk to the ERP: it touches none of the 66 rules. It is a separate
decision with its own ADR.

## Decision

The owner accepts the costs above on 2026-11-21, judging the benefits greater: stories as
executable rules, replayable history, live views, commands that carry their events by construction,
and one model shape that can become a framework primitive.

1. **Adopt `@alchemy.run/domain` as a framework primitive.** It enters through `framework/`, behind
   an engine-neutral port, and lands only together with its first ERP consumer (ADR-0091, "extract,
   don't speculate").
2. **Host it on Effect Cluster over PostgreSQL.** PostgreSQL remains the only stateful dependency.
   Cloudflare and Rivet hosts are not used.
3. **Adopt it in phases, one rule class at a time.** Phase 0 builds the foundation; phases 1 to 5
   take classes A, B, C, D, and E of "What Adoption Changes". Sequencing, gates, and stop conditions
   are owned by the [`alchemy` roadmap track](../roadmap/alchemy-domain.md).
4. **Review each phase on its own.** Each phase has a review document under
   [`docs/proposals/alchemy-domain/`](../proposals/alchemy-domain/README.md) that states its scope,
   the aggregates it may move, its exit evidence, and the auditor, accountant, systems engineering,
   ERP engine development, and warehouse operations views. A phase starts only after the owner
   accepts its document, and the next phase's document is reviewed only after the previous phase's
   exit evidence is accepted.
5. **Authority moves by aggregate, not by rule.** An aggregate keeps its PostgreSQL tables as its
   authority until every rule it carries belongs to an accepted phase and its cutover is rehearsed.
   Until then a phase may model the aggregate with `decide` and `evolve` and run stories in memory,
   but production reads and writes stay on the tables. No fact has two authorities at any time.
6. **Current rules stay current until a phase changes them.** Owner documents, `RULES.md` files,
   and `state-and-consistency.md` keep describing the code as it runs. A phase that moves an
   aggregate updates them in the same change, as ADR-0123 requires.
7. **The negative findings become gates, not footnotes.** The five views on failed-flow reversal
   trails (all answering no for single-database steps) are accepted risks that phases 4 and 5 must
   answer with an exit gate or a stop condition, as must the host findings in phase 0.
8. **Keep the pure decide refactor of Sales.** `erp/modules/sales/src/order-lifecycle.ts` decides
   order confirmation and cancellation for both stores, the memory store rejects a key another order
   in the tenant used as PostgreSQL does, and `SAL-ORDER-2` states that a key returns the recorded
   result only while the order is confirmed. These functions are the first `decide` handlers phase 2
   builds on.

## Alternatives Considered

- **Borrow pure decide functions only, without the library.** This ADR's earlier proposal. Rejected
  by the owner: it keeps the PostgreSQL model but forgoes stories, replayable history, live views,
  and a shared model shape.
- **Adopt Alchemy everywhere at once.** Rejected: it moves 29 cross-aggregate rules and the ledger
  in one cutover, with no rule-by-rule review.
- **Adopt Story for tests only.** Rejected as the end state: `Story.make` runs a whole
  `Domain.Model`, so a test-only model would have to be kept in step with the production service by
  hand. Phases 1 to 3 do use stories, against the models they build.
- **Adopt Alchemy's infrastructure as code instead of its Domain package.** Not decided here. It
  leaves the domain untouched; it is a deployment decision that needs its own ADR.
- **Host on Cloudflare or Rivet.** Rejected: each adds a stateful store beside PostgreSQL.
- **Do nothing.** Rejected by the owner.

## Consequences

### Positive

- Rules become stories that fail on any event, rejection, or external call they do not assert.
- Commands commit their events by construction; class B rules lose their outbox plumbing.
- New views and projections are built from history; live views give the frontend pushed reads.
- One model shape for every module, usable by extensions as a framework primitive.

### Negative

- A dependency with no stable release, an Effect upgrade across the repository, and peers
  (`alchemy`, `foldkit`) the ERP does not otherwise use.
- Aggregate state outside PostgreSQL's constraints and row-level security; integrity and tenant
  scope move into `decide`.
- Cross-aggregate rules become staged flows with lag, new states, and reversal facts on failure;
  nine rules change business meaning and need their owners' sign-off.
- Two persistence styles coexist for years: table-backed aggregates and stream-backed ones.

### Risks

- **Beta churn.** Breaking changes between betas. Containment: exact pins, the foundation phase's
  upgrade rehearsal, and the engine-neutral port.
- **Reversal trails auditors do not expect.** Containment: phases 4 and 5 gate each flow on the
  accounting owner's acceptance and a period-close rule; a flow that cannot meet them stays on a
  PostgreSQL transaction (a stop condition, not a failure of the track).
- **Dual authority during cutover.** Containment: decision 5 and a rehearsed cutover per aggregate.
- **History growth and decoding.** Containment: phase 0 measures rebuild time per tenant and proves
  old events decode after a schema change before any aggregate moves.
- **Hidden lag in decisions.** Containment: checks taken at decision time read aggregate state,
  never a projection.

## Ten-Year View

The durable assets of an ERP are its data model, invariants, and audit trail. Under this decision
the data lives in PostgreSQL still, but aggregate state becomes event history in JSON. History is
kept for good and re-read on every rebuild, so event schemas become a permanent contract: fields are
added as optional, and a change of meaning is a new event. Each phase therefore reviews its event
shapes as carefully as a table migration.

The strongest case for this path is a historical question asked after the data has passed, such as
which limit, exposure, and policy version approved an order two years ago. Event sourcing answers it
only for facts it recorded, so phase 5's credit flow records the decision's inputs in its events.

## Validation

- Phase 0 exit: the pilot's stories pass on the Effect Cluster host against PostgreSQL 19, the
  Effect upgrade passes the full validation list, and the host's table is created by a reviewed
  migration.
- Each phase exit: the evidence its roadmap gate names, the owner's acceptance of its review
  document, and the `RULES.md` rule-to-test links for every rule the phase changes.
- Every one of the 66 rules is assigned to exactly one phase.
- No aggregate is authoritative in both a table and a stream at any time.

## Related Documents

- [ADR-0015](./0015-one-semantic-owner-per-invariant.md)
- [ADR-0091](./0091-adopt-framework-and-flagship-erp.md)
- [ADR-0093](./0093-retain-isolation-runtime-and-analytic-target-designs.md)
- [ADR-0123](./0123-separate-the-decision-log-from-current-rules.md)
- [`../roadmap/alchemy-domain.md`](../roadmap/alchemy-domain.md)
- [`../proposals/alchemy-domain/README.md`](../proposals/alchemy-domain/README.md)
