# PostgreSQL 19 Capability Roadmap

> **Status:** Canonical roadmap subdocument
>
> **Track ID:** `postgres19`
>
> **Owns:** sequencing and readiness gates for PostgreSQL 19-specific capabilities.
>
> **Measured by:** `postgres19.*` gates through `deno task roadmap:measure`.
>
> **Detailed semantics belong to:**
> [`../architecture/postgresql-19-architecture.md`](../architecture/postgresql-19-architecture.md),
> [`../architecture/state-and-consistency.md`](../architecture/state-and-consistency.md), and
> [`../architecture/hierarchy-and-graph-selection.md`](../architecture/hierarchy-and-graph-selection.md).
>
> **Related documents**
>
> - Roadmap index: [`./README.md`](./README.md)
> - PostgreSQL architecture:
>   [`../architecture/postgresql-19-architecture.md`](../architecture/postgresql-19-architecture.md)
> - State and consistency:
>   [`../architecture/state-and-consistency.md`](../architecture/state-and-consistency.md)
> - Database roles: [`../operations/database-roles.md`](../operations/database-roles.md)
> - PostgreSQL 19 rehearsal: [`../operations/postgresql-19.md`](../operations/postgresql-19.md)
> - `WAIT FOR` ADR:
>   [`../decisions/0039-select-postgresql-wait-for-for-replica-read-your-writes.md`](../decisions/0039-select-postgresql-wait-for-for-replica-read-your-writes.md)
> - Selective graph ADR:
>   [`../decisions/0005-use-ltree-and-sql-pgq-selectively.md`](../decisions/0005-use-ltree-and-sql-pgq-selectively.md)

## Scope

Turn the PostgreSQL 19 development floor into a small set of executable, reversible capability
slices without moving business authority out of relational tables or activating beta features in
production.

## Sequence

The first four gates prove the registered PostgreSQL capability scope. The final gate records the
production decision. The current registry requires both pilots because both are part of that scope;
if a future deployment profile selects only one pilot, split the activation gate rather than bypass
or reinterpret a dependency.

### Minimum version (`postgres19.minimum-version`)

Keep the kernel version floor at PostgreSQL 19 (`server_version_num >= 190000`) and verify it before
application work or migration execution.

**Exit:** the version check and regression test pass.

### Replica read-your-writes pilot (`postgres19.wait-for-pilot`)

Pilot route-scoped `WAIT FOR ... MODE 'standby_replay'` for procurement purchase-order create/read.
The command captures an opaque, tenant-bound token after commit; the read validates placement and
timeline context, waits on the configured replica, and then queries only that replica. Token capture
is best effort for this non-idempotent create; without a token, the route remains on its previously
approved primary path.

**Exit:** token integrity, tenant binding, bounded wait, malformed/expired handling, promotion and
timeline rejection, no-primary-fallback behavior, and route response semantics are tested.

### Party related-party path projection (`postgres19.property-graph-pilot`)

Expose a bounded Party related-party path query over `party.parties`, `party.legal_entities`, and
`party.party_relationships`. The projection is relational: plain joins implement the two-edge path;
relational foreign keys, tenant scope, authorization, and mutation paths remain authoritative. SQL/PGQ
(`CREATE PROPERTY GRAPH` / `GRAPH_TABLE`) was reverted upstream from PostgreSQL 19 after beta 3, so the
pilot waits for PostgreSQL 20 before being revisited with property graphs.

**Exit:** the custom migration applies on a fresh PostgreSQL 19 database, the query is tenant-scoped
and active-only, its result matches the relational baseline, and its bounded result is covered by a
public Party contract test.

### Operational rehearsal (`postgres19.repack-rehearsal`)

Run the disposable-database rehearsal for native `REPACK (CONCURRENTLY true, ANALYZE true)`,
checksums, autovacuum, reserved connections, `max_repack_replication_slots`, and `pg_stat_io`.

**Exit:** row/checksum preservation and index validity are recorded in reviewable evidence; beta/RC
runs remain development-only.

### Production GA gate (`postgres19.production-ga`)

Keep PostgreSQL 19 production activation closed until GA, backup/PITR, migration, failover,
replication, workload-isolation, observability, and route-specific evidence are accepted.

**Exit:** the first four gates pass before final review, and the production evidence records that
the production review explicitly approves activation on PostgreSQL 19 GA. The
`postgres19.production-ga` gate passes only after that review; a passing mechanical gate is not
production approval.

## Current evidence

The repository proves the minimum version, a route-scoped consistency adapter and tests, a
non-superuser control/`WAIT FOR` privilege test, a Party relational read-projection migration with a
relational baseline and `EXPLAIN ANALYZE` test, and a disposable operational rehearsal. Evidence captured on
August 31, 2026 used PostgreSQL 19 Beta 3; production eligibility therefore remains **OPEN** as of
September 2, 2026. SQL/PGQ was subsequently reverted upstream from PostgreSQL 19 after beta 3, so the
Party projection became relational (ADR-0005 amendment, ADR-0087); the same result/baseline contract
stays authoritative.

## Measures

| Measure                                                | Target                                                  |
| ------------------------------------------------------ | ------------------------------------------------------- |
| `postgres19.*` registered gates                        | first four before final review; all five for activation |
| PostgreSQL server version floor                        | `server_version_num >= 190000`                          |
| opaque token leakage into domain contracts             | `0`                                                     |
| primary fallback after a selected replica wait failure | `0`                                                     |
| graph query tenant-boundary failures                   | `0`                                                     |
| graph result mismatch against relational baseline      | `0`                                                     |
| rehearsal checksum/index failures                      | `0`                                                     |
| production eligibility on beta/RC                      | `OPEN`                                                  |

## Stop conditions

Stop activation when the configured replica is not a reviewed standby, wait failure can reach the
primary through fallback, tokens expose raw WAL details in business contracts, the graph is used for
mutation or authorization hot paths, the graph result cannot be rebuilt from relational facts,
rehearsal evidence is missing, or the deployed PostgreSQL version is not PostgreSQL 19 GA.
