# Phase 3: Class C, Cross-Aggregate Rules That Stay Simple

> **Status:** Accepted by the owner on 2026-11-23 (review record)
>
> **Roadmap gate:** `alchemy.class-c`
>
> **Related documents**
>
> - Phase index: [`./README.md`](./README.md)
> - Roadmap track: [`../../roadmap/alchemy-domain.md`](../../roadmap/alchemy-domain.md#class-c-alchemyclass-c)
> - Rule classification: [ADR-0124](../../decisions/0124-adopt-alchemy-domain-in-phases.md#rule-by-rule-classification)

## Scope

The 9 class C rules: `ACC-OPEN-1`, `INV-OPEN-4`, `PRC-SUP-1`, `PRC-READ-1`, `PRC-DRAFT-1`,
`SAL-CUST-1`, `SAL-PRICE-1`, `SAL-QUOT-3`, `SET-BANK-2`. Each touches more than one aggregate but
becomes a derived id, a uniqueness claim, or a policy. A derived id is the common case: most of the
unique values here never change, so they can be the instance id and need no claim.

## Aggregates

No aggregate moves in this phase. The gates `alchemy.rebuild` and `alchemy.host-role` are not met, and
phases 1 and 2 moved nothing. Price lists, quotations, and Supplier Accounts are candidates for a
later cutover only after both gates close; each needs its own review then.

- **Already modelled by phase 1, reused here:** `PartyCustomer` (keyed by the Party relationship),
  `Quotation`, `OpeningLoad` (accepts or refuses a bundle), and the bank statement import.
- **New models:** price lists, Supplier Accounts, customers by email, and the opening journal's
  derived key (`ACC-OPEN-1`; accounting's `postingKey` in the phase 1 model is a local copy of the
  replay logic and is replaced by the shared function below).
- **Modelled only:** the opening journal (the ledger is not in this track), the opening stock load
  (a class D aggregate), and bank statements (a class E aggregate).

## Why most of the "claims" are derived ids

A uniqueness claim is needed only when the unique value is not the aggregate's own id and it can
change, or when one claim spans several aggregates. Checked in the Sales source, a customer is
updated only for `creditLimit` and `priceListId`, never for email, and a price list is only
inserted, never renamed (no update of its name; read from `documents.ts` and `postgres.ts`, so
other code paths are unverified). So:

| Rule | Unique value | Mechanism |
| --- | --- | --- |
| `SAL-CUST-1` | canonical email per tenant | derived instance id from tenant and canonical email |
| `SAL-PRICE-1` | price list name per tenant | derived instance id from tenant and name |
| `PRC-SUP-1` | one Supplier Account per Party relationship | derived instance id from the relationship (same shape as `PartyCustomer`) |
| `SET-BANK-2` | checksum per tenant, legal entity, bank account | derived instance id from all four |
| `SAL-QUOT-3` | one order per accepted quotation | derived instance key for the order, read from the quotation |
| `ACC-OPEN-1` | one opening journal per legal entity | derived key `accounting.opening_balance/<legal entity id>` |
| `INV-OPEN-4` | one load per `openingId` | derived from `openingId` |
| `SAL-ORDER-2`, `PRC-PO-3` | a confirmation key unused by any other order | **claim** (phase 2 gap) |
| `INV-STOCK-3` | a correction key unused for other stock | **claim** (phase 2 gap) |
| `INV-OPEN-4` | an item not already opened in the warehouse | **claim** per warehouse and item (the bundle spans many items) |

A derived id here is an Alchemy instance key, not a table row id. Row ids keep the UUIDv7 policy
of `AGENTS.md`.

## Deliverables

1. One pure derivation function per derived id, shared by the production service and the model (the
   owner's rule: one shared `decide`). Stories show that a repeat returns the record and a different
   content fails with the error production already names: `CustomerAlreadyExists`,
   `PriceListAlreadyExists`, `SupplierAccountAlreadyExists`, `JournalIdempotencyConflict`, and
   `OpeningStockConflict`.
2. **One claim protocol, designed once**, for the four claims in the table: the three phase 2 gaps and
   `INV-OPEN-4`'s per-item claim. It states the order of steps (claim first, or record first, and
   why the other was rejected), the release path when the command fails or is reversed, what a
   crash between the two steps leaves behind and how it is recovered, and who may release a claim.
   A released claim stays in the history.
3. `PRC-DRAFT-1` is **modelled** as a policy that submits the approval request after the purchase
   order is drafted, in memory only. It is not built into production: today the rule submits the
   request in the same transaction and returns it with the order, so the policy changes the API
   response, the screen that shows it, and when an approver sees the request. That contract change
   is recorded as a decision for the owner before anything is built. `PRC-REL-1` still requires the
   approval.
4. `PRC-READ-1` as a story: a read of a view with `atLeast` that cannot be satisfied fails with
   `View.ConsistencyTimeout` and never falls back to another source. Whether the in-memory story
   host simulates `atLeast` is **unverified**; if it does not, this is stated on the cluster host
   (deliverable 5) or recorded as cluster-only.
5. A concurrency proof for the claim protocol on the Effect Cluster host: the opt-in pool test
   (`RITSEI_ALCHEMY_POOL=1`, Docker in WSL). Guardrails from the handoff: one runner replica (8 GB
   RAM), check `df -h /` before each heavy step and stop under 1.5 GB free (the WSL disk is about
   5.5 GB, mounted `errors=remount-ro`), never prune the owner's containers and volumes. The host
   runs as a superuser until `alchemy.host-role` closes, so this proves the protocol, not the role.

## Exit evidence

Stories for the nine rules naming their IDs; the derivation functions used by production and by the
model; the claim protocol written and exercised by a story for each failure point (failed command,
reversed command, crash between the steps) and by the concurrency proof; the `PRC-DRAFT-1` contract
change recorded for the owner. No cutover is part of the exit, and no `RULES.md` changes authority.

## Claim protocol (recorded 2026-11-23, deliverable 2)

Modelled on the sales confirmation key (`SAL-ORDER-2`) in
`erp/modules/sales/src/confirmation-claim-model.ts`, with 10 stories in
`erp/modules/sales/tests/confirmation-claim.story.test.ts`. It is the pattern for `PRC-PO-3`,
`INV-STOCK-3`, and `INV-OPEN-4`'s per-item claim; those copy it when their derivations land, so the
shape is kept in one module until a second consumer exists. Nothing moves and no production code
changes.

- **Aggregates.** `ConfirmationKeyClaim`, keyed `<tenant>/<key>`, with `ClaimKey` and `ReleaseKey`.
  A free claim is taken; the holder claiming again is a no-op; another holder is refused with
  `ClaimHeld`; only the holder releases. A `ConfirmationRequest` aggregate records the request and a
  policy starts the saga `ConfirmWithClaim`: claim, then confirm on the order, then complete.
- **Order of steps: claim first, then record.** The failure it can leave is a *false conflict*, a
  key held by an order that never carried it, which a sweep repairs. Recording first can leave two
  orders confirmed under one key, which nothing repairs, so it was rejected.
- **Release path.** The claim step returns whether *this run* took the claim. Its compensation
  releases only then. A holder's retry takes nothing, so a failing confirmation releases nothing: a
  cancelled order keeps the key it was confirmed with (the retry contract of phase 2 holds, and its
  claim stays).
- **Crash between the two steps.** The claim stays held by an order that does not carry the key. The
  holder's own retry takes nothing and confirms; another order sees a false `ClaimHeld` until a
  sweep reads the holder (another aggregate), asks the pure `staleClaim`, and releases. The sweep is
  described and its decision is shared; the scheduled sweeper itself is not built.
- **Who releases.** Only the holder, through the saga compensation or the sweep.

Mutation checks (compensation that always releases, no compensation, a held claim granted to
another holder, release by anyone) each fail at least one story.

**Still open in this deliverable.** The sweep's schedule and reading of the holder are not built, and
the concurrency proof (deliverable 5) has not run: the story host is serial, so two simultaneous
claims on the same key are not exercised yet.

## Derived ids (recorded 2026-11-23, deliverable 1)

Stories tagged with each rule ID are in `erp/modules/<module>/tests/*-derived-ids.story.test.ts`
(sales, procurement, settlement, accounting, inventory). The full repository test project passes with
PostgreSQL 19 (893 passed, 1 skipped); `lint`, `tsc`, `boundary:lint`, and `fallow:audit` introduce
nothing. Each key function was mutation-checked (dropping the tenant from a key, an accepted changed
repeat, a removed eligibility check): at least one story failed each time. Nothing moves; the
production changes are pure moves that make production call the shared function.

| Rule | Shared function | Production calls it? | Note |
| --- | --- | --- | --- |
| `SAL-CUST-1` | `canonicalEmail` (`derived-ids.ts`) | Yes, replacing three inline `trim().toLowerCase()` | `customerKey` is model-only; the table's unique constraint does the job |
| `SAL-PRICE-1` | `priceListKey` | **No** | Production relies on `price_lists_tenant_name_key` and builds or compares no name; names are exact and case-sensitive; `setPrice` is not modelled (it addresses a list by row id) |
| `SAL-QUOT-3` | `decideQuotationConversion` | Yes, in `convertQuotation` (existing-order check still first) | The order key is model-only; the accepted state arrives as a fact the service read |
| `PRC-SUP-1` | `isEligibleSupplierRelationship`, `supplierAccountInstanceKey` | Yes (store eligibility; memory duplicate check) | PostgreSQL builds no key; the unique constraint does |
| `SET-BANK-2` | `bankStatementChecksum`, `bankStatementInstanceKey` | The checksum, yes | The four-part key is model-only |
| `ACC-OPEN-1` | `postingKey` (moved verbatim), `openingJournalReference` | Yes | Replaces the model's local copy of the replay logic; the model's events now carry the legal entity |
| `INV-OPEN-4` | `sameOpeningBundle`, `requestedOpeningRows` | Yes | `OpeningStockAlreadyLoaded` (an item already opened in the warehouse) is **not** built: it needs the claim protocol |

### Corrections to what this document assumed

- **A repeat is rejected, not returned,** for `SAL-CUST-1`, `SAL-PRICE-1`, and `PRC-SUP-1`: production fails
  with `CustomerAlreadyExists`, `PriceListAlreadyExists`, and `SupplierAccountAlreadyExists`, and the
  models match it. Only `SAL-QUOT-3`, `SET-BANK-2`, `ACC-OPEN-1`, and `INV-OPEN-4` return the record on a repeat.
- **`SET-BANK-2` has no conflict for different content:** another file has another checksum, so it is
  another instance.
- **Customer email never changes** (re-checked: the only customer updates are `creditLimit` and
  `priceListId`, and a database check enforces the canonical form).

### Gaps (not closed here)

- The `SET-BANK-2` command carries only the file content, so nothing in the model checks that the
  target key matches the content's checksum; the service builds the key. A misaddressed command
  would import under the wrong key. Production has no such rejection, so none was added.
- Model-only key functions (`customerKey`, `priceListKey`, the order key, the statement key,
  `openingJournalKey`, `openingLoadKey`) are not called by production, which gets the same
  guarantee from table constraints. They protect nothing until an aggregate moves.

## `PRC-DRAFT-1` and `PRC-READ-1` (recorded 2026-11-23, deliverables 3 and 4)

### `PRC-DRAFT-1` as a policy (modelled, not built)

`erp/modules/procurement/src/draft-approval-model.ts` and
`tests/procurement-draft-approval.story.test.ts` (4 tests). A policy reacts to
`PurchaseOrderDrafted` and, when the total needs approval, sends `SubmitApproval` to a
`PurchaseApprovalRequest` aggregate keyed by the same instance id as the order.

- A draft strictly above the threshold submits a request for its total, with production's reason.
  A draft at the threshold submits none. A repeated submission records nothing (production's
  `onConflictDoNothing`).
- The drafted order's own events carry no request: that is the **API contract change** the owner has
  **not decided**. Production is unchanged and nothing uses this model. `PRC-REL-1` is untouched.
- Whether a total needs approval is read through an `ApprovalPolicy` service; production asks the
  framework Approvals service, so this decision is **not shared** with it.
- Mutation checks (inclusive threshold, always submit, repeat records again) each fail a story.

### `PRC-READ-1` (the fail-closed half cannot be stated in the story host)

In the port, a read waits for a caller's write through a **query with `waitsFor`** and an `atLeast`
receipt; if the projection does not catch up the query fails with `ConsistencyTimeout`, typed, with
no fallback. (View reads have the same `atLeast`, but views are not in the port.)

**Observed:** in the in-memory story host a query whose projection never catches up does not fail
with `ConsistencyTimeout`; it hangs until the test times out (20 s in a probe, then removed). So the
host cannot state "fails closed". The positive half, a query sees the caller's write after it waits
for the projection, is already covered by the pilot's `JournalForSource` story. The fail-closed half
is left to the cluster host (the concurrency proof, deliverable 5) or recorded as pending until
that proof can run. No story was added, because one that cannot fail closed would claim more than it
shows.

## Stop conditions

- A claim can be left held by a failed command or a crash with no release path.
- A quotation conversion cannot create its order without two authorities in one command.
- A derived key would need a value that can change after creation: stop and use a claim, or report
  it.
- The claim protocol needs atomicity across two aggregates that the host does not give and a
  compensation cannot cover.
- The concurrency proof cannot run within the disk and RAM guardrails: record it as pending
  instead of loosening them.

## Five views

- **Auditor.** `SET-BANK-2` makes a statement importable once by checksum per tenant, legal entity,
  and bank account, and a trigger forbids changing it; the derived statement id keeps the first
  part, and the event protection from phase 0 the second. `ACC-OPEN-1` keeps one opening journal per
  legal entity through a partial unique index; its derived journal id is only modelled, because the
  ledger stays on tables. Claims for `SAL-CUST-1`, `SAL-PRICE-1`, and `PRC-SUP-1` show who took a
  value and when; a released claim stays in the history.
- **Accountant.** A duplicate import under `SET-BANK-2` would double cash lines, and a second
  opening load under `INV-OPEN-4` would double opening stock value; `INV-OPEN-4` also refuses an
  item already opened in the warehouse (`OpeningStockAlreadyLoaded`), which needs a claim per
  warehouse and item, not only a derived load id. `ACC-OPEN-1` returns the posted entry for the same
  command and fails a different journal with `JournalIdempotencyConflict`; that behavior must
  survive. No posting changes in this phase.
- **Systems engineering.** Claims replace unique indexes with a protocol: take the claim, create the
  record, release the claim if creation fails, and survive a crash between steps. `SAL-CUST-1`
  claims the trimmed, lowercased email, so normalization happens before the claim. `PRC-READ-1`
  waits for a replica and fails closed; the receipt wait must keep failing closed. `PRC-DRAFT-1`
  returns the approval request with the drafted order today; with a policy the response no longer
  contains it, which changes the API contract and the screen that shows it.
- **ERP engine development.** `SAL-QUOT-3` converts an accepted quotation once under a lock and
  returns the same order on repeat; a derived order id keeps the "once", but the conversion writes a
  table-backed order while the quotation may be stream-backed, which is the open gate. `PRC-SUP-1`
  accepts only an active supplier relationship from Party at creation; master-data uniqueness in
  mature engines is a database constraint, and a derived id (or a claim) must make duplicates
  impossible under concurrent clicks.
- **Warehouse operations.** `INV-OPEN-4` makes an opening stock load idempotent and refuses loading
  an item twice; people loading opening stock see no difference.

## Open questions

- Should quotations move before sales orders, given that conversion creates an order?

  **Recommendation from the review:** no, not in this phase. Conversion writes an order that stays
  table-backed, and moving the quotation first creates the two-authority boundary the stop conditions
  forbid. State the conversion as a derived order key with a story, and postpone moving the quotation
  until the owner decides the authority of the order.

## Review record

| Date | Reviewer | Outcome | Notes |
| --- | --- | --- | --- |
| 2026-11-23 | Review before owner acceptance | Revised | Removed the cutover deliverable (gates unmet); replaced claim aggregates with derived ids where the value never changes; made the phase own one claim protocol for the phase 2 key gaps and the per-item claim; recorded the `PRC-DRAFT-1` contract change as an owner decision; added where the concurrency proof runs and its limits; stated what phase 1 already models; corrected the status |
| 2026-11-23 | Owner | Accepted | Decisions below |

Decisions taken in this review:

1. **No cutover in phase 3.** Candidates stay candidates until `alchemy.rebuild` and
   `alchemy.host-role` close.
2. **Derived ids where the value never changes; one claim protocol for the rest** (the phase 2 key
   gaps and `INV-OPEN-4`'s per-item claim), designed once.
3. **Quotations do not move in this phase.** Conversion is stated as a derived order key with a
   story; moving the quotation waits for a decision on the order's authority.
4. **`PRC-DRAFT-1` stays modelled only.** The API contract change (the drafted order no longer
   returns the approval request, and the approver sees it later) is **not decided** by this
   acceptance. It needs its own owner decision before anything is built.
