# Sales Rules

> **Status:** Current rules owned by the Sales module (ADR-0123), moved here from
> `docs/architecture/sales.md`. This file wins over ADR text for what the module does now.
>
> **Owns:** Sales customer, quotation, and sales-order authority; exact order totals; order
> lifecycle and confirmation idempotency; Sales authorization capabilities; and the boundary to
> Inventory, Accounting, Messaging, Process, and the frontend.
>
> **Related documents**
>
> - Canonical architecture: [`docs/architecture/architecture-spec-v4.md`](../../../docs/architecture/architecture-spec-v4.md)
> - State and consistency: [`docs/architecture/state-and-consistency.md`](../../../docs/architecture/state-and-consistency.md)
> - Authorization: [`docs/architecture/authorization.md`](../../../docs/architecture/authorization.md)
> - Financial ledger: [`docs/architecture/financial-ledger.md`](../../../docs/architecture/financial-ledger.md)
> - Integration architecture: [`docs/architecture/integration-architecture.md`](../../../docs/architecture/integration-architecture.md)
> - Process Studio: [`docs/architecture/process-studio.md`](../../../docs/architecture/process-studio.md)
> - Order lifecycle decision:
>   [`docs/decisions/0033-extend-order-lifecycle-and-gate-pgque.md`](../../../docs/decisions/0033-extend-order-lifecycle-and-gate-pgque.md)
> - Exact amount boundary:
>   [`docs/decisions/0042-exact-financial-amount-boundary.md`](../../../docs/decisions/0042-exact-financial-amount-boundary.md)
> - Owner-local business surfaces:
>   [`docs/decisions/0046-adopt-owner-local-business-surface-and-generated-ergonomics.md`](../../../docs/decisions/0046-adopt-owner-local-business-surface-and-generated-ergonomics.md)

## Identified rules

Each rule has an identifier that the test enforcing it names as `[ID]`, in a comment above the test
or in its title; `tests/architecture/modules.test.ts` fails when a rule has no such test or a test
names an unknown rule. The sections after the rules describe the module around them.

### `SAL-ORDER-1` Orders move only draft, confirmed, cancelled

A confirmed or cancelled order keeps its confirmation metadata, and its header and lines are
immutable except for the cancellation status change; no transition reopens a terminal order.
PostgreSQL rejects orphaned confirmation metadata and changes to confirmed snapshots and totals.

### `SAL-ORDER-2` Confirmation is idempotent and publishes one event

Confirming with the same idempotency key returns the recorded result and one
`SalesOrderConfirmedEvent`; a different key after confirmation fails with
`SalesOrderConfirmationIdempotencyConflict`, and so does a key another order in the tenant already
used. The event is appended in the confirmation transaction, so a failed append rolls the
confirmation back. The key returns the recorded result only while the order is still confirmed: a
retry after cancellation fails with `SalesOrderInvalidState` (`cancelled`), and a client that lost
the first response reads the order to learn it was confirmed and then cancelled.

### `SAL-ORDER-3` Order references stay within one tenant and one customer

Customer, quotation, order, and line references are tenant-local through composite constraints, and
an order cannot reference a quotation of another customer. Line quantities are positive integers
within PostgreSQL `BIGINT`.

### `SAL-CUST-1` A customer email is canonical and unique in its tenant

Emails are trimmed and lowercased; PostgreSQL rejects other values and duplicates in a tenant.

### `SAL-AUTH-1` Sales capabilities are denied by default

Reads, confirmation, cancellation, and confirmed-order totals each need their capability in the
tenant.

### `SAL-CREDIT-1` A draft order past the customer's credit limit is not confirmed

A customer's credit limit is a non-negative amount (null means no limit) set by `setCreditLimit`
behind `sales.credit_limit.configure`. Confirming a draft order fails with `CreditLimitExceeded`,
before the order changes, when the customer's open receivables plus their confirmed orders not yet
invoiced (never below zero) plus the order total exceed the limit. Billing answers the receivables
and invoiced amounts through the `CreditExposure` port. A retried confirmation of a confirmed order
is not checked again, delivery and invoicing are not gated, and a customer without a party role and
legal entity is never gated.
Why: [ADR-0108](../../../docs/decisions/0108-gate-order-confirmation-on-customer-credit-limit.md).

Phase 5 outcome (2026-11-24): this rule stays on its PostgreSQL transaction (ADR-0124). The staged
Alchemy model is test-only evidence, not a plan to move it.

### `SAL-CREDIT-2` Credit checks for one customer run one at a time

Confirmation locks the customer row before it reads the exposure, so of two orders that each fit the
limit but not together, only one is confirmed.

Phase 5 outcome (2026-11-24): this rule stays on its PostgreSQL transaction (ADR-0124). The staged
Alchemy model is test-only evidence, not a plan to move it.

### `SAL-CUST-2` A document customer is a Party customer role with a legal entity

`createPartyCustomer` (`sales.customer.create`) accepts only an active Party relationship of kind
`customer`, otherwise `CustomerPartyRoleInvalid`; it takes the name, party, relationship, and legal
entity from Party and returns the existing customer for a relationship that already has one. A
legacy customer without a party role and legal entity cannot be quoted, priced, or delivered to
(`CustomerLegalEntityRequired`).
Why: [ADR-0099](../../../docs/decisions/0099-make-sales-customers-party-roles.md).

### `SAL-PRICE-1` Prices come from tenant price lists

Price lists are unique by name in a tenant (`PriceListAlreadyExists`); `setPrice` replaces the price
of a product on a list; creating, pricing, and assigning a list to a customer need
`sales.price_list.configure`.

### `SAL-QUOT-1` A quotation is priced from the list price or the customer's price list

`draftQuotation` (`sales.quotation.create`) prices each line from an explicit list price or the
customer's price list (`ProductPriceNotFound` when neither exists), applies the discount percent (at
most two decimals) rounded half up to the cent, defaults the tax code through Tax for the sales
direction, and derives the total from the lines.

### `SAL-QUOT-2` Quotations move draft, sent, then accepted or rejected, or expire

Sending needs `sales.quotation.send`; accepting, rejecting, and expiring need
`sales.quotation.decide`. Repeating the current target state returns the quotation unchanged; any
other starting state fails with `QuotationInvalidState`. `expireQuotations` marks sent quotations
whose `validUntil` is before the given date as expired and leaves drafts and decided quotations
alone.

### `SAL-QUOT-3` Only an accepted quotation converts, once

`convertQuotation` (`sales.order.create`) copies an accepted quotation's lines and terms into a draft
order under a lock on the quotation; converting again returns the same order, and any other state
fails with `QuotationInvalidState`.

### `SAL-DLV-1` Deliveries never exceed the confirmed order

`recordDelivery` (`sales.delivery.record`) locks the order, requires it to be confirmed
(`SalesOrderInvalidState`), rejects unknown lines (`OrderLineNotFound`) and quantities beyond what is
still undelivered (`DeliveryExceedsOrder`), numbers the delivery `DO/` per legal entity, and returns
the recorded delivery for a repeated delivery id. Two simultaneous deliveries of the same remainder
cannot both succeed. Sales records the delivery only; it writes no stock or ledger entry.
Why: [ADR-0101](../../../docs/decisions/0101-coordinate-sales-delivery-with-inventory.md).

### `SAL-DLV-2` A delivery issues stockable products in the same transaction

Process's `OrderToCashService.deliverOrder` records the Sales delivery and, in the same transaction,
issues each stockable product through Inventory at moving average against `cost_of_goods_sold`, with
the delivery as source; service products move no stock. A failed issue rolls the delivery back, and a
retried delivery id returns the recorded result.
Why: [ADR-0101](../../../docs/decisions/0101-coordinate-sales-delivery-with-inventory.md),
[ADR-0100](../../../docs/decisions/0100-adopt-moving-average-inventory-valuation.md).

Phase 5 outcome (2026-11-24): this rule stays on its PostgreSQL transaction (ADR-0124). The staged
Alchemy model is test-only evidence, not a plan to move it.

## Position

Sales owns customers in their Sales role, price lists, quotations, sales orders, and delivery
evidence. It owns the meaning of order lines, derived totals, the quotation and order lifecycles, and
how much of an order has been delivered. The browser is a projection and command client; it does not
calculate authoritative totals, decide lifecycle eligibility, move stock, post journals, or bypass
authorization.

```text
Party customer relationship
   |
   v
Customer --(price list)--> Quotation: draft -> sent -> accepted | rejected | expired
                                   |
                                   v (convert accepted)
                             SalesOrder: draft -> confirmed -> cancelled
                                   |
                                   v (record delivery; Process issues stock)
                             Delivery DO/...  --> Billing invoices delivered quantity
```

Two service surfaces exist. `SalesService` is the original owner-local customer, quotation, and
order surface (create, confirm, cancel). `SalesDocumentService` carries the document flow above:
Party customers, price lists, quotation lifecycle and conversion, credit limits, deliveries, and
fulfillment.

## Authority matrix

| Fact or responsibility | Authority | Current rule |
| --- | --- | --- |
| Tenant and authenticated principal | Identity / API composition | Every service input includes tenant and principal context |
| Party identity, customer relationship, legal entity | Party | A document customer references an active Party customer relationship (`SAL-CUST-2`) |
| Customer in its Sales role, credit limit, price list assignment | Sales | Tenant-local, email-normalized |
| Price lists, quotations, sales orders, deliveries | Sales | PostgreSQL is the canonical source |
| Tax code selection and rates | Tax | Sales asks Tax for default codes; it computes no rate |
| Stock, availability, valuation, and movements | Inventory | Issued by Process on delivery (`SAL-DLV-2`); Sales item IDs are product references |
| Invoices, credit notes, receivables | Billing | Billing invoices delivered quantity and answers credit exposure (`SAL-CREDIT-1`) |
| Journals, accounts, periods | Accounting | Reached only through Billing and Inventory postings |
| Confirmation event envelope and outbox delivery | Messaging plus Sales event contract | Sales supplies event meaning; Messaging owns delivery |
| Delivery coordination across Sales and Inventory | Process (`order_to_cash`) | One transaction through public contracts |

No package may mutate Sales tables except Sales. Consumers use the public Sales package contract and
must not import `db/schema/sales.ts`, private stores, or Drizzle query types.

## Aggregate model

### Customer

A Customer contains a UUIDv7 identity, tenant, trimmed nonblank name, trimmed lowercase nonblank
email unique in the tenant, and, for a document customer, the Party, relationship, and legal entity
(`SAL-CUST-2`), an optional price list, and an optional credit limit (`SAL-CREDIT-1`). There is no
update, deletion, merge, contact history, or Party synchronization command. A retry with an unknown
response must reconcile by reading the record; it must not assume that no row was created.

### Quotation

A Quotation contains a UUIDv7 identity, tenant, customer and legal entity, status `draft`, `sent`,
`accepted`, `rejected`, or `expired`, a `validUntil` date, priced lines with list price, discount,
net unit price, and tax code, and a derived total (`SAL-QUOT-1`, `SAL-QUOT-2`). Revision of a sent
quotation and external customer acceptance are not supported.

### SalesOrder

A SalesOrder contains:

- UUIDv7 identity;
- tenant identity;
- tenant-local Customer identity;
- an optional tenant-local Quotation identity matching the same Customer;
- status `draft`, `confirmed`, or `cancelled`;
- confirmation timestamp and idempotency identity after confirmation;
- at least one immutable order line at the public snapshot boundary;
- opaque Inventory item UUIDs, positive PostgreSQL-bigint quantities, and exact two-decimal unit
  prices;
- a server-derived exact two-decimal total.

The public order DTO exposes line values, but not the private confirmation idempotency key. The
total is never accepted as an independent create input. Confirmed and cancelled orders preserve
their line snapshots and derived total.

## Lifecycle and capabilities

```text
absent -> draft -> confirmed -> cancelled
```

Only the transitions below are active:

| Operation              | Preconditions and effect                                                                                                                     | Capability               | Retry / failure behavior                                                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| list customers         | Return at most 200 tenant-local customers, optionally searched by name or email                                                              | `sales.customer.read`    | Safe repeat; foreign tenant rows are excluded                                                                                                    |
| get customer           | Return one tenant-local customer                                                                                                             | `sales.customer.read`    | Foreign tenant and missing records become `CustomerNotFound`                                                                                     |
| create customer        | Normalize and persist a tenant-local customer                                                                                                | `sales.customer.create`  | Tenant-email uniqueness maps to `CustomerAlreadyExists`                                                                                          |
| list quotations        | Return at most 200 tenant-local quotations, optionally filtered by customer/status                                                           | `sales.quotation.read`   | Safe repeat                                                                                                                                      |
| get quotation          | Return one tenant-local quotation                                                                                                            | `sales.quotation.read`   | Missing or foreign tenant records become `QuotationNotFound`                                                                                     |
| create quotation       | Require a tenant-local customer and persist a draft quotation                                                                                | `sales.quotation.create` | Missing customer becomes `CustomerNotFound`; no create idempotency key is stored                                                                 |
| list orders            | Return at most 200 tenant-local orders, optionally filtered by customer/status, with lines                                                   | `sales.order.read`       | Safe repeat; lines are loaded under the same tenant scope                                                                                        |
| get order              | Return one tenant-local order with lines                                                                                                     | `sales.order.read`       | Missing or foreign tenant records become `SalesOrderNotFound`                                                                                    |
| create order           | Require a tenant-local customer; if supplied, lock and validate the quotation/customer relationship; persist header and all lines atomically | `sales.order.create`     | Relational failures map to `CustomerNotFound`, `QuotationNotFound`, or `QuotationCustomerMismatch`; no create idempotency key is stored          |
| confirm order          | Lock the order, verify `draft`, record confirmation identity/time, and append `SalesOrderConfirmedEvent` in the owner transaction            | `sales.order.confirm`    | Same order and key return the existing result; conflicting reuse maps to `SalesOrderConfirmationIdempotencyConflict`; event replay is idempotent |
| cancel confirmed order | Lock the order and change `confirmed -> cancelled`; preserve confirmation metadata and lines                                                 | `sales.order.cancel`     | Cancellation is naturally idempotent for an already-cancelled order; draft/cross-tenant/missing cases fail typed                                 |

Authentication does not grant a capability. Authorization is evaluated before every protected read
or write and is tenant-scoped. The capability catalog remains closed and deny-by-default.

## Invariants and exact arithmetic

- Every stored identity is UUIDv7; existing UUIDv4 rows are not rewritten solely for version.
- Customer, quotation, order, and line references are tenant-local through composite constraints.
- Customer emails are trimmed and lowercased before persistence.
- Order quantities are positive decimal integer strings within PostgreSQL signed `BIGINT` range.
- Unit prices and totals use the shared `FinancialMajorAmount` boundary and exact two-decimal
  semantics. Sales uses `bigint` minor-unit arithmetic; floating point and implicit rounding are
  forbidden.
- `order.total = sum(quantity * unitPrice)` is validated by the public schema and enforced by the
  database transaction boundary.
- Draft orders have no confirmation timestamp. Confirmed and cancelled orders preserve confirmation
  metadata; status transitions cannot reopen a terminal order.
- Confirmed and cancelled order headers and lines are immutable except for the permitted terminal
  cancellation status change.
- The browser validates shape and tenant identity of responses, but backend state remains
  authoritative.

The amount schema and conversion utility are shared from the foundation boundary. Sales must not add
an independent decimal regex or money parser.

## Transactions, concurrency, and recovery

Customer and quotation creation use owner persistence with database constraint translation. Order
creation writes the header and all lines in one transaction, deriving the total from the submitted
lines. A failed line insert cannot leave a draft header behind.

Confirmation locks the order, reads its lines, checks status and idempotency, updates the header,
and invokes the Sales event append through Messaging in the same transaction boundary. A lost
response is resolved by reading the order or retrying the same idempotency key. A different key is
never invented for an uncertain confirmation.

Cancellation locks the order and serializes concurrent terminal updates. It has no separate
idempotency key because the current operation has no external side effect beyond the owner-local
terminal status; any future Inventory, Accounting, external-provider, or compensation effect must
introduce a new reviewed contract rather than silently extending this command.

The frontend uses non-optimistic mutations. After success it invalidates affected tenant-scoped
queries; after a network or malformed mutation response it reports an unknown outcome and offers a
reload/reconciliation path before retry. It never fabricates a local customer, quotation, or order.

## Public API and frontend boundary

The module's routes are declared in [`http.ts`](./http.ts) (ADR-0094), which is the authoritative
list; this document does not repeat it. Handlers decode transport input, obtain the principal and
tenant context, call only the public services, and encode tagged failures. The browser workspace uses
generated contracts from `tooling/frontend/contracts.ts`, scopes its cache by tenant, and reports an
unknown mutation outcome with a reload path instead of fabricating a local record.

## Events and cross-domain evolution

Sales publishes the typed `SalesOrderConfirmedEvent` only after the confirmation transaction has
accepted the order. The event carries the order ID and exact total with tenant, actor, command,
correlation, causation, and idempotency metadata. Consumers must treat it as an at-least-once
committed fact and remain idempotent. It is not evidence of a delivery, stock issue, or invoice;
deliveries are coordinated synchronously by Process (`SAL-DLV-2`) and Sales publishes no delivery
event.

## Maturity and deferred scope

Not supported, and not to be inferred from generic ERP expectations:

- customer update, deletion, merge, or contacts;
- quotation revision after sending, and external customer acceptance;
- order editing after creation, discounts outside quotation lines, multiple currencies, or payment
  terms on the order;
- customer returns: a customer credit note neither returns stock nor makes delivered quantity
  invoiceable again (Billing);
- external customer or provider transmission.

Add a contract, owner decision, authorization capability, invariant test, and recovery rule before
activating one.

## Implementation map

| Concern                                 | Owner path                                                                          |
| --------------------------------------- | ----------------------------------------------------------------------------------- |
| Public schemas and service contract     | `erp/modules/sales/src/contract.ts`                                                     |
| Public tagged errors                    | `erp/modules/sales/src/errors.ts`                                                       |
| Service authorization and orchestration | `erp/modules/sales/src/service.ts`                                                      |
| Semantic persistence port               | `erp/modules/sales/src/store.ts`                                                        |
| PostgreSQL implementation               | `erp/modules/sales/src/postgres.ts`                                                     |
| Deterministic memory implementation     | `erp/modules/sales/src/memory.ts`                                                       |
| Named production/test layers            | `erp/modules/sales/src/layers.ts`                                                       |
| Public package exports                  | `erp/modules/sales/mod.ts`                                                              |
| Capability constants                    | `erp/modules/sales/src/capabilities.ts`                                                 |
| Drizzle schema                          | `db/schema/sales.ts`                                                                |
| HTTP group, handlers, error mapping | `erp/modules/sales/http.ts` |
| Document flow service | `erp/modules/sales/src/documents.ts`, `erp/modules/sales/src/documents-contract.ts` |
| Delivery with stock issue | `erp/modules/process/src/order-to-cash.ts` |
| Generated browser contracts             | `tooling/frontend/contracts.ts`, `apps/web/src/shared/contracts/generated/sales.ts` |
| Browser service/query/workspace         | `apps/web/src/features/sales/`, `apps/web/src/app/modules/sales.tsx`                  |
| Domain contract tests                   | `erp/modules/sales/tests/sales.test.ts`                                                 |
| PostgreSQL invariant/publication tests  | `erp/modules/sales/tests/sales.postgres.test.ts`                                        |
| HTTP contract test                      | `erp/runtime/api/sales.integration.test.ts`                                             |
| Browser/Axe workflow test               | `tests/frontend/sales-workflow.test.ts`                                             |

Persistence tables, confirmation keys, repository implementations, event delivery infrastructure,
and database error details remain private to their owning boundaries.
