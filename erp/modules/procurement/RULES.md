# Procurement Rules

> **Status:** Current rules owned by the Procurement module (ADR-0123), moved here from
> `docs/architecture/procurement.md`. This file wins over ADR text for what the module does now.
>
> **Owns:** Procurement domain authority, Supplier Account identity, Purchase Order contracts and
> lifecycle, owner-local correction semantics, transaction and idempotency rules, and the gates for
> receipt, return, invoice matching, events, and Process Studio publication.
>
> **Related documents**
>
> - Canonical architecture: [`docs/architecture/architecture-spec-v4.md`](../../../docs/architecture/architecture-spec-v4.md)
> - State and consistency: [`docs/architecture/state-and-consistency.md`](../../../docs/architecture/state-and-consistency.md)
> - PostgreSQL architecture: [`docs/architecture/postgresql-19-architecture.md`](../../../docs/architecture/postgresql-19-architecture.md)
> - Authorization: [`docs/architecture/authorization.md`](../../../docs/architecture/authorization.md)
> - Integration architecture: [`docs/architecture/integration-architecture.md`](../../../docs/architecture/integration-architecture.md)
> - Process Studio: [`docs/architecture/process-studio.md`](../../../docs/architecture/process-studio.md)
> - P2 document baseline:
>   [`docs/decisions/0036-define-p2-document-and-financial-baseline.md`](../../../docs/decisions/0036-define-p2-document-and-financial-baseline.md)
> - Initial Purchase Order decision:
>   [`docs/decisions/0044-define-procurement-purchase-order-baseline.md`](../../../docs/decisions/0044-define-procurement-purchase-order-baseline.md)
> - Confirmation decision:
>   [`docs/decisions/0045-define-procurement-purchase-order-confirmation.md`](../../../docs/decisions/0045-define-procurement-purchase-order-confirmation.md)
> - Goods Receipt decision:
>   [`docs/decisions/0047-define-procurement-goods-receipt-boundary.md`](../../../docs/decisions/0047-define-procurement-goods-receipt-boundary.md)
> - Domain maturity roadmap: [`../roadmap/domain-maturity.md`](../../../docs/roadmap/domain-maturity.md)

## Identified rules

Each rule has an identifier that the test enforcing it names as `[ID]`, in a comment above the test
or in its title; `tests/architecture/modules.test.ts` fails when a rule has no such test or a test
names an unknown rule. The sections after the rules describe the module around them.

### `PRC-PO-1` A confirmed purchase order is a frozen snapshot

A draft has no confirmation key or time; a confirmed order has both; a cancelled order keeps them.
After confirmation the order, its Supplier Account, confirmation identity, lines, total, and creation
time cannot change, and cancellation (`confirmed -> cancelled`, idempotent) preserves them.
PostgreSQL enforces these invariants. A cancelled order never reconfirms, and cancelling an order
that has a receipt fails with `PurchaseOrderHasReceipts`.
Enforced by: `src/order-lifecycle.ts`, the one place that decides confirmation and cancellation for
both stores; `tests/order-lifecycle.test.ts` (state-machine properties);
`tests/order-lifecycle.differential.postgres.test.ts` (memory and PostgreSQL answer one scenario
alike); the PostgreSQL triggers `purchase_order_mutation_trigger`,
`purchase_order_line_mutation_trigger`, and `purchase_order_total_trigger`.

### `PRC-PO-2` The total is derived exactly from the lines

Quantities are positive integers within `BIGINT`, prices use the exact major-amount boundary, and the
total is `sum(quantity * unit price)` in integer minor units; callers never supply it.

### `PRC-PO-3` Confirmation is idempotent and publishes one event

The same confirmation key returns the recorded result and one event; a different key fails, and a
key another order already used fails too (a map in the memory store, the
`purchase_orders_tenant_confirmation_idempotency_key` constraint in PostgreSQL).
The memory store (`makeProcurementTestLayer`) does not apply the approval policy of `PRC-REL-1`:
Approvals has no memory implementation, so approval gating is verified against PostgreSQL only.
Enforced by: `src/order-lifecycle.ts`; `tests/order-lifecycle.test.ts`;
`tests/order-lifecycle.differential.postgres.test.ts`; the unique constraint above.

### `PRC-PO-4` A purchase order outside the tenant is not found

Reads and writes are tenant scoped, and a missing or foreign-tenant order is `PurchaseOrderNotFound`.

### `PRC-SUP-1` A Supplier Account needs an active supplier relationship

One Supplier Account is created per active Party supplier relationship; a missing or non-supplier
relationship is rejected, and a missing Supplier Account is reported as such.

### `PRC-AUTH-1` Procurement capabilities are denied by default

Creation, reads, confirmation, and cancellation each need their capability; creating an order also
needs Party relationship-read authority.

### `PRC-READ-1` Replica reads wait and never fall back to the primary

A read waits for the replica to reach the caller's position and fails closed when the wait fails
([ADR-0039](../../../docs/decisions/0039-select-postgresql-wait-for-for-replica-read-your-writes.md)).

### `PRC-RCPT-1` Receiving is atomic with Inventory and idempotent

A confirmed order is received in one transaction with the Inventory movement; a retry returns the
recorded receipt, and an over-receipt cancellation is blocked.

### `PRC-DOC-1` Only a confirmed purchase order is rendered

The document snapshot is owner-local, its checksum is stable across capture times, and an unconfirmed
order is not rendered.

### `PRC-PRICE-1` One supplier price per supplier account and product

`setSupplierPrice` (`procurement.supplier_price.configure`) replaces the price of a product for a
supplier account; reading needs `procurement.supplier_price.read`.

### `PRC-DRAFT-1` A document purchase order is priced and checked for approval when drafted

`draftPurchaseOrder` (`procurement.purchase_order.create`) accepts only stockable products
(`PurchaseLineNotStockable`), prices each line from an explicit price or the supplier price
(`SupplierPriceNotFound`), defaults the tax code through Tax for the purchase direction, and derives
the total. In the same transaction it submits an approval request when the policy requires one for
that total (strictly above the threshold) and returns it with the order.
Why: [ADR-0103](../../../docs/decisions/0103-adopt-threshold-approvals-with-separation-of-duties.md),
[ADR-0104](../../../docs/decisions/0104-adopt-valued-procure-to-pay-documents.md).

### `PRC-REL-1` Releasing needs an approval granted for exactly the total, decided by someone else

When the policy requires approval for the order total, `releasePurchaseOrder`
(`procurement.purchase_order.confirm`) and the older `confirmPurchaseOrder` both refuse with
`PurchaseOrderApprovalRequired` unless an approved request exists whose amount **equals** the total.
Release first checks that the amount is at least the total, then confirms through
`confirmPurchaseOrder`, which requires equality, so an approval granted for more than the total is
also refused (with the request status `approved`). The refusal carries the request status, or
`missing` when no request exists; the older command also leaves a pending request for an approver.
The requester cannot decide their own request (`SelfApprovalForbidden`, also enforced by the
database), and decisions are final.
Why: [ADR-0125](../../../docs/decisions/0125-require-an-approval-for-exactly-the-amount-it-releases.md)
(an approval is valid only for the amount it was requested for; it amends ADR-0103).
Enforced by: `src/order-lifecycle.ts` (`decideApprovalCover`, called by the release check in
`src/documents.ts` and by `pendingApproval` in `src/postgres.ts`);
`tests/approval-cover.postgres.test.ts` (below, equal, and above the total, on both paths); the
`approval_requests_separation_of_duties_check` constraint; the procure-to-pay chain test.

### `PRC-VRCPT-1` A valued receipt brings stock in at the purchase price against GRNI

`receiveValued` (`procurement.purchase_receipt.receive`) locks the confirmed order, rejects
quantities above what is still unreceived (`PurchaseReceiptQuantityExceeded`), numbers the receipt
`GR/`, and receives the stock through Inventory at the order line's price against
`goods_received_not_invoiced`. A repeated receipt id returns the recorded receipt.
Why: [ADR-0104](../../../docs/decisions/0104-adopt-valued-procure-to-pay-documents.md).

### `PRC-RET-1` A return sends back at most what was received, at the purchase price

`returnToSupplier` (`procurement.purchase_return.create`) locks the order, rejects quantities above
received less already returned (`PurchaseReturnExceedsReceipt`), numbers the return `RET/`, and
issues the stock through Inventory at the order line's price against `goods_received_not_invoiced`,
not at moving average. A repeated return id returns the recorded return.
Why: [ADR-0104](../../../docs/decisions/0104-adopt-valued-procure-to-pay-documents.md).

## Position

Procurement owns purchase intent and its business documents: Supplier Accounts, supplier prices,
purchase orders, receipts, and returns. It does not acquire authority merely because a document
contains references used by another domain.

```text
Party supplier relationship
        |
        v
Procurement SupplierAccount --(supplier price)--> PurchaseOrder: draft -> confirmed -> cancelled
                                                        |   (approval above threshold, PRC-REL-1)
                                                        v
                                     Receipt GR/... (stock in at PO price vs GRNI)
                                     Return RET/... (stock out at PO price vs GRNI)
                                                        |
                                                        v
                                     Billing supplier bill: three-way match (BIL-BILL-1)
```

Confirmation is not supplier acceptance or delivery, and cancellation is not supplier
acknowledgement or financial reversal. Two service surfaces exist: `ProcurementService`, the original
Supplier Account, purchase order, and unvalued receipt surface, and `PurchaseDocumentService`, which
carries the valued document flow above. Sourcing, requisitions, blanket agreements, multiple
currencies, supplier communication, and Process Studio publication are not supported.

## Authority Matrix

| Fact or responsibility | Authority | Current rule |
| --- | --- | --- |
| Party identity, supplier role, Legal Entity, supplier relationship | Party | Procurement consumes the public Party relationship contract |
| Tenant-local usable supplier identity | Procurement `SupplierAccount` | References one active Party supplier relationship |
| Supplier prices, purchase orders, receipts, returns | Procurement | PostgreSQL-backed owner state |
| Approval policy, requests, and decisions | Approvals (framework) | Procurement asks and enforces the result (`PRC-REL-1`) |
| Tax code selection and rates | Tax | Procurement asks Tax for default codes; it computes no rate |
| Physical stock, valuation, and movement | Inventory | Receipts and returns move stock through the public Inventory contract |
| Supplier bills, supplier credit notes, three-way match, payables | Billing | Billing matches against Procurement's receipt and return quantities (`BIL-BILL-1`) |
| Payments to suppliers | Settlement | Not a Procurement fact |
| Journals, accounts, periods | Accounting | Reached through Inventory and Billing postings; Procurement posts none |
| External supplier transmission and acknowledgement | Integrations plus Procurement contract | Not implemented |

No package may mutate Procurement tables except Procurement. Procurement must not mutate Party,
Inventory, Billing, Accounting, Messaging, Process, or integration tables directly.

## Aggregate Model

### SupplierAccount

`SupplierAccount` is the Procurement-owned, tenant-local identity for a supplier relationship.

Required properties:

- opaque UUID identity;
- Tenant identity;
- one Party-owned supplier relationship;
- resolved Party and Legal Entity facts returned through the Party public contract;
- at most one Supplier Account for the same Tenant and supplier relationship.

A missing, foreign-Tenant, inactive, or non-supplier relationship is not eligible. Party remains the
authority for relationship kind and activity.

### PurchaseOrder

A Purchase Order contains:

- opaque UUID identity;
- Tenant identity;
- one tenant-local Supplier Account;
- status: `draft`, `confirmed`, or `cancelled`;
- zero confirmation metadata while draft;
- one immutable confirmation identity and `confirmedAt` after confirmation;
- at least one line;
- stable server-owned opaque UUID identity for each line;
- line snapshots containing opaque item UUID, positive PostgreSQL-bigint quantity, and exact
  non-negative two-decimal unit price;
- an exact owner-derived two-decimal total.

The public snapshot exposes stable line identity because future receipt evidence must reference an
immutable order line. Create input never accepts or controls that identity. Confirmation idempotency
metadata, private update timestamps, database constraint names, and driver failures remain private.

The current model has no line position, unit-of-measure registry, currency, tax, discount, requested
delivery date, warehouse, receipt quantity, supplier document number, amendment version, or
replacement link. Those fields must not be inferred from generic ERP expectations.

## Purchase Order Lifecycle

```text
absent -> draft -> confirmed -> cancelled
```

All other transitions are invalid.

| Transition or query | Preconditions | Effect | Capability | Retry behavior | Public business failure |
| --- | --- | --- | --- | --- | --- |
| `absent -> draft` | Supplier Account exists in the Tenant; at least one valid line | Atomically persist header and lines; derive total | `procurement.purchase_order.create` | No idempotency identity; a retry may create another draft | `SupplierAccountNotFound` |
| read | Order exists in the Tenant | Return draft, confirmed, or cancelled snapshot | `procurement.purchase_order.read` | Safe repeat | `PurchaseOrderNotFound` |
| `draft -> confirmed` | Current state is draft | Record confirmation identity and timestamp; freeze header and lines | `procurement.purchase_order.confirm` | Same key and order returns the original result; another key or order conflicts | `PurchaseOrderConfirmationIdempotencyConflict`, `PurchaseOrderInvalidState`, `PurchaseOrderNotFound` |
| `confirmed -> cancelled` | Current state is confirmed | Change only terminal status and private update timestamp | `procurement.purchase_order.cancel` | Natural idempotency: cancelled returns the existing result | `PurchaseOrderInvalidState`, `PurchaseOrderNotFound` |

A draft has no committed effect and therefore is not cancelled. A mistaken confirmed order is
corrected by cancelling it and creating a new draft. Reopening or editing a confirmed/cancelled row
is forbidden because it would hide the prior commitment.

## Contract Invariants

### Status and metadata

```text
draft     => confirmation key is absent and confirmedAt is absent
confirmed => confirmation key is nonblank and confirmedAt is present
cancelled => original confirmation key is nonblank and confirmedAt is preserved
```

The public DTO mirrors the visible part of this invariant: drafts have `confirmedAt = null`, while
confirmed and cancelled orders have a valid timestamp.

### Exact quantity and money

- Quantity is a positive decimal integer string within PostgreSQL signed `BIGINT`.
- Unit price and total use the canonical exact financial major-amount boundary.
- Application arithmetic converts unit prices to integer minor units and uses `bigint`.
- Total is derived as `sum(quantity * unit price)`; callers never supply it.
- Floating-point arithmetic and implicit rounding are forbidden.

### Snapshot integrity

After confirmation, these facts cannot change:

- order and Tenant identity;
- Supplier Account;
- confirmation identity and timestamp;
- line membership and line values;
- total and creation timestamp.

Cancellation preserves the same facts. Cancelled headers and lines are terminal and immutable.

### Tenant integrity

- All reads and writes include Tenant scope.
- Composite foreign keys prevent cross-Tenant Supplier Account and Purchase Order references.
- A foreign-Tenant order is reported as `PurchaseOrderNotFound`; existence is not disclosed.

## Transactions, Concurrency, and Idempotency

### Draft creation

Header and all lines commit in one `Database.transaction`. Any line or constraint failure rolls back
the header. The database foreign key is the final Supplier Account existence and Tenant-scope guard.

### Confirmation

Confirmation locks the header with `SELECT ... FOR UPDATE`, evaluates current state and idempotency,
and updates the row in one transaction. The Tenant-scoped unique confirmation identity prevents one
logical confirmation from naming multiple orders.

Line mutations lock the parent order in their trigger. This serializes confirmation with concurrent
line writes:

- if the line mutation locks first, confirmation observes its committed result;
- if confirmation locks first, the later line mutation observes a confirmed state and fails.

A lost confirmation response is resolved by retrying the same key or reading the order. A retry must
not invent a new key.

### Cancellation

Cancellation locks the header, checks the state, and performs `confirmed -> cancelled` in one
transaction. Concurrent cancellations serialize and converge on the same terminal result. No
cancellation idempotency key is stored because the current command has one terminal result and no
downstream side effect.

A future cancellation with external or cross-domain effects must revisit this rule before activation.

## PostgreSQL Enforcement

The Drizzle schema owns typed tables and supported constraints. Reviewed custom migrations own the
state and immutability triggers.

PostgreSQL enforces at least:

- every order starts as draft;
- only `draft -> confirmed -> cancelled` transitions are legal;
- status and confirmation metadata agree;
- confirmation identity is unique within a Tenant;
- confirmed and cancelled headers cannot be deleted or edited;
- confirmed and cancelled lines cannot be inserted, updated, moved, or deleted;
- confirmed and cancelled orders have at least one line;
- stored total exactly equals the line-derived total;
- line quantity is positive and unit price is non-negative;
- Supplier Account and order references remain tenant-local.

Known relational failures map to stable Procurement errors. Unknown database failures remain the
foundation-owned `DatabaseFailure`; raw SQL, SQLSTATE, driver objects, and constraint details never enter
the public DTO contract.

## Authorization

Procurement uses narrow business capabilities, one per business action; the authoritative list is
[`src/capabilities.ts`](./src/capabilities.ts). Approval decisions use the policy's approver
capability in the Approvals module.

Authorization occurs before protected reads or writes. Authentication does not grant Procurement
authority. The service denies by default and tests allow, deny, and Tenant-scope mismatch behavior.

The repository does not yet have a general production audit store or complete RLS policy path.
Confirmation and cancellation therefore must not be represented as providing complete actor audit
evidence beyond the current authorization decision and stored business state.

## Publication and Integration Boundary

The Procurement package publishes the bounded PUBLIC
`procurement.purchase_order.confirm` action and `procurement.purchase_order.confirmed` event.
Purchase Order creation and cancellation remain private. Confirmation appends the owner event
through the public Messaging contract inside the same transaction as the status change; an
idempotent replay returns the original order without appending a second event.

Do not add an event merely because a state changes. Publication requires:

- a named committed business fact;
- versioned payload and compatibility policy;
- correlation, causation, actor, and idempotency semantics;
- correction meaning;
- an approved consumer or Process Studio use case;
- atomic owner transaction plus Messaging contract invocation.

External supplier delivery additionally requires the integration architecture's timeout, retry,
unknown-outcome, provider-status, credential, and compensation rules.

## Goods Receipt Boundary

Goods Receipt is active as a bounded Level 2 Procurement capability through
`procurement.purchase_receipt.receive`. Procurement owns immutable receipt evidence and cumulative
allocation; Inventory owns physical movement and stock balance. Neither domain writes the other's
tables.

The selected contract is:

1. Only confirmed Purchase Orders are eligible. Draft and cancelled orders reject receipt work.
2. Purchase Order line identity is server-owned. The line's item identity must resolve to a tenant-local
   Inventory Item when the receipt creates physical stock.
3. One receipt uses one tenant-local Warehouse aligned with the Purchase Order Supplier Account's
   Legal Entity. Inventory validates the warehouse scope inside the shared PostgreSQL transaction.
4. Partial and repeated receipts are allowed. Cumulative quantity may not exceed the confirmed line
   quantity; over-receipt and duplicate line IDs are rejected.
5. Receipt quantities are positive whole-number quantities in the Inventory Item's immutable stock UOM.
6. The Tenant-scoped idempotency key returns the original receipt for the same input and rejects
   conflicting reuse.
7. Receipt locks the Purchase Order before checking status and cumulative quantities. Cancellation
   locks the same row and is rejected after any receipt evidence exists until a later return/reversal
   contract exists.
8. Procurement creates receipt evidence and invokes Inventory's public `receiveStock` contract in
   one PostgreSQL transaction. Inventory records the receipt ID as movement provenance.
9. A lost response is retried with the same idempotency key. No external unknown-outcome protocol is
   introduced because the bounded operation is PostgreSQL-local.
10. Purchase returns (`PRC-RET-1`) and valued receipts (`PRC-VRCPT-1`) exist; receipt reversal,
    external documents, and Process Studio publication remain separate gates.

The implementation and rationale are defined by
[`ADR-0047`](../../../docs/decisions/0047-define-procurement-goods-receipt-boundary.md). An Effect fiber, request
lifetime, or eventual event is not the durability mechanism for the synchronous stock invariant.

## Invoice Matching and Payables

Billing owns supplier bills, supplier credit notes, the three-way match, and payables
([ADR-0102](../../../docs/decisions/0102-split-billing-and-settlement.md),
[ADR-0104](../../../docs/decisions/0104-adopt-valued-procure-to-pay-documents.md)); its rules are
`BIL-BILL-1` to `BIL-BILL-3` and `BIL-CREDIT-1` in [`../billing/RULES.md`](../billing/RULES.md).
Procurement supplies the matching view (`getMatching`): per order line the ordered, received, and
returned quantities, price, and tax code. A purchase order total is not by itself a payable or
journal fact.

## Maturity

- `procurement.purchase_order.confirm` is a public typed action and
  `procurement.purchase_order.confirmed` a public owner event, catalog-tested with idempotent replay.
- Valued receipts, returns, supplier prices, and approval-gated release are covered end to end by
  the procure-to-pay chain test, and their refusals and replays by `tests/documents.postgres.test.ts`.
- Receipt reversal, external supplier documents, and Process Studio publication are not supported.

## Runtime Composition

`ProcurementLive` is composed in `erp/runtime` with Database, Authorization, Approvals, Accounting,
Party, Tax, Product, and Inventory dependencies. The module's routes are declared in [`http.ts`](./http.ts)
(ADR-0094). Keep handlers on the public package contract rather than importing persistence
internals.

## Implementation Map

| Concern | Owner path |
| --- | --- |
| Public schemas and service contract | `erp/modules/procurement/src/contract.ts` |
| Public tagged errors | `erp/modules/procurement/src/errors.ts` |
| Service compatibility surface | `erp/modules/procurement/src/service.ts` |
| Semantic persistence port | `erp/modules/procurement/src/store.ts` |
| PostgreSQL implementation | `erp/modules/procurement/src/postgres.ts` |
| Deterministic test implementation | `erp/modules/procurement/src/memory.ts` |
| Named production/test layers | `erp/modules/procurement/src/layers.ts` |
| Public package exports | `erp/modules/procurement/mod.ts` |
| Capability constants | `erp/modules/procurement/src/capabilities.ts` |
| Closed authorization catalog | `framework/modules/authorization/src/capabilities.ts` |
| Drizzle schema | `db/schema/procurement.ts` |
| Migration history | `db/migrations/` |
| Contract tests | `erp/modules/procurement/tests/procurement.test.ts` |
| PostgreSQL invariant tests | `erp/modules/procurement/tests/procurement.postgres.test.ts` |

Persistence tables, repositories, Drizzle query types, confirmation keys, and migration helpers are
private and must not be re-exported.

## Evolution and Decision Records

This document is the canonical current-state Procurement specification. Routine owner-local contract
work updates this file directly together with code, schema, and tests.

Create a new ADR only when Procurement work makes a difficult-to-reverse decision such as:

- moving authority between domains;
- selecting a cross-domain atomicity or consistency protocol;
- activating an external provider or strategic dependency;
- changing financial or stock authority;
- publishing a compatibility-sensitive action or event contract;
- introducing document versioning that supersedes the current immutable-snapshot model.

Do not create one ADR per command, field, status, or migration when the change follows this existing
architecture. Historical ADRs explain why the baseline was selected; this specification owns the
complete current behavior.
