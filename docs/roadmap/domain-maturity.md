# Domain Maturity Roadmap

> **Status:** Canonical roadmap subdocument
>
> **Track ID:** `domain`
>
> **Owns:** readiness sequencing for packages that may publish Process Studio commands and events.
>
> **Measured by:** `domain.*` exit evidence (reviewed; the mechanical evaluator was retired by ADR-0089).
>
> **Detailed rules belong to:** each package’s public contract, schema, tests, and subsystem
> architecture.
>
> **Related documents**
>
> - Roadmap index: [`./README.md`](./README.md)
> - ERP primitives: [`./erp-primitives.md`](./erp-primitives.md)
> - Architecture enforcement:
>   [`../architecture/architecture-enforcement.md`](../architecture/architecture-enforcement.md)
> - Authorization: [`../architecture/authorization.md`](../architecture/authorization.md)
> - Testing strategy: [`../development/testing.md`](../development/testing.md)
> - Process Studio architecture:
>   [`../architecture/process-studio.md`](../architecture/process-studio.md)
> - Integration architecture:
>   [`../architecture/integration-architecture.md`](../architecture/integration-architecture.md)

## Scope

A package is a Process Studio provider only when the requested action has a stable public contract
and executable invariant proof. A directory, table, or scaffold is not maturity evidence.

## Provider contract

Each Level 3 action must have, as applicable:

```text
public Effect contract and Effect Schema DTOs
stable tagged failures
capability, tenant, and object scope
relationship/object authorization
transaction, concurrency, idempotency, and retry semantics
compensation or manual recovery
versioned action and event catalog entries
contract, database, and compatibility tests
```

Maturity is action-level. A package may remain `PARTIAL` while one narrow action is a Level 3
provider; sibling commands do not inherit that status.

## Package matrix

| Package         | Current posture                                         | Next measurable gate                                                              |
| --------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `kernel`        | `FOUNDATION`                                            | stable transaction boundary, probes, and capability-level failures                |
| `catalog`       | `FOUNDATION`                                            | remain a dependency leaf; aggregation belongs to Process Studio                   |
| `messaging`     | `FOUNDATION`                                            | PgQue only after its activation gates pass                                        |
| `auth`          | `FOUNDATION`                                            | provider assertion and principal-provenance tests                                 |
| `authorization` | `FOUNDATION`                                            | scoped grants, relationship checks, SoD, explainable denial, fail-closed behavior |
| `identity`      | `PARTIAL`; `identity.user_account.create` v1 is Level 3 | keep account lifecycle separate from provider roles                               |
| `party`         | `PARTIAL`; `party.create` v1 is Level 3                 | mature customer/supplier/employee relationship contracts                          |
| `inventory`     | `PARTIAL`; `inventory.stock.adjust` v1 is Level 3       | keep broader actions private until catalog/event proof exists                     |
| `accounting`    | `PARTIAL`; revenue post/event v1 are Level 3            | migrate only the bounded slice after financial gates                              |
| `sales`         | `PARTIAL`; `sales.order.confirm` v1 is Level 3          | keep invoicing, returns, and credit policy gated                                  |
| `procurement`   | `PARTIAL`; purchase-order confirm v1 is Level 3         | mature receipt correction/return and publication proof                            |
| `billing`       | `NOT READY`; scaffold only                              | decide invoice, payment, receivable, settlement, and ownership                    |
| `integrations`  | `BOUNDARY ONLY`                                         | implement versioned adapters and delivery reliability                             |
| `process`       | `PARTIAL`; bounded order coordinator                    | stay behind public contracts; not a new domain owner                              |
| `workflow`      | `PLANNED`                                               | create only after Process Studio gates are approved                               |

## Maturity levels

| Level                        | Required evidence                                                                               | Process Studio use            |
| ---------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------- |
| `0` Scaffold                 | package/schema exists                                                                           | not a provider                |
| `1` Domain Contract          | public contract, DTOs, failures, scope, authorization, schema checks                            | internal use only             |
| `2` Transactional Capability | atomicity, constraints, concurrency, retry, idempotency, correction/recovery                    | internal use only             |
| `3` Process Provider         | versioned catalog action/event, compatibility, process-safe failures, correlation, compensation | eligible bounded action/event |

Plugins follow the same levels plus their trust-level rules. Installation never makes a capability
Process Studio-ready.

## Sequence

### D0 — Stabilize foundations

`kernel`, `identity`, `auth`, `authorization`, and `party` establish scope, principals, permission
ownership, party roles, identifiers, transactions, failure mapping, and audit/correlation. The
registered D0 gates make the identity and authorization evidence explicit before Level 3 provider
counts can unlock later Process Studio work.

#### D0.1 — Identity lifecycle (`domain.identity-lifecycle`)

Prove disabled-account behavior, session invalidation, active/suspended tenant membership, membership
revocation, and fail-closed authentication/tenant mapping. Provider-local identity remains separate
from the RITSEI UserAccount and tenant membership.

#### D0.2 — Authorization foundation (`domain.authorization-foundation`)

Prove the ordered authorization boundary beyond direct grants: scoped capability, relationship/object checks,
domain policy, Separation of Duties, explainable denial, and fail-closed handling for unknown, stale,
or unavailable results. The current direct-grant baseline does not silently satisfy these
additional target layers.

#### D0.3 — Capability grammar (`domain.capability-grammar`)

Keep the owner/resource/business-verb grammar canonical, migrate legacy identifiers explicitly, and
reject topology, broad, nested, or provider-shaped capability names. Workload class and deployment
metadata never enter capability IDs.

**Exit:** the three D0 gates pass with owner-local contracts, scope constraints, authorization proofs,
and boundary checks before Level 3 provider registration proceeds.

### D1 — Complete the economic core

`inventory`, `accounting`, `sales`, `procurement`, and `billing` are developed only for requested
end-to-end paths. Purchase-to-pay and order-to-cash ownership must cover the needed supplier,
customer, order, receipt/fulfillment, invoice, payment, and correction facts without creating a
universal document owner.

Procurement currently owns the bounded SupplierAccount, PurchaseOrder, and GoodsReceipt slices
specified by [`../architecture/procurement.md`](../architecture/procurement.md). Receipt correction,
returns, invoice match, payables, and settlement remain gated.

**Exit:** every selected action passes the primitive readiness test and has a narrow public
contract.

#### Procurement follow-on gates (unregistered)

Purchase-order confirmation does not imply Goods Receipt maturity. Register separate provider gates
when requested and owned for receipt correction, returns, committed event publication, and a
Procurement Level 3 action/event pair. Each gate must add its own transaction, authorization,
correction/recovery, compatibility, and database evidence.

### D2 — Publish catalog providers

For each selected action:

- register a versioned catalog entry and schemas;
- declare capability, tenant scope, idempotency, transaction, and recovery semantics;
- publish a typed event for process-visible committed facts; and
- prove catalog metadata matches the public contract.

**Exit:** at least two domains have Level 3 actions and no provider leaks private persistence or
infrastructure errors.

### D3 — Add operational domains only by evidence

Manufacturing, quality, assets, maintenance, projects, field service, and HR/payroll remain
optional. Create a package only when a requested capability has an invariant that cannot remain in
an existing owner.

## Measured Level 3 slices

| Domain        | Action/event evidence                                                         |
| ------------- | ----------------------------------------------------------------------------- |
| `identity`    | `identity.user_account.create` → `identity.user_account.created`              |
| `party`       | `party.create` → `party.created`                                              |
| `inventory`   | `inventory.stock.adjust` → `inventory.stock.corrected`                        |
| `accounting`  | `accounting.revenue.post` → `accounting.revenue.posted`                       |
| `sales`       | `sales.order.confirm` → `sales.order.confirmed`                               |
| `procurement` | `procurement.purchase_order.confirm` → `procurement.purchase_order.confirmed` |

Each `domain.<domain>.level3` gate represents exactly the action/event pair listed above, not
package-wide maturity. Add a separate measured gate for another action instead of silently widening
an existing gate. These six slices do not make all package commands process-safe, activate PgQue, or
activate the external connector or workflow runtime.

## Measures

| Measure                                | Target                                              |
| -------------------------------------- | --------------------------------------------------- |
| `domain.*` foundation and Level 3 gates | `PASS` before Process Studio catalog work          |
| `level3_capabilities`                  | `>= 2` before Process Studio catalog work           |
| selected action contract/test coverage | `100%`                                              |
| provider boundary violations           | `0`                                                 |
| `partial_committed_packages`           | visible and reviewed, not silently treated as ready |

## Stop conditions

Stop provider registration when the action lacks an owner, public failure model, authorization,
transaction/idempotency proof, typed event, correction/recovery path, or compatibility test. Stop D0
promotion when relationship/object, Separation of Duties, explainable denial, or stale/unknown
fail-closed evidence is missing. Do not turn the package table into a promise to implement every ERP
functional area.
