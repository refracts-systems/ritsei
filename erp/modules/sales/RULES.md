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
names an unknown rule. The sections after this one are the former Sales architecture document; they
are not yet split into identified rules.

> **Known stale:** the Aggregate model, Public API, Events, and Maturity sections below predate
> [ADR-0099](../../../docs/decisions/0099-make-sales-customers-party-roles.md),
> [ADR-0101](../../../docs/decisions/0101-coordinate-sales-delivery-with-inventory.md), and
> [ADR-0102](../../../docs/decisions/0102-split-billing-and-settlement.md): customers are party roles,
> and deliveries and invoicing exist in the code. Until those sections are rewritten, the code and
> those ADRs win on customers, fulfillment, and invoicing.

### `SAL-ORDER-1` Orders move only draft, confirmed, cancelled

A confirmed or cancelled order keeps its confirmation metadata, and its header and lines are
immutable except for the cancellation status change; no transition reopens a terminal order.
PostgreSQL rejects orphaned confirmation metadata and changes to confirmed snapshots and totals.

### `SAL-ORDER-2` Confirmation is idempotent and publishes one event

Confirming with the same idempotency key returns the recorded result and one
`SalesOrderConfirmedEvent`; a different key after confirmation fails with
`SalesOrderConfirmationIdempotencyConflict`. The event is appended in the confirmation transaction,
so a failed append rolls the confirmation back.

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

### `SAL-CREDIT-2` Credit checks for one customer run one at a time

Confirmation locks the customer row before it reads the exposure, so of two orders that each fit the
limit but not together, only one is confirmed.

## Position

Sales owns tenant-local customer records, quotations, and sales orders. It owns the meaning of order
lines, derived totals, and the order lifecycle. The browser is a projection and command client; it
does not calculate authoritative totals, decide lifecycle eligibility, reserve stock, post journals,
or bypass authorization.

The implemented bounded surface is:

```text
Customer
   |
   +--> Quotation: draft -> [future owner-controlled quotation transitions]
   |
   +--> SalesOrder: draft -> confirmed -> cancelled
```

The quotation status vocabulary already reserves `sent`, `accepted`, `rejected`, and `expired`, but
this slice exposes only draft quotation creation and read queries. No unsupported quotation
transition is synthesized in the API or frontend.

ADR-0033 defines a larger gated order-confirmation workflow involving Inventory and Accounting. The
current Sales provider slice exposes owner-local order confirmation and the owner-published
`SalesOrderConfirmedEvent`; it does not claim that Inventory reservation, revenue posting, or a
cross-domain cancellation workflow is active until those public contracts and atomicity tests are
composed.

## Authority matrix

| Fact or responsibility                                                 | Authority                           | Current rule                                                                                   |
| ---------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| Tenant and authenticated principal                                     | Identity / API composition          | Every service input includes tenant and principal context                                      |
| Customer identity in the current slice                                 | Sales                               | Customer rows are tenant-local and email-normalized                                            |
| Party identity or supplier relationship                                | Party                               | Sales does not mutate Party tables or import Party persistence                                 |
| Quotation identity, customer link, status, and total                   | Sales                               | Creation starts in `draft`; reads expose the bounded status vocabulary                         |
| Sales order identity, customer link, line snapshots, status, and total | Sales                               | PostgreSQL is the canonical source for the current provider                                    |
| Stock, availability, reservations, warehouses, and movements           | Inventory                           | Sales item IDs are opaque references; Sales does not become stock authority                    |
| Revenue journals, periods, accounts, and settlement                    | Accounting / financial owner        | Not invoked by this owner-local frontend/API slice                                             |
| Confirmation event envelope and outbox delivery                        | Messaging plus Sales event contract | Sales supplies event meaning; Messaging owns delivery infrastructure                           |
| Workflow coordination                                                  | Process                             | No Process route or direct Process table access is added here                                  |
| Customer, quotation, and order browser state                           | TanStack Solid Query                | Cache is tenant-scoped; mutation responses are reconciled, not optimistically treated as facts |

No package may mutate Sales tables except Sales. Consumers use the public Sales package contract and
must not import `db/schema/sales.ts`, private stores, or Drizzle query types.

## Aggregate model

### Customer

A Customer contains:

- UUIDv7 identity;
- tenant identity;
- trimmed, nonblank name;
- trimmed lowercase, nonblank email;
- a tenant-scoped unique email constraint.

Customer creation is ordinary owner-local creation. A customer may carry a party role and legal
entity (ADR-0099) and a credit limit (`SAL-CREDIT-1`). There is no update, deletion, merge, contact
history, tax profile, or Party synchronization command in the current public contract.
A retry with an unknown response must reconcile by reading the tenant-local collection or record; it
must not assume that no row was created.

### Quotation

A Quotation contains:

- UUIDv7 identity;
- tenant identity;
- tenant-local Customer identity;
- status `draft`, `sent`, `accepted`, `rejected`, or `expired`;
- exact non-negative two-decimal total.

The current public commands create only a draft quotation and read quotations. Quotation status
transitions, line snapshots, expiry policy, approvals, taxes, discounts, currency, and external
customer acceptance remain outside this slice.

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

The Effect HTTP API exposes the following tenant-scoped paths through the `Sales` group:

```text
GET  /sales/customers
GET  /sales/customers/:id
POST /sales/customers
GET  /sales/quotations
GET  /sales/quotations/:id
POST /sales/quotations
GET  /sales/orders
GET  /sales/orders/:id
POST /sales/orders
POST /sales/orders/:id/confirm
POST /sales/orders/:id/cancel
```

Handlers decode transport input, obtain the authenticated principal and tenant context, invoke only
the public `SalesService`, and encode tagged failures. They do not expose tables or repositories.

The connected SolidJS 2 workspace uses generated browser contracts from
`tooling/frontend/contracts.ts`. It provides bounded customer, quotation, and order projections;
customer/quotation/order creation; order confirmation and cancellation; detail views; server-side
filters; tenant and bearer headers; TanStack Solid Query invalidation; accessible RITSEI Dialog
wrappers; and explicit unknown-outcome recovery. It does not provide unsupported customer updates,
quotation transitions, order edits, fulfillment, returns, credits, stock operations, or accounting
posting.

## Events and cross-domain evolution

Sales publishes the typed `SalesOrderConfirmedEvent` only after the owner confirmation transaction
has accepted the order. The event carries the order ID and exact total plus tenant, actor, command,
correlation, causation, and idempotency metadata through the shared envelope. Consumers must treat
it as an at-least-once committed fact and remain idempotent.

The event is not evidence that Inventory has reserved stock, Accounting has posted a journal, or a
Process workflow has completed. A future cross-domain order-confirmation workflow must call public
contracts, preserve each domain's authority, define accepted/unknown/reconciliation/compensation
states, and pass its own transaction and integration gates.

## Maturity and deferred scope

The current Sales provider is a bounded owner-local Level 3 slice for the selected action/event
surface, with PostgreSQL and memory implementations, authorization tests, event publication tests,
and public HTTP/browser contract coverage. This is not a claim that the whole Sales roadmap is
complete.

Deferred or explicitly unselected scope includes:

- quotation send, accept, reject, expiry, revision, and customer acceptance;
- customer update, deletion, merge, contacts, tax, pricing, or Party synchronization;
- order editing after creation, fulfillment, return, credit, tax, discount, currency, or payment;
- Inventory reservation/availability as part of the current frontend/API confirmation path;
- Accounting revenue journals, receivables, period policy, settlement, and financial cutover;
- Process Studio action/event catalog expansion or workflow routes;
- external customer or provider transmission.

No deferred item may be inferred from generic ERP expectations. Add a contract, owner decision,
authorization capability, invariant proof, correction/recovery rule, and documentation before
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
| HTTP API definition                     | `erp/runtime/api/api.ts`                                                                |
| HTTP handlers                           | `erp/runtime/api/handlers.ts`                                                           |
| Generated browser contracts             | `tooling/frontend/contracts.ts`, `apps/web/src/shared/contracts/generated/sales.ts` |
| Browser service/query/workspace         | `apps/web/src/features/sales/`, `apps/web/src/app/sales-route.tsx`                  |
| Domain contract tests                   | `erp/modules/sales/tests/sales.test.ts`                                                 |
| PostgreSQL invariant/publication tests  | `erp/modules/sales/tests/sales.postgres.test.ts`                                        |
| HTTP contract test                      | `erp/runtime/api/sales.integration.test.ts`                                             |
| Browser/Axe workflow test               | `tests/frontend/sales-workflow.test.ts`                                             |

Persistence tables, confirmation keys, repository implementations, event delivery infrastructure,
and database error details remain private to their owning boundaries.
