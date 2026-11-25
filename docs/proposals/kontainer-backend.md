# Proposal: Backend Data for the Remaining Kontainer Screens

> **Status:** Proposal. The owner decided E3, E5, numbering, and the approval threshold on
> 2026-11-25 (see [Decisions](#decisions-2026-11-25)); E6 is still open. Nothing here is built yet.
> **Related:**
> [`../design/kontainer/screens.md`](../design/kontainer/screens.md) ·
> [`../decisions/0127-adopt-the-kontainer-visual-language.md`](../decisions/0127-adopt-the-kontainer-visual-language.md) ·
> [`../decisions/0095-adopt-gapless-document-numbering.md`](../decisions/0095-adopt-gapless-document-numbering.md) ·
> [`../architecture/search-architecture.md`](../architecture/search-architecture.md) ·
> [`./erp-chains-next-steps.md`](./erp-chains-next-steps.md)

The Dermaga and the document chain are built from data the API already serves. Three screens are
not, and each one needs a decision before code, because it defines what the product means by a word.
This page states the smallest backend that makes each screen real, and the decisions taken.

## E3 Yard: documents per stage

**What exists.** Quotations have the statuses `draft`, `sent`, `accepted`, `rejected`, `expired`;
sales orders `draft`, `confirmed`, `cancelled`. A delivery is a record, not a state. Billing
documents carry an open amount, and payments an unallocated amount. There is no "ready to ship"
state, and no list in the browser contracts counts documents by stage.

**Stages for Order-to-Cash**, each derivable from those facts without a new state:

| Stage     | A document is here when                          |
| --------- | ------------------------------------------------ |
| Quotation | Quotation `sent` or `accepted`, with no order    |
| Order     | Order `confirmed`, nothing delivered             |
| Delivered | Delivered, not fully invoiced                    |
| Invoiced  | A customer invoice has an open amount above zero |
| Paid      | A customer invoice has an open amount of zero    |

**Stages for Procure-to-Pay**, from the same kind of facts:

| Stage    | A document is here when                       |
| -------- | --------------------------------------------- |
| Ordered  | Purchase order `confirmed`, nothing received  |
| Received | Received, not fully billed                    |
| Billed   | A supplier bill has an open amount above zero |
| Paid     | A supplier bill has an open amount of zero    |

The mockup's "Siap Kirim" has no source and is dropped, not simulated.

**Backend.** A count and the oldest document date per stage, read by SQL in the module that owns the
document (sales, billing, procurement), and joined in the documents module as one read, `GET
/documents/pipeline?legalEntityId=`. It is read-only, authorized like the chain, and returns counts
and the oldest age, not the documents; a stage's document list reuses the owning module's list.
Counting through the chain per order would be N+1 and is rejected.

**Decided (2026-11-25):** the stages above (K2). Age counts from the document date, not from
entering the stage. The first version is one legal entity: a branch exists only as a party's branch
and as an authorization scope kind, and no group or branch hierarchy over documents was found, so
the mockup's zoom from group to entity to branch is not built.

**KPI read (gap G-04).** `GET /insights/kpis?legalEntityId=&period=YYYY-MM` returns six figures
beside the same figure for the previous month, joined by the `insights` module (read-only, no data
of its own) from reads in the owning modules, each authorized by its owner: net sales (Billing,
invoice less credit note subtotals by document date), receivables and payables past due
(Settlement aging at the last day), cash and inventory value (ledger balance of the `cash` and
`inventory` posting roles, Accounting), and confirmed orders still to deliver (Sales, count and
value at order prices). An owner that denies the caller leaves its figure `denied` and a legal
entity without the posting rule leaves it `unavailable`; neither shows as zero, and a caller denied
by every owner is told so. Known gaps: an order cancelled since the previous month-end is not in
the previous undelivered figure (a cancellation has no date); the base currency is not returned
yet; there is no scope narrower than the tenant capability and the legal entity filter.

## E5 Cari: search over objects

**What exists.** Search is owner-local only: `ListItemsInput`, `ListPartiesInput`, and the tenant
membership list take a `search` text filter, and no full-text index, trigram index, or search across
object types was found in `db`, `erp`, or `framework`. The architecture allows two routes.

- **Exact lookup by document number** (for example `SO/2026/00412` or `INV/2026/00093`, the
  ADR-0095 format): owner-local queries joined by the documents module, fully authoritative, no
  projection. This covers "find this object". Every owning module needs a lookup by number; adding
  it is the work, and it needs the numbers that sales orders, purchase orders, and quotations did
  not carry before K1.
- **Ranked or name search** (party names, product text): a cross-domain projection rebuilt from
  committed events, as `search-architecture.md` requires, with its own ADR, rebuild path, and
  tenant-scoped bounded queries. Build it only when exact lookup is shown not to be enough.

Results are candidates; opening one is re-authorized by its owner. The palette (Ctrl+K) is the
screen and takes no new data beyond this.

**Decided (2026-11-25):** exact lookup by number first, with no projection (K3). A result is a
candidate `{type, id, number, legalEntityId}`.

## E6 Tutup hari: closing the day

**What exists.** Nothing: the backend has no day-closing concept, and period closing is a different
thing (K5 in [`ux-acceptance.md`](./ux-acceptance.md)). The mockup lists what is left open and
closes the day.

**The owner decides** what closing a day means before any design: a reconciliation checkpoint, a lock
on posting for that day, a hand-over summary, or something else; who may close it; and whether it can
be reopened. Until then the screen stays unbuilt, and no placeholder is added.

## Decisions (2026-11-25)

The owner took these decisions; each replaces a question this page asked before.

- **K1 Numbering follows ADR-0095.** Sales orders, purchase orders, and quotations are numbered by
  `NumberingService`, per legal entity, document type, and fiscal year, gapless, in the transaction
  that confirms (order, purchase order) or sends (quotation) the document. A draft is never
  numbered.
- **K2 Pipeline stages.** The Order-to-Cash and Procure-to-Pay stages in E3, aged from the document
  date, for one legal entity.
- **K3 Search.** Exact lookup by number first, with no projection (E5).
- **K4 Approval threshold and escalation.**
  - A purchase order above Rp 50.000.000 needs an approval: the approval policy for subject
    `procurement.purchase_order` has threshold `50000000.00`, and `ApprovalService.isRequired`
    already requires an approval for a total above the threshold. The approver is the capability
    held by the Direktur Keuangan. No seed or demo configuration of approval policies exists in the
    repository; the policy is tenant data set through `configurePolicy`.
  - A sales order has no approval; the credit-limit gate (ADR-0108, `SAL-CREDIT-1`) already stops
    it.
  - **Escalation policy (not built).** An approval that nobody takes within 2 working days goes to
    the owner of the flow; after 2 more working days, to the supervisor. A situation of High
    severity escalates after 1 working day. This is a written policy only: there is no timer and no
    SLA engine, and none is built for it.

## Order

1. E3 stages and the E5 route are decided (this page); numbering of orders and quotations (K1) comes
   first because the lookup needs the numbers.
2. E3: count queries in sales, billing, and procurement, the pipeline read, then the Yard screen.
3. E5: number lookup in each owning module, the search read, then the palette.
4. E6 after its decision.

Each step is one branch and one pull request, with a test for every rule it adds.
