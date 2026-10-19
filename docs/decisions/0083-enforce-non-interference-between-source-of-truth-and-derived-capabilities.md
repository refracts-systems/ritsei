# ADR-0083: Enforce Non-Interference Between Source-of-Truth Domains and Derived Capabilities

- Status: Superseded
- Date: 2026-09-06
- Amends: ADR-0034 by extending non-interference from overload isolation to semantic, execution, failure, storage, and UX boundaries
- Compatible with: ADR-0015, ADR-0037, ADR-0038, ADR-0043, ADR-0057, ADR-0068, ADR-0081, ADR-0082
- Supersedes: None
- Superseded by: ADR-0091 (framework reset)
- Target design retained by: ADR-0093 (inactive until an activation ADR)

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Canonical architecture: [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)
> - Architecture overview: [`../architecture/overview.md`](../architecture/overview.md)
> - State and consistency: [`../architecture/state-and-consistency.md`](../architecture/state-and-consistency.md)
> - Messaging and committed delivery: [`../architecture/pgque-messaging.md`](../architecture/pgque-messaging.md)
> - Document rendering: [`../architecture/document-rendering.md`](../architecture/document-rendering.md)
> - Process Studio and workflow: [`../architecture/process-studio.md`](../architecture/process-studio.md)
> - Search architecture: [`../architecture/search-architecture.md`](../architecture/search-architecture.md)
> - External integration surface: [`../architecture/integration-architecture.md`](../architecture/integration-architecture.md)
> - Communication platform: [`../architecture/communication.md`](../architecture/communication.md)
> - One semantic owner per invariant: [`./0015-one-semantic-owner-per-invariant.md`](./0015-one-semantic-owner-per-invariant.md)
> - Non-interference overload isolation:
>   [`./0034-adopt-non-interference-overload-isolation.md`](./0034-adopt-non-interference-overload-isolation.md)
> - Audit, event, and delivery boundary:
>   [`./0037-define-p3-audit-event-and-delivery-boundary.md`](./0037-define-p3-audit-event-and-delivery-boundary.md)
> - Internal messaging ownership:
>   [`./0038-move-internal-event-delivery-to-messaging.md`](./0038-move-internal-event-delivery-to-messaging.md)
> - Document AST platform: [`./0081-adopt-document-ast-rendering-platform.md`](./0081-adopt-document-ast-rendering-platform.md)
> - Communication platform: [`./0082-adopt-communication-platform-boundaries.md`](./0082-adopt-communication-platform-boundaries.md)

## Context

RITSEI has two related but different architecture concerns:

1. **Semantic authority:** which capability owns the current business fact and invariant.
2. **Operational isolation:** which workload, resource, and failure boundaries protect that fact.

ADR-0034 establishes non-interference as the overload-isolation target for protected command work.
The same rule must also govern document rendering, communication, workflow projections, audit
projections, search, analytics, reporting, and other capabilities derived from source-of-truth
domains.

A Purchase Order page illustrates the boundary:

```text
Purchase Order
├── current status, supplier, lines, amount  → Procurement authority
├── change history                           → domain/audit facts
├── notes                                    → Note capability
├── attachments                              → Attachment/Document capability
├── approvals                                → Process/Workflow capability
├── generated PDF                            → Document Platform artifact
└── supplier email                           → Communication + DeliveryAttempt
```

The UI may present those records together, but a timeline database, email provider, PDF renderer,
workflow runtime, search index, or analytics projection must not become a hidden dependency of the
authoritative Purchase Order read or approval transaction.

## Decision

RITSEI enforces **non-interference between source-of-truth capabilities and derived capabilities**.

> A source-of-truth capability must remain readable and operational when unrelated derived
> capabilities are delayed, degraded, rebuilding, retrying, or unavailable.

> Derived capabilities consume authoritative facts asynchronously and own their persistence,
> execution, retry, resource budget, and failure lifecycle.

A synchronous cross-capability dependency is permitted only when it represents an explicit business
invariant owned and documented by the relevant domain. It must not exist merely because a screen wants
to display related information together.

### Capability classes

#### Class A — source-of-truth critical

Examples:

```text
Sales Orders
Purchase Orders
Invoices
Accounting Entries
Inventory Balances
Payments
Authorization Decisions
```

Class A capabilities own business meaning, current state, authorization, invariant enforcement,
correction behavior, and critical read/write paths.

#### Class B — derived operational

Examples:

```text
Communication
DeliveryAttempt
Document generation
Workflow execution status projection
External integration delivery
Notification dispatch
```

Class B capabilities consume committed facts, perform bounded asynchronous work, retry independently,
and expose operational status without becoming the source of the business fact.

#### Class C — UX and analytical projections

Examples:

```text
Activity Timeline
Search indexes
Dashboard projections
Analytics
Reporting read models
```

Class C capabilities are eventually consistent and rebuildable. They are query aids, not business
authority.

### Critical read paths

A Class A read contains only the dependencies required to answer the authoritative question:

```text
GET /purchase-orders/:id
  → authentication and authorization
  → Procurement application service
  → Procurement repository/store
  → Purchase Order source of truth
```

It must not synchronously hydrate:

```text
Communication
Timeline
Document renderer or object storage
Workflow projection
Search index
Analytics
External provider
```

A composite or BFF endpoint may compose optional secondary sections, but it must preserve independent
failure boundaries and partial-response semantics. The core entity must not become unavailable because
an optional section is unavailable.

### Critical write paths

A source-of-truth mutation commits its owner-local invariant and durable fact publication first:

```text
BEGIN
  validate and authorize owner command
  update source-of-truth state
  append domain event / outbox record
COMMIT

outbox
  → Messaging
  → derived consumers
```

Approval, invoice issue, inventory receipt, and journal posting must not synchronously render a PDF,
send an email, update a timeline projection, update search, call an external provider, or refresh
analytics before the authoritative transaction commits.

### Derived failure isolation

Derived failures remain local:

```text
email provider unavailable      → Communication: RETRYING
PDF renderer unavailable        → DocumentArtifact: FAILED
Timeline projector behind      → Timeline: projection lagging
Search index stale              → Search: stale candidate results
```

The source record remains authoritative:

```text
Purchase Order: APPROVED
Invoice: ISSUED
Inventory movement: COMMITTED
```

`UNKNOWN` external outcomes remain local to the delivery attempt and do not become an unknown state
of the source domain.

### Event and dependency direction

The legal direction is:

```text
Source-of-truth domain
        ↓
Committed fact / transactional outbox
        ↓
Messaging
        ↓
Derived capabilities
```

Derived capabilities may depend on earlier derived artifacts when the dependency does not block the
source domain:

```text
DocumentArtifactReady
        ↓
Communication delivery
```

The resulting graph must remain a DAG. A derived capability must not synchronously call back into a
source domain merely to make its projection or delivery work, and a source domain must not read a
projection as its own authority.

### Storage and query ownership

Shared PostgreSQL placement does not create shared semantic ownership:

```text
sales tables
procurement tables
communication tables
timeline projection tables
document metadata
workflow tables
```

Each capability owns its tables and public contracts. Core entity queries must not use arbitrary
cross-domain joins to hydrate secondary information. Search may return candidate IDs; the owning
domain revalidates sensitive reads and commands.

### Progressive composition and UX

Frontend and BFF composition distinguish required from optional data:

```text
Purchase Order core       → critical, immediate
Timeline                  → secondary, asynchronous
Documents                 → secondary, asynchronous
Communications            → secondary, asynchronous
Workflow                  → secondary, asynchronous
```

A secondary failure renders a local degraded state with retry or freshness metadata. It does not
fail the whole page. Separate query keys and independent cache invalidation preserve those failure
boundaries.

### Resource and workload isolation

Asynchronous separation alone is insufficient. Derived work must also have bounded budgets for:

```text
CPU
memory
PostgreSQL connections
worker slots
queue capacity
network
storage I/O
```

ADR-0034 and `workload-isolation.md` remain the detailed authority for command reserves, workload
planes, WorkloadCells, credentials, admission, ceilings, bulkheads, backpressure, and proof of
physical isolation. This ADR adds the rule that those resource claims protect Class A source-of-truth
paths from Class B and Class C work.

### Consistency placement

Strong consistency belongs inside the semantic owner that requires the invariant:

```text
inventory reservation
journal posting
approval authority
payment application
```

Projection freshness, email delivery, search freshness, timeline freshness, and document readiness
do not prove source-of-truth correctness. Their freshness and `as_of` metadata must be explicit when
callers need to understand lag.

## Relationship to existing decisions

| Decision | Relationship |
| --- | --- |
| ADR-0015 | Keeps one semantic owner per invariant; derived capabilities cannot become competing authorities |
| ADR-0034 | Remains the detailed overload/resource non-interference decision; this ADR broadens its system-level scope |
| ADR-0037 | Keeps audit, domain events, and external delivery as distinct records and boundaries |
| ADR-0038 | Uses Messaging and transactional outbox for committed facts and fan-out |
| ADR-0043 | Keeps analytics rebuildable and outside the source-domain write path |
| ADR-0057 | Requires independent frontend query/cache boundaries for core and secondary data |
| ADR-0068 | Preserves foundation/modules/platform/runtime dependency direction |
| ADR-0081 | Keeps document rendering and artifacts as derived output, not business authority |
| ADR-0082 | Keeps Communication, DeliveryAttempt, Notes, Attachments, Documents, Workflow, and Timeline separate while allowing a unified projection UX |

This ADR does not require every capability to be physically deployed separately. A colocated
modular-monolith deployment may share infrastructure when it still preserves logical contracts,
bounded admission, failure isolation, and the reviewed resource guarantees claimed by that deployment.

## Alternatives considered

### One universal read model or `chatter_messages` table

Rejected. It would combine unrelated invariants, retention policies, authorization rules, correction
semantics, and failure domains. The Activity Timeline remains a federated projection.

### Synchronous fan-out before source commit

Rejected. It makes source availability equal to the availability of every derived consumer and
creates unsafe dual-write and rollback behavior.

### One mega-query for complete page hydration

Rejected for authoritative entity endpoints. It turns optional timeline, document, workflow, search,
and communication dependencies into mandatory read-path dependencies.

### Queue-only isolation

Rejected. Queues protect execution ordering and durability but do not alone protect CPU, memory,
connection pools, storage I/O, or network capacity. Resource budgets and bulkheads remain required.

### Make every subsystem strongly consistent

Rejected. Strong consistency is reserved for invariants that require it. Derived capability freshness
is explicit and eventually consistent where the business contract permits.

## Consequences

### Positive

- Sales, Procurement, Accounting, Inventory, and other Class A capabilities remain readable during
  secondary outages and projection lag.
- Communication, Document, Workflow, Search, Analytics, and Timeline have clear independent
  lifecycles and recovery paths.
- The UI can provide a rich unified experience without a universal backend record or mega-query.
- Load, chaos, resource, and partial-failure tests have concrete non-interference targets.
- Existing outbox, messaging, workload, document, and communication decisions compose without
  transferring semantic authority.

### Negative

- Secondary panels need independent endpoints, query states, authorization, freshness metadata, and
  degraded UX.
- Projection rebuild, replay, retention, and cross-capability correlation require operational work.
- Resource isolation may leave reserved capacity idle during secondary overload.
- Some composite experiences are eventually consistent and cannot promise one synchronized snapshot.

## Validation gates

A capability is not production-ready until its non-interference claim proves:

1. Class A read paths depend only on authorization, the owner service, and authoritative storage
   unless an explicit business invariant documents another dependency.
2. Class A writes commit owner-local state and outbox facts without waiting for derived consumers.
3. Derived consumers are idempotent, bounded, timeout-aware, retryable, and independently recoverable.
4. Core endpoints remain within their reviewed SLO while communication, document, timeline, search,
   analytics, workflow, and integration workloads are delayed or failing.
5. Resource pools, worker slots, queue capacity, CPU, memory, storage, and credentials cannot be
   monopolized by derived work beyond the deployment's reviewed claim.
6. Secondary UI/BFF sections return local degraded states rather than failing the core entity read.
7. Projections expose freshness/as-of metadata where lag affects user interpretation.
8. Class C projections have a complete rebuild/replay path from authoritative facts or events.
9. Authorization remains current and tenant-scoped for every secondary capability and timeline entry.
10. Any synchronous cross-capability dependency is documented as an explicit business invariant with
    an owning domain and a tested failure contract.

Until these gates pass, the capability may be used as an internal or evaluation-only derived slice,
but its availability must not be included in the source-of-truth SLO.
