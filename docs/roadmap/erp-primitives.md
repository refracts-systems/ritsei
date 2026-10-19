# ERP Primitive Decision Roadmap

> **Status:** Canonical roadmap subdocument
>
> **Track ID:** `erp`
>
> **Owns:** readiness and decision sequencing for reusable ERP primitives.
>
> **Measured by:** `erp.p0`–`erp.p3` exit evidence (reviewed; the mechanical evaluator was retired by ADR-0089).
>
> **Detailed rules belong to:** the owning domain architecture, schema, ADR, or public contract.
>
> **Related documents**
>
> - Roadmap index: [`./README.md`](./README.md)
> - Semantic ownership:
>   [`../decisions/0015-one-semantic-owner-per-invariant.md`](../decisions/0015-one-semantic-owner-per-invariant.md)
> - PostgreSQL architecture:
>   [`../architecture/postgresql-19-architecture.md`](../architecture/postgresql-19-architecture.md)
> - Authorization architecture:
>   [`../architecture/authorization.md`](../architecture/authorization.md)
> - Process Studio architecture:
>   [`../architecture/process-studio.md`](../architecture/process-studio.md)
> - Plugin architecture:
>   [`../architecture/plugin-architecture.md`](../architecture/plugin-architecture.md)

## Scope

An ERP primitive is ready for Process Studio composition only when its meaning is stable across
contracts, persistence, authorization, events, and correction behavior. A primitive does not
automatically require a package; package boundaries follow invariant ownership.

## Decision states

| State     | Meaning                                                                      |
| --------- | ---------------------------------------------------------------------------- |
| `KNOWN`   | The repository already establishes the semantic rule.                        |
| `PARTIAL` | An implementation exists but the cross-domain contract is incomplete.        |
| `UNKNOWN` | A material decision cannot be recovered from the repository.                 |
| `DECIDED` | An ADR or canonical document selected the rule.                              |
| `READY`   | The selected rule has contracts, executable proof, and operational behavior. |

`UNKNOWN` blocks dependent runtime work. It is never permission to guess.

## Primitive backlog

| Primitive                   | Current state                   | Evidence                                                         | Deferred scope                                                                        |
| --------------------------- | ------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Scope and organization      | `READY` bounded baseline        | tenant, Organization, Legal Entity, Branch, Warehouse            | new scope requires an owner and superseding decision                                  |
| Party and relationships     | `READY` P0 baseline             | PartyRole, PartyRelationship, PartyRepresentation                | employee-specific policy                                                              |
| Product/service and UOM     | `READY` P1 baseline             | immutable stock UOM and typed whole-number stock                 | conversion, fractional stock, services, classification                                |
| Location and resource       | `READY` P1 baseline             | Legal Entity-scoped Warehouse                                    | bins, staging, routing, manufacturing resources                                       |
| Document and lifecycle      | `READY` bounded P2 baseline     | owner-local orders, reservations, transfers, journals, reversals | new document families need owner-specific rules                                       |
| Quantity and movement       | `READY` P1 baseline             | non-negative balances, reservations, transfers, corrections      | lot/serial, valuation, fractional quantity                                            |
| Money and obligation        | `READY` bounded P2 baseline     | base-currency, fixed two-decimal revenue posting                 | tax, invoices, AP/AR, payments, FX, settlement                                        |
| Financial execution         | `DECIDED` migration gated       | TigerBeetle target; PostgreSQL control plane                     | activation follows financial-ledger-execution.md |
| Fiscal period and close     | `READY` bounded P2 baseline     | non-overlapping open/closed periods                              | reopen, adjusting periods, advanced close                                             |
| Policy and authorization    | `READY` for current actions     | capability catalog, scope checks, deny-by-default                | object authorization, approval, override, SoD                                         |
| Business surface ergonomics | `PLANNED`                       | owner-local documents and explicit actions                       | generated structural tooling                                                          |
| Audit and correlation       | `READY` bounded P3 baseline     | actor, tenant, command, correlation, causation, idempotency      | retention and external-provider audit                                                 |
| Typed actions and events    | `READY` selected Level 3 slices | Inventory, Sales, Accounting, Party, Identity, Procurement       | broader actions remain domain-gated                                                   |
| Compensation and recovery   | `READY` bounded lifecycle       | reservation release, revenue reversal, manual recovery           | returns, credits, external compensation                                               |

## Sequence

### P0 — Scope and User Accounts

**P0 baseline status: `READY`.** All P0-01 through P0-10 tasks have public contracts and executable
proof.

The baseline is defined by
[`0021-define-p0-scope-and-identity-model.md`](../decisions/0021-define-p0-scope-and-identity-model.md)
and the public vocabulary decision in
[`0029-rename-user-and-party-public-vocabulary.md`](../decisions/0029-rename-user-and-party-public-vocabulary.md).
The bounded slice covers tenant timezone, Organization, Legal Entity, optional Branch, Warehouse,
PartyRepresentation, external identifiers, and bootstrap composition.

Required scope facts:

```text
tenant
legal entity/company
branch
warehouse/location
party/customer/supplier
internal vs external identifiers
currency and timezone scope
```

#### P0 task board

| ID      | Required proof                                                                              |
| ------- | ------------------------------------------------------------------------------------------- |
| `P0-01` | Freeze vocabulary and semantic ownership for scope and identity facts.                      |
| `P0-02` | Composite constraints and negative tests reject cross-tenant/entity references.             |
| `P0-03` | UserAccount membership and capability context are tenant-aware.                             |
| `P0-04` | Organization and Legal Entity lifecycle is owner-local and constrained.                     |
| `P0-05` | Branch metadata does not become a new ledger or fiscal-period owner.                        |
| `P0-06` | Warehouse stock ownership is bound to Legal Entity.                                         |
| `P0-07` | Accounting owns Legal Entity currency, precision, period, and posting configuration.        |
| `P0-08` | Party roles and Legal Entity relationships are eligibility facts, not grants.               |
| `P0-09` | Internal/external identifiers are stable, scoped, and contract-tested.                      |
| `P0-10` | Bootstrap succeeds and duplicate, unauthorized, cross-scope, and conflict cases fail typed. |

Exit criteria: all ten tasks have executable proof; historical rows require explicit
operator-supplied mapping and no migration infers ownership. The bootstrap proof covers sequencing
and typed failures, not cross-domain atomic provisioning, which remains outside the P0 slice under
[`ADR-0028`](../decisions/0028-complete-p0-identity-party-and-branch-metadata.md).

### P0 migration cohort gate

**Registry gate:** `erp.p0-migration`

Clean installs may have no legacy rows. An upgrade cohort must use an operator-supplied mapping file
with exact tenant/resource coverage. The backfill rejects missing, duplicate, and unknown mappings
before changing any row, runs in one transaction, preserves row identity, and never infers Legal
Entity ownership.

**Exit:** `erp/runtime/migrator/p0-backfill.ts` and its executable test prove exact coverage and typed
failure for each mapping error; the reviewed vocabulary and ownership decisions remain stable.

### P1 — Product, Quantity, and Location

The baseline is decided by
[`0035-define-p1-inventory-primitives.md`](../decisions/0035-define-p1-inventory-primitives.md):
Inventory owns discrete stock Items with one immutable stock UOM, whole-number quantities,
Warehouse-level location, no negative stock, and append-oriented corrections. Unit conversion,
fractional stock, bins, lot/serial traceability, and valuation remain out of scope.

Exit criteria:

- quantity inputs and outputs have typed units;
- movement facts are append-oriented or compensated;
- reservations and availability are concurrency-safe;
- location and ownership constraints are database-enforced.

### P2 — Documents and Financial Semantics

The baseline is decided by
[`0036-define-p2-document-and-financial-baseline.md`](../decisions/0036-define-p2-document-and-financial-baseline.md):
documents remain owner-local; economic facts are corrected by new commands and reversals; the
current posting flow is single-Legal-Entity, base-currency, fixed two-decimal money. Tax, invoices,
AP/AR, payments, settlement, reopen, and adjusting periods remain out of scope.

The bounded Procurement document follows
[`../architecture/procurement.md`](../architecture/procurement.md) and ADR-0044/0045. Receipt
ownership and its concurrency with cancellation remain separate gates.

Exit criteria:

- document transitions have preconditions, effects, authorization, and retry behavior;
- accounting facts cannot be rewritten to hide correction;
- financial actions declare reversal or manual recovery;
- period rules are transactional.

### P3 — Audit, Events, and Integration

**P3 baseline status: `READY` for the bounded PostgreSQL-internal baseline.** Inventory stock
correction and Accounting revenue posting publish owner-controlled PUBLIC v1 events atomically;
Process publishes only its own lifecycle facts; completed receipts make local delivery
duplicate-safe.

The baseline is defined by
[`0037-define-p3-audit-event-and-delivery-boundary.md`](../decisions/0037-define-p3-audit-event-and-delivery-boundary.md)
and
[`0038-move-internal-event-delivery-to-messaging.md`](../decisions/0038-move-internal-event-delivery-to-messaging.md).
Messaging owns envelope/outbox/receipt infrastructure; domain owners retain fact meaning. PgQue,
external connectors, event waits, and deployment-specific retention remain gated.

Exit criteria:

- committed facts publish typed versioned events atomically where required;
- consumers and process waits are idempotent;
- audit records preserve actor, tenant, command, state, and correlation;
- external standards remain behind versioned adapters.

## Measures

| Measure                                             | Target                     |
| --------------------------------------------------- | -------------------------- |
| `erp.p0`–`erp.p3` and `erp.p0-migration`             | `PASS`                     |
| `open_unknown_decisions`                            | `0` for the selected scope |
| primitive packages created only for new invariants  | `100%`                     |
| selected public actions with executable owner proof | `100%`                     |

Run the focused tests that prove each primitive; do not use a prose checkbox as proof.

## Stop conditions

Stop dependent work when a material primitive is `UNKNOWN`, ownership is ambiguous, a cross-scope
constraint is missing, a legacy mapping is inferred or not exact, a committed effect has no correction
path, or a new package would only mirror an existing owner.
