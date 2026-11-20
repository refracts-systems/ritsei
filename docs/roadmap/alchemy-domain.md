# Alchemy Domain Adoption Roadmap

> **Status:** Canonical roadmap subdocument
>
> **Track ID:** `alchemy`
>
> **Owns:** sequencing, readiness gates, measures, and stop conditions for adopting
> `@alchemy.run/domain` as a framework primitive.
>
> **Measured by:** `alchemy.*` exit evidence, reviewed by the owner.
>
> **Detailed semantics belong to:** each module's `RULES.md`,
> [`../architecture/state-and-consistency.md`](../architecture/state-and-consistency.md), and
> [`../architecture/durable-execution.md`](../architecture/durable-execution.md). The rule
> classification is recorded in
> [ADR-0124](../decisions/0124-adopt-alchemy-domain-in-phases.md#what-adoption-changes).
>
> **Related documents**
>
> - Roadmap index: [`./README.md`](./README.md)
> - Decision: [`../decisions/0124-adopt-alchemy-domain-in-phases.md`](../decisions/0124-adopt-alchemy-domain-in-phases.md)
> - Phase review documents: [`../proposals/alchemy-domain/README.md`](../proposals/alchemy-domain/README.md)

## Scope

Adopt Alchemy Domain on Effect Cluster over PostgreSQL, one rule class at a time, so that every
module can model its aggregates with `decide` and `evolve`, state its rules as stories, and move an
aggregate's authority from tables to an event stream only when every rule it carries has been
reviewed. The track does not gate framework or ERP phases or `roadmap.global-exit`.

**Owner:** the project owner, who accepts each phase's review document and exit evidence.

## Rules of the track

- **One phase at a time.** A phase starts only after the owner accepts its review document under
  [`../proposals/alchemy-domain/`](../proposals/alchemy-domain/README.md), and the next phase's
  document is reviewed only after the previous phase's exit evidence is accepted.
- **Authority moves by aggregate.** An aggregate stays table-backed until every rule it carries
  belongs to an accepted phase and its cutover is rehearsed. Before that, a phase may model the
  aggregate and run stories in memory, but production reads and writes stay on the tables.
- **No dual authority.** At no time is one fact authoritative in both a table and a stream.
- **Owner documents follow the code.** A phase that moves an aggregate updates its `RULES.md`,
  `state-and-consistency.md`, and any other owner document in the same change.
- **Every rule in exactly one phase.** The 66 rules of the seven `RULES.md` files are assigned
  below; a new rule is classified when it is added.

## Aggregate authority

Each aggregate can move only in the phase of the highest class among the rules it carries. This
table is inferred from the rule text and is revised by each phase's review.

| Module | Aggregate | Highest class | Earliest move | Open gate |
| --- | --- | --- | --- | --- |
| Tax | Tax code with rate periods | A | Phase 1 | Products reference tax codes by foreign key (`TAX-PROD-1`) |
| Procurement | Supplier price | A | Phase 1 | None found |
| Procurement | Supplier Account | C | Phase 3 | Purchase orders reference it by foreign key |
| Sales | Price list | C | Phase 3 | Customers reference it |
| Sales | Quotation | C | Phase 3 | Conversion creates a table-backed order (`SAL-QUOT-3`) |
| Inventory | Opening stock load | D | Phase 4 | Its journal posts to a table-backed ledger |
| Sales | Customer | E | Phase 5 | Credit exposure (`SAL-CREDIT-1`, `SAL-CREDIT-2`) |
| Sales | Sales order, delivery | E | Phase 5 | `SAL-DLV-2` |
| Procurement | Purchase order, receipt, return | E | Phase 5 | `PRC-RET-1` |
| Inventory | Stock item, transfer | E | Phase 5 | `INV-XFER-1` |
| Billing | Invoice, supplier bill, credit note | E | Phase 5 | `BIL-DOC-1`, `BIL-INV-1`, `BIL-BILL-1` |
| Settlement | Bank statement, payment | E | Phase 5 | `SET-BANK-3` |
| Accounting | Journal and ledger | — | Not in this track | Ledger authority is owned by `financial-ledger.md` and needs its own ADR |

Modules without a `RULES.md` (Party, Product, Documents, Communication, Onboarding, Localization,
Process) are classified when their review needs them.

## Phases

### Foundation (`alchemy.foundation`)

Make the primitive exist and run on the real host, with no aggregate moved.

**Exit:**

- `effect` and every `@effect/*` package upgraded to the 4.1 line in its own change, passing the
  full validation list in `AGENTS.md`.
- `@alchemy.run/domain`, `alchemy`, and `foldkit` pinned exactly, with the dependency reason
  documented in the consuming manifest.
- An engine-neutral framework port with its first ERP consumer; `boundary:lint` passes.
- The host's `alchemy_domain_objects` table created by a reviewed migration, owned in
  `db/ownership.toml`, with privileges that forbid updating or deleting recorded events.
- The `SAL-DLV-2` pilot's stories pass on the Effect Cluster host against PostgreSQL 19.
- An event recorded before a schema change still decodes after it; rebuild time per tenant is
  measured on a realistic volume.

**Stop if:** the host cannot run on PostgreSQL 19, events cannot be protected from update and
deletion, or a beta upgrade breaks the port without a migration path.

### Class A (`alchemy.class-a`)

34 rules that fit one aggregate: `ACC-OPEN-2`, `ACC-OPEN-4`, `BIL-RENDER-1`, `BIL-RENDER-2`,
`BIL-SET-1`, `BIL-BILL-2`, `INV-STOCK-1`, `INV-STOCK-2`, `INV-STOCK-4`, `INV-STOCK-5`,
`INV-AUTH-1`, `INV-VAL-3`, `INV-OPEN-1`, `INV-OPEN-2`, `INV-OPEN-3`, `PRC-PO-1`, `PRC-PO-2`,
`PRC-PO-4`, `PRC-AUTH-1`, `PRC-DOC-1`, `PRC-PRICE-1`, `PRC-REL-1`, `SAL-ORDER-1`, `SAL-ORDER-3`,
`SAL-AUTH-1`, `SAL-CUST-2`, `SAL-QUOT-1`, `SAL-QUOT-2`, `SET-BANK-1`, `TAX-CALC-1`, `TAX-CALC-2`,
`TAX-RATE-1`, `TAX-AUTH-1`, `TAX-PROD-1`.

**Exit:** each rule is a story against its module's model, naming the rule `[ID]`; tax codes and
supplier prices are cut over with a rehearsed migration and parity tests between the table and
stream implementations; the other aggregates stay table-backed.

**Stop if:** a cut-over aggregate needs a foreign key from a table that command-time validation
cannot replace.

### Class B (`alchemy.class-b`)

3 rules that commit an event with its state: `SAL-ORDER-2`, `PRC-PO-3`, `INV-STOCK-3`.

**Exit:** stories for confirmation and correction idempotency, building on
`erp/modules/sales/src/order-lifecycle.ts`; a written retry contract for each rule (Alchemy returns
the stored receipt for a repeated command id; `SAL-ORDER-2` returns it only while the order is
confirmed). No authority moves: the aggregates carry class E rules.

**Stop if:** the retry contract cannot be stated without breaking an existing client.

### Class C (`alchemy.class-c`)

9 rules made with a derived id, a uniqueness claim, or a harmless policy: `ACC-OPEN-1`,
`INV-OPEN-4`, `PRC-SUP-1`, `PRC-READ-1`, `PRC-DRAFT-1`, `SAL-CUST-1`, `SAL-PRICE-1`, `SAL-QUOT-3`,
`SET-BANK-2`.

**Exit:** claim aggregates for customer email, price list name, and Supplier Account; stories for
each rule; price lists, quotations, and Supplier Accounts cut over where their open gates close.

**Stop if:** a uniqueness claim can be left held by a failed command with no release path.

### Class D (`alchemy.class-d`)

11 rules that become staged flows with the same facts plus a lag or a new state: `ACC-OPEN-3`,
`BIL-OPEN-1`, `BIL-BILL-3`, `BIL-CREDIT-1`, `INV-VAL-1`, `INV-VAL-2`, `INV-OPEN-5`, `PRC-RCPT-1`,
`PRC-VRCPT-1`, `SAL-DLV-1`, `SET-WHT-1`.

**Exit:** the workflow engine conflict with `durable-execution.md` resolved by ADR; a lag budget per
projection, measured; a period-close barrier that waits for projections; an accepted unapplied-cash
state for `SET-WHT-1`; the opening stock load cut over.

**Stop if:** the accounting owner does not accept a lagging subledger at period close.

### Class E (`alchemy.class-e`)

9 rules whose business meaning changes: `BIL-DOC-1`, `BIL-INV-1`, `BIL-BILL-1`, `INV-XFER-1`,
`PRC-RET-1`, `SAL-CREDIT-1`, `SAL-CREDIT-2`, `SAL-DLV-2`, `SET-BANK-3`.

**Exit, per rule:** the accounting owner accepts its reversal trail and period-close rule in
writing, or the rule stays on a PostgreSQL transaction; the rule's business owner signs off its new
meaning; a rehearsed cutover for each aggregate that moves.

**Stop if:** for a rule, neither acceptance nor a PostgreSQL transaction boundary is possible. That
rule stays table-backed, and so do the aggregates it touches.

## Measures

- Rules stated as stories, per class.
- Aggregates cut over, per module.
- Rebuild time per tenant and projection lag, against their budgets.
- Event schemas changed, and old events decoded after each change.
