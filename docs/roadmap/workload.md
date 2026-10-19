# Workload Isolation Roadmap

> **Status:** Dormant roadmap subdocument, retained by
> [ADR-0093](../decisions/0093-retain-isolation-runtime-and-analytic-target-designs.md). Its gates
> do not block framework or ERP phases; they resume when an activation ADR selects workload
> isolation. Evidence files and code paths it names were removed in commit `c10594c`.
>
> **Track ID:** `workload`
>
> **Owner:** Platform/runtime and release-operations composition root.
>
> **Scope committed:** workload classification and a protected command reserve for the next
> supported profile.
>
> **Measured by:** `workload.*` exit evidence (reviewed; the mechanical evaluator was retired by ADR-0089).
>
> **Does not own:** authorization, business invariants, PostgreSQL data placement, or optional
> WorkloadCells and shuffle sharding.
>
> **Detailed semantics belong to:**
> [`../architecture/workload-isolation.md`](../architecture/workload-isolation.md) and
> [`../decisions/0034-adopt-non-interference-overload-isolation.md`](../decisions/0034-adopt-non-interference-overload-isolation.md).
>
> **Related documents**
>
> - Roadmap index: [`./README.md`](./README.md)
> - Authorization: [`../architecture/authorization.md`](../architecture/authorization.md)
> - Database roles: [`../operations/database-roles.md`](../operations/database-roles.md)
> - Deployment notes: [`../deployment/README.md`](../deployment/README.md)
> - PostgreSQL 19 roadmap: [`./postgresql-19.md`](./postgresql-19.md)

## Scope

This track proves the smallest shared admission fabric needed to protect canonical commands from
competing query and asynchronous work. It does not claim physical isolation for the colocated
`entry` profile and does not activate WorkloadCells, recursive shuffle sharding, or route-specific
projection isolation.

The track must preserve the distinction between:

```text
workload class / criticality / cost / deadline
    != capability / authorization / business priority
```

A ResourceLease is admission only. It is not authorization, a database lock, durable acceptance,
or business ownership.

## Dependencies

```text
Process Studio pre-0.8 prerequisites + PostgreSQL 19 minimum
        ↓
workload.classify
        ↓
workload.command-reserve
```

The reserve gate may use PostgreSQL 19 reserved connections where the selected profile requires it,
but the track must prove the complete resource claim rather than infer hard isolation from a logical
semaphore or a separate pool.

## Sequence

### W0 — Workload classification (`workload.classify`)

Declare command, query, and async metadata at the route or public-contract boundary. Bound
in-flight work, queue depth, deadlines, statement and result cost, and admission scope. Keep
capability IDs and public DTOs free of pool, cell, shard, executor, and provider topology.

**Exit evidence:**

- `runtime/workload/classification.ts` provides the runtime classification boundary;
- `tests/workload/classification.test.ts` covers representative command, query, and async routes;
- route cost and deadline limits are recorded for the selected profile; and
- the architecture boundary test remains green.

### W1 — Protected command reserve (`workload.command-reserve`)

Give canonical command work a non-zero reviewed reserve that query and async work cannot acquire.
Admission remains bounded before executor slots, database connections, projection connections, or
expensive work. Saturation rejects or degrades competing work and never falls back to command or
PostgreSQL-primary resources.

**Exit evidence:**

- `runtime/workload/admission.ts` enforces hard ceilings and bounded permits;
- `tests/workload/non-interference.test.ts` covers multitab and retry-storm contention;
- `docs/operations/workload-isolation-evidence.json` names protected resources, shared dependencies,
  excluded failures, and the approved command success/latency objective; and
- query and async saturation cannot consume the command reserve.

## Conditional stages (not registered)

Register these only after the two committed gates pass and a named workload needs them:

```text
workload.projection-isolation.<route>
WorkloadCells
recursive shuffle sharding
```

Each physical claim must be route-specific and must name disjoint resources, bounded shared
resources, credentials, failure exclusions, and overload evidence. A minimal or colocated profile
may remain valid without those stages.

## Measures

| Measure                                      | Target before a protected-reserve claim |
| -------------------------------------------- | ---------------------------------------- |
| `workload.*` mechanical gates               | all two pass                             |
| protected command reserve                   | `> 0`                                    |
| query/async acquisition of command reserve  | `0`                                      |
| unbounded queue or wait                     | `0`                                      |
| query-to-command primary fallback           | `0`                                      |
| adaptive limit above hard limit             | `0`                                      |

Load and fault evidence remains profile-owned operational evidence.

## Stop conditions

Stop the track when a workload class is used as authorization, the router evaluates business
invariants, a projection executor has a command or primary credential, overload falls back to the
primary, adaptive limits exceed hard ceilings, queues or waits are unbounded, or a claim omits
shared dependencies and excluded failure modes.
