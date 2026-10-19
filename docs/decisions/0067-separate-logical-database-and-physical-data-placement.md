# ADR-0067: Separate Logical Database from Physical Data Placement

- Status: Accepted
- Date: 2026-08-31
- Amends: None
- Compatible with: ADR-0034, ADR-0039, ADR-0040, ADR-0043
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Canonical architecture: [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)
> - PostgreSQL architecture: [`../architecture/postgresql-19-architecture.md`](../architecture/postgresql-19-architecture.md)
> - State and consistency: [`../architecture/state-and-consistency.md`](../architecture/state-and-consistency.md)
> - Database roles: [`../operations/database-roles.md`](../operations/database-roles.md)
> - PostgreSQL 19 `WAIT FOR` decision: [`./0039-select-postgresql-wait-for-for-replica-read-your-writes.md`](./0039-select-postgresql-wait-for-for-replica-read-your-writes.md)

## Context

RITSEI is a modular monolith whose domains share a PostgreSQL ownership model. That ownership model
must not be confused with a promise that every deployment has one PostgreSQL server, process, or
physical database. A deployment may start with one PostgreSQL placement and later require replicas,
regional placements, or tenant-scoped shards.

If physical placement enters domain contracts, every domain becomes coupled to server, shard,
region, router, or replica details. That would make placement changes look like semantic changes and
would encourage domain code to select infrastructure directly. Conversely, hiding placement without
defining transaction and consistency boundaries could make a distributed topology appear to preserve
single-database guarantees that it cannot provide.

## Decision

RITSEI adopts a **logical database contract** over PostgreSQL placements. The logical contract is the
stable application target; physical placement is private infrastructure topology.

```text
Domain public contract
        ↓
Kernel database and placement boundary
        ↓
Approved PostgreSQL 19+ placement(s)
```

The initial deployment remains a single PostgreSQL 19+ placement, with primary/replica use only where
the relevant route and operational gates pass. Accepted financial transfers, balances, and transfer
history remain under the current FinancialLedgerPort and financial-ledger authority; this ADR changes
no financial authority. This ADR does not activate sharding, a distributed SQL router, multi-region
writes, or a mandatory external database service.

### Semantic ownership and placement

- A domain remains the semantic owner of its invariants regardless of physical placement.
- Each PostgreSQL-owned authoritative fact has one current authoritative placement; moving it is a
  controlled migration, not a period of dual authority.
- Placement assignment and routing metadata belong to the kernel, composition roots, and approved
  infrastructure adapters. Clients and domain packages cannot choose a server, shard, region,
  replica, WorkloadCell, pool, or router target.
- Tenant, legal-entity, warehouse, or another owner-approved scope may contribute to a placement key,
  but the key is infrastructure metadata and is not a public identity or business capability.
- Public entity IDs, domain events, Process IR, URLs, and capability IDs remain stable across
  placement changes.

### Transaction and consistency boundary

- Invariant-sensitive mutations continue to use a direct transaction on one transactionally
  compatible PostgreSQL placement.
- An accepted cross-domain invariant that currently requires one PostgreSQL transaction cannot be
  split across placements without a new consistency decision and an explicit protocol for identity,
  idempotency, recovery, reconciliation, and compensation.
- A logical database endpoint is not a promise that one physical connection or session follows every
  request. Code must not depend on backend connection identity, server-local sequences, locks, or
  session state being portable across placements.
- A consistency token may be bound to tenant, placement, timeline, and expiry, but remains opaque
  outside the kernel. Raw WAL, LSN, server, shard, and router details never enter public contracts.
- Cross-placement reads are allowed only for an explicitly bounded query, projection, reporting, or
  reconciliation contract. They are not a substitute for an owning domain's authority and must not
  create hidden primary fallback.

### Workload topology

Data placement and workload placement are orthogonal. A WorkloadCell, command/query/async plane,
connection pool, or shuffle shard controls resource and fault containment; it does not own business
facts. A hard-isolation claim must name the credentials, network paths, PostgreSQL placements, and
shared dependencies it actually protects.

### Activation rule

RITSEI adds a physical placement strategy only after a measured requirement and reviewed evidence
for routing correctness, transaction scope, tenant isolation, authorization freshness, migration,
recovery, observability, load, and exit. Architectural permission to distribute data is not a
reason to distribute it.

## Alternatives Considered

### Require one physical PostgreSQL server permanently

Rejected. It unnecessarily couples the domain model to the first deployment topology and makes
future read, storage, regional, or tenant placement changes architectural rewrites.

### Give each domain its own database and connection contract

Rejected as the default. It leaks physical boundaries into semantic ownership, complicates current
cross-domain transaction boundaries, and encourages distributed writes before their consistency
protocol is accepted.

### Activate a distributed router and sharding now

Rejected. It adds routing, cross-placement transaction, global uniqueness, migration, recovery, and
operational complexity without measured workload evidence. The current PostgreSQL-first deployment
remains the baseline.

### Move immediately to database-per-service microservices

Rejected. Compute decomposition, semantic ownership, and data placement solve different problems.
RITSEI remains a modular monolith while infrastructure topology evolves independently.

## Consequences

### Positive

- Domain contracts remain independent of physical server, shard, region, replica, and router layout.
- PostgreSQL 19 capabilities can be adopted incrementally without presenting them as a single-server
  commitment.
- Placement can evolve from one primary to bounded replicas or measured shards without changing
  business semantics.
- Transaction, authorization, idempotency, and recovery boundaries remain explicit.

### Negative

- The kernel and composition roots must eventually own placement resolution and connection budgets.
- Cross-placement operations require explicit protocols instead of hidden database magic.
- Global queries, uniqueness, numbering, locking, and transaction semantics need separate designs
  before a distributed placement is activated.
- A logical endpoint may return typed unavailable or unsupported outcomes when no eligible placement
  can satisfy the contract.

### Risks

- Calling a routing proxy a transparent PostgreSQL connection could hide lost session or transaction
  semantics.
- A poor placement key could create cross-placement hot paths or tenant-isolation failures.
- Dual writes or cross-placement compensation could create competing authorities.
- Replica or projection freshness could be mistaken for current authorization or canonical truth.
- Credentials intended for one placement could accidentally grant access to another placement.

## Validation

Before activating a multi-placement deployment, prove:

- domain packages and public contracts contain no physical placement identifiers;
- tenant and authorization context cannot cross a placement or pooled session;
- invariant-sensitive commands retain one compatible transaction boundary or use an accepted protocol;
- idempotency, business numbers, uniqueness, locks, and recovery remain correct at placement scope;
- replica consistency tokens reject the wrong placement or timeline and never reach a hidden primary;
- PostgreSQL-owned placement migration preserves row identity, authority, audit history, and
  rebuildable projections;
- cross-placement reads are bounded, authorized, observable, and non-authoritative;
- command reserves and workload isolation remain valid under placement lag, failure, and saturation;
- backup, restore, failover, and exit rehearsals pass for every activated placement;
- the measured workload requirement and operator approval justify the topology.

## Related Documents

- [`../architecture/postgresql-19-architecture.md`](../architecture/postgresql-19-architecture.md)
- [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)
- [`../architecture/state-and-consistency.md`](../architecture/state-and-consistency.md)
- [`../operations/database-roles.md`](../operations/database-roles.md)
