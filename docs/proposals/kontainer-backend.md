# Proposal: Backend Data for the Remaining Kontainer Screens

> **Status:** Proposal, not approved. Nothing here is built. **Related:**
> [`../design/kontainer/screens.md`](../design/kontainer/screens.md) ·
> [`../decisions/0127-adopt-the-kontainer-visual-language.md`](../decisions/0127-adopt-the-kontainer-visual-language.md) ·
> [`../architecture/search-architecture.md`](../architecture/search-architecture.md) ·
> [`./erp-chains-next-steps.md`](./erp-chains-next-steps.md)

The Dermaga and the document chain are built from data the API already serves. Three screens are
not, and each one needs a decision before code, because it defines what the product means by a word.
This page states the smallest backend that would make each screen real, and what the owner decides.

## E3 Yard: documents per stage

**What exists.** Quotations have the statuses `draft`, `sent`, `accepted`, `rejected`, `expired`;
sales orders `draft`, `confirmed`, `cancelled`. A delivery is a record, not a state. Billing
documents carry an open amount, and payments an unallocated amount. There is no "ready to ship"
state, and no list in the browser contracts counts documents by stage.

**Proposed stages for Order-to-Cash**, each derivable from those facts without a new state:

| Stage     | A document is here when                          |
| --------- | ------------------------------------------------ |
| Quotation | Quotation `sent` or `accepted`, with no order    |
| Order     | Order `confirmed`, nothing delivered             |
| Delivered | Delivered, not fully invoiced                    |
| Invoiced  | A customer invoice has an open amount above zero |
| Paid      | A customer invoice has an open amount of zero    |

The mockup's "Siap Kirim" has no source and is dropped, not simulated.

**Proposed backend.** A count and the oldest document date per stage, read by SQL in the module that
owns the document (sales, billing), and joined in the documents module as one read, `GET
/documents/pipeline?legalEntityId=`. It is read-only, authorized like the chain, and returns counts
and the oldest age, not the documents; a stage's document list reuses the owning module's list.
Counting through the chain per order would be N+1 and is rejected.

**The owner decides:** the stage list above; whether age counts from the document date or from
entering the stage; and the zoom levels. The mockup zooms from group to entity to branch. A branch exists only as a party's branch and as an
authorization scope kind, and no group or branch hierarchy over documents was found, so the first
version is one legal entity.

## E5 Cari: search over objects

**What exists.** Search is owner-local only: `ListItemsInput`, `ListPartiesInput`, and the tenant
membership list take a `search` text filter, and no full-text index, trigram index, or search across
object types was found in `db`, `erp`, or `framework`. The architecture allows two routes.

- **Exact lookup by document number** (`SO-0412`, `INV-1093`): owner-local queries joined by the
  documents module, fully authoritative, no projection. This covers "find this object" and is the
  recommended first version. Whether every owning module can already look a document up by number
  was not checked; adding that query to each is the work.
- **Ranked or name search** (party names, product text): a cross-domain projection rebuilt from
  committed events, as `search-architecture.md` requires, with its own ADR, rebuild path, and
  tenant-scoped bounded queries. Build it only when exact lookup is shown not to be enough.

Results are candidates; opening one is re-authorized by its owner. The palette (Ctrl+K) is the
screen and takes no new data beyond this.

**The owner decides:** exact lookup first, or the projection from the start.

## E6 Tutup hari: closing the day

**What exists.** Nothing: the backend has no day-closing concept, and period closing is a different
thing (K5 in [`ux-acceptance.md`](./ux-acceptance.md)). The mockup lists what is left open and
closes the day.

**The owner decides** what closing a day means before any design: a reconciliation checkpoint, a lock
on posting for that day, a hand-over summary, or something else; who may close it; and whether it can
be reopened. Until then the screen stays unbuilt, and no placeholder is added.

## Order

1. Decide the E3 stages and E5 route (this page).
2. E3: count queries in sales and billing, the pipeline read, then the Yard screen.
3. E5: number lookup in each owning module, the search read, then the palette.
4. E6 after its decision.

Each step is one branch and one pull request, with a test for every rule it adds.
