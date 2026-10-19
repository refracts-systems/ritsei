# ADR-0059: Define a Replaceable Relationship Authorization Engine

- Status: Accepted
- Date: 2026-08-27
- Amends: ADR-0006 only by defining the relationship/object evaluator boundary
- Compatible with: ADR-0005, ADR-0020, ADR-0021, ADR-0031, ADR-0037, ADR-0034
- Supersedes: None
- Superseded by: ADR-0091 (SpiceDB option withdrawn)

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Authorization architecture: [`../architecture/authorization.md`](../architecture/authorization.md)
> - PostgreSQL architecture: [`../architecture/postgresql-19-architecture.md`](../architecture/postgresql-19-architecture.md)
> - State and consistency: [`../architecture/state-and-consistency.md`](../architecture/state-and-consistency.md)
> - Hierarchy and graph selection: [`../architecture/hierarchy-and-graph-selection.md`](../architecture/hierarchy-and-graph-selection.md)
> - Audit boundary: [`./0037-define-p3-audit-event-and-delivery-boundary.md`](./0037-define-p3-audit-event-and-delivery-boundary.md)

## Context

Capability authorization alone does not close object-level authorization holes such as BOLA. A
principal may have `payment.approve` without being allowed to act on every payment. ERP relationship
paths can also become complex:

```text
principal -> team -> department -> branch -> legal entity -> resource
```

RITSEI needs a relationship/object evaluator without moving business policy, tenant authority, or
all ERP authorization semantics into an external provider. The evaluator must work in a portable
PostgreSQL deployment and must support a higher-scale relationship backend when measured need
justifies it.

## Decision

Adopt a provider-neutral **RelationshipEngine** boundary behind the RITSEI Authorization Kernel.
The default implementation is native PostgreSQL relationship authorization. SpiceDB remains a
supported optional adapter for high-scale relationship evaluation; it is not a required dependency
or source of truth.

```text
PostgreSQL / RITSEI canonical facts
  -> membership, roles, capabilities, grants, scopes, SoD, policy,
     and owner-domain relationship facts

RITSEI Authorization Kernel
  -> coarse permission matrix, scope evaluation, relationship orchestration,
     domain-policy coordination, SoD, final decision, explanation, and audit evidence

RelationshipEngine
  ├─ Native PostgreSQL implementation (default)
  └─ SpiceDB adapter (optional high-scale profile)
```

The selected relationship implementation is a composition-root/deployment concern. Public callers
receive provider-neutral relationship outcomes and safe evidence metadata. No public contract or
capability ID may require or encode a named relationship provider.

Not selecting SpiceDB does not disable object authorization. The native PostgreSQL implementation
must provide the same authorization contract. Selecting SpiceDB does not transfer authority away
from RITSEI/PostgreSQL.

## Authority and evaluation order

Every protected action follows:

```text
Identity
  -> Capability
  -> Scope
  -> Object relationship
  -> Domain policy
  -> Separation of Duties
  -> Allow / Deny
  -> Audit evidence
```

The precomputed permission matrix is the coarse-grained gate. It is cheap and necessary, but it is
not sufficient for a resource-specific command or query. The selected RelationshipEngine closes the
BOLA boundary; the owning domain remains responsible for current business validity.

The RelationshipEngine must not evaluate or store rules such as:

```text
amount <= approvalLimit
accounting period is OPEN
journal balances
inventory quantity is available
invoice is within credit limit
manufacturing state permits completion
```

Those facts and decisions stay in RITSEI domains and their transactional boundaries.

## Contract and source-of-truth boundary

All relationship evaluation goes through the RITSEI Authorization service/port. The contract exposes
only provider-neutral data such as:

```text
relationship: allowed | denied | unknown
resource and relationship identity
safe evidence metadata
consistency status
```

Provider SDK types, tuple syntax, revisions, datastore names, topology, and credentials remain
inside the selected adapter.

The native PostgreSQL implementation reads canonical RITSEI facts and owner-approved relationship
facts through the appropriate transaction and tenant boundaries. When the SpiceDB adapter is
selected, authoritative RITSEI changes commit first through the owning PostgreSQL transaction.
Relationship projection to SpiceDB uses an idempotent, durable post-commit delivery path with replay
and reconciliation. RITSEI must not rely on an unsafe synchronous dual write to PostgreSQL and
SpiceDB.

A provider consistency token or revision remains adapter-internal. It may contribute to safe
consistency evidence but never becomes a RITSEI capability, tenant fact, or public domain contract.

## Freshness, revocation, and failure

A sensitive command or query may require current relationship evidence. Its authorization contract
must declare the required freshness and consistency behavior, not a provider name.

```text
selected RelationshipEngine satisfies the required contract
or
fail closed
```

The following are never an allow condition:

```text
selected engine unavailable
relationship result unknown
projection stale beyond its contract
revocation state cannot be proven
provider consistency requirement is unmet
```

If the native PostgreSQL engine is selected and its canonical state is unavailable, the request fails
closed. If the SpiceDB adapter is selected and its projection or consistency requirement is
unavailable, the request fails closed. A native implementation is a valid selected path, not an
outage fallback for a SpiceDB-specific route.

No route may require a named relationship provider. A route requiring current relationship
evidence may be served by any selected engine that satisfies the declared contract; otherwise it
returns denial or typed unavailability.

Revocation-sensitive access remains blocked until the selected path can prove current access.

## Query and BOLA protection

Owner repositories enforce tenant and scope predicates server-side. For list/read queries they may
use an approved relationship candidate or batch-check path, but they must not:

```text
fetch all rows
-> filter unauthorized objects in application memory
```

A search result, projection membership, resource address, or relationship candidate is not
authorization evidence by itself. Sensitive details and commands return through the owning domain
contract, which rechecks current tenant, object relationship, domain policy, and SoD.

## Separation of Duties and explanation

The RelationshipEngine does not own static or dynamic SoD. RITSEI Authorization owns
organization-level conflict policy and the decision envelope; an owning domain supplies current facts
such as creator, approver, amount, period, approval history, or workflow state. Enforcement occurs at
the final command boundary and, where required, inside the same transaction as the business
mutation.

A safe final decision records:

```text
principal
principal kind
tenant
capability
resource
scope result
relationship result
domain policy result
sod result
decision
reason
policy/grant version
selected-engine consistency evidence
request/correlation IDs
timestamp
```

Raw tuples, provider traces, credentials, and sensitive policy expressions are not public denial
content.

## Provider exit and conformance

The Authorization Kernel remains usable with the native PostgreSQL implementation and a deterministic
memory implementation for tests. SpiceDB is an optional adapter, not a second authorization model.

Native PostgreSQL and SpiceDB implementations must eventually satisfy the same conformance contract,
including:

- capability and scope gates;
- tenant and object relationship checks;
- allow, deny, unknown, stale, and unavailable outcomes;
- revocation behavior;
- BOLA protection;
- safe decision evidence;
- SoD and domain-policy handoff;
- rebuild and replacement behavior.

A provider migration must support a complete rebuild from retained RITSEI facts or an owner-approved
snapshot plus replay. During migration, sensitive authorization fails closed when equivalent current
relationship evidence is unavailable.

## Alternatives Considered

### Make SpiceDB a required RITSEI dependency

Rejected. SpiceDB remains a supported high-scale adapter, but hard-coding it raises deployment and
operational coupling for installations that can satisfy the same contract with PostgreSQL.

### Build all relationship checks ad hoc in domain code

Rejected. It scatters BOLA protection, relationship traversal, revocation behavior, and explanation
semantics across domain code.

### Make the relationship provider the complete authorization authority

Rejected. It would collapse capabilities, tenant membership, SoD, domain policy, and object
relationships into one provider and conflict with RITSEI ownership and PostgreSQL authority.

### Put business policy in the RelationshipEngine

Rejected. Amounts, periods, balances, inventory, credit, and workflow state require owner-controlled
transactional facts and typed domain failures.

### Check only the permission matrix

Rejected. Capability possession does not prove access to a specific resource and leaves BOLA holes.

## Consequences

### Positive

- Object-level authorization has a stable, replaceable contract.
- PostgreSQL provides a portable default relationship implementation.
- SpiceDB remains available for measured high-scale relationship workloads.
- RITSEI retains canonical ownership of ERP authorization and business semantics.
- BOLA protection is explicit for commands and sensitive reads.
- Provider outage and revocation uncertainty fail closed.
- Native and external implementations can be tested for behavioral parity.

### Negative

- The native relationship implementation needs careful tenant-scoped query and transaction design.
- SpiceDB profiles require projection, replay, consistency, and reconciliation operations.
- Some sensitive reads require a bounded authoritative path instead of stale projection data.
- Explainable decisions need evidence from several independent layers.

### Risks

- Eventual tuple propagation can delay grants or revocations in the SpiceDB profile.
- A provider candidate result may be mistaken for final authorization.
- Batch object checks can become a query-performance bottleneck without bounded shapes.
- SoD may be bypassed if a domain command accepts a relationship result as business validity.
- Native and SpiceDB implementations may drift unless conformance tests are mandatory before activation.

## Validation

This decision is validated when tests and operational proofs show:

- the native PostgreSQL implementation satisfies the RelationshipEngine contract;
- the SpiceDB adapter satisfies the same contract without exposing provider types;
- capability allow without object relationship is denied;
- tenant or scope mismatch is denied before object access;
- BOLA attempts cannot read or mutate another authorized tenant/resource;
- stale or revoked relationships fail closed;
- selected-engine outage, timeout, unknown result, and consistency mismatch never allow access;
- domain amount, period, inventory, credit, and workflow policies remain outside the evaluator;
- static and dynamic SoD run at the final owner-controlled command boundary;
- decision explanations contain safe layer results and policy versions without provider internals;
- the relationship projection can be rebuilt from canonical RITSEI facts;
- replacing the relationship implementation does not change public domain contracts or source-of-truth ownership.

## Related Documents

- [`../architecture/authorization.md`](../architecture/authorization.md)
- [`../architecture/identity-and-principals.md`](../architecture/identity-and-principals.md)
- [`../architecture/state-and-consistency.md`](../architecture/state-and-consistency.md)
- [`./0006-use-capability-based-authorization.md`](./0006-use-capability-based-authorization.md)
- [`./0037-define-p3-audit-event-and-delivery-boundary.md`](./0037-define-p3-audit-event-and-delivery-boundary.md)
