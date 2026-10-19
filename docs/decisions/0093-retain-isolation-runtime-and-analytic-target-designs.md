# ADR-0093: Retain Workload Isolation, the Stateful Entity Runtime, and the Analytic Plane as Target Designs

- Status: Accepted
- Date: 2026-10-19
- Amends: ADR-0091 (these three subsystems are retained as inactive target designs instead of being
  deleted; the current implementation it selected is unchanged)
- Compatible with: ADR-0003, ADR-0015, ADR-0092
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Framework and flagship ERP decision:
>   [`./0091-adopt-framework-and-flagship-erp.md`](./0091-adopt-framework-and-flagship-erp.md)
> - Same pattern for the ledger engine:
>   [`./0092-retain-tigerbeetle-as-designated-ledger-engine.md`](./0092-retain-tigerbeetle-as-designated-ledger-engine.md)
> - Workload isolation: [`../architecture/workload-isolation.md`](../architecture/workload-isolation.md)
> - Stateful Entity Runtime: [`../architecture/runtime-architecture.md`](../architecture/runtime-architecture.md)
> - Analytic plane: [`../architecture/analytics-architecture.md`](../architecture/analytics-architecture.md)
> - Earlier decisions (superseded by ADR-0091):
>   [`./0025-introduce-stateful-entity-runtime.md`](./0025-introduce-stateful-entity-runtime.md),
>   [`./0026-evaluate-celld-runtime-adapter.md`](./0026-evaluate-celld-runtime-adapter.md),
>   [`./0034-adopt-non-interference-overload-isolation.md`](./0034-adopt-non-interference-overload-isolation.md),
>   [`./0043-adopt-rebuildable-analytic-plane.md`](./0043-adopt-rebuildable-analytic-plane.md),
>   [`./0083-enforce-non-interference-between-source-of-truth-and-derived-capabilities.md`](./0083-enforce-non-interference-between-source-of-truth-and-derived-capabilities.md)

## Context

ADR-0091 removed workload isolation (workload planes, admission, cells, command reserve,
non-interference proofs), the Stateful Entity Runtime, and the analytic plane, together with their
architecture documents and roadmap track, because none had a user. Their replacements stay: separate
API and worker pools with statement timeouts, plain transactions with the job table, and SQL reports
with materialized views.

The owner wants all three kept as RITSEI's long-term direction. Non-interference in particular is
meant to be a differentiator against Odoo and SAP: reporting, imports, integrations, and derived
work must never slow the commands that record business facts. Deleting the designs means
re-deriving them later; keeping them inactive costs only documentation upkeep.

## Decision

1. **The three are designated target designs, not current behavior.** Their architecture documents
   are restored from the commit before `c10594c` as target designs:
   [`workload-isolation.md`](../architecture/workload-isolation.md),
   [`runtime-architecture.md`](../architecture/runtime-architecture.md),
   [`analytics-architecture.md`](../architecture/analytics-architecture.md), the
   [`workload` roadmap](../roadmap/workload.md), and two reference documents. Each carries a banner
   that states the current implementation.
2. **The current implementation from ADR-0091 is unchanged and is the first step toward each
   target:** separate API and worker pools with statement timeouts (workload isolation), plain
   PostgreSQL transactions with row locks and the job table (Stateful Entity Runtime), and
   module-owned SQL reports and materialized views (analytic plane). New code should follow the
   targets' boundaries where it costs nothing, for example keeping report reads off command paths and
   publishing report inputs as owner facts.
3. **Implementations may return as inactive, tested code.** Workload classification, admission,
   cell routing, a Stateful Entity Runtime adapter, or an analytic projection provider may be
   reintroduced behind their boundaries with tests, provided no production path depends on them.
4. **Activation needs its own ADR with measurement.** Making any of them a production requirement,
   or routing traffic through it, needs a new ADR that names the user or workload and the measured
   evidence. For workload isolation the first evidence is a load test showing that posting and
   order-confirmation latency stay within budget while heavy reports, imports, and integrations run.
5. **Product claims follow evidence.** RITSEI may describe non-interference as a design goal now,
   and as a product guarantee only after the evidence in decision 4 exists.
6. **No delivery gates.** The `workload` roadmap track is dormant: it does not gate framework or ERP
   phases. Analytic-plane and Stateful Entity Runtime gates are likewise inactive until activated.

## Alternatives Considered

- **Keep them deleted, as ADR-0091 decided:** rejected; it discards designs the owner wants as the
  long-term direction, including the main non-interference differentiator.
- **Reactivate them now:** rejected; there is no tenant or load to measure, and the ERP loops come
  first under ADR-0091.
- **Keep only workload isolation:** rejected by the owner; the analytic plane and the Stateful Entity
  Runtime are the natural continuation of non-interference for reporting and hot aggregates.

## Consequences

### Positive

- The non-interference direction stays explicit while the ERP is built, so early choices (pools,
  report reads, owner facts) do not close it off.
- Reactivation starts from a reviewed design instead of a blank page.

### Negative

- About 3,400 lines of target-design documentation return and must be kept from contradicting
  current behavior.
- Restored documents describe the pre-restructure tree (`modules/`, `runtime/`) until each is
  revised when its subsystem is activated.

### Risks

- Readers can mistake target design for current behavior. Containment: every restored document
  carries a banner, and the architecture specification states the current implementation next to
  each target.
- Target designs can pull speculative work forward. Containment: decisions 3 and 4; inactive code
  must not become a dependency of a production path.

## Validation

- Restored documents, the architecture specification, the overview, and the roadmap index all state
  the current implementation next to each target.
- Any activation proposal cites this ADR and supplies the measurement in decision 4.

## Related Documents

- [`../architecture/architecture-spec-v4.md`](../architecture/architecture-spec-v4.md)
- [`../architecture/overview.md`](../architecture/overview.md)
- [`../roadmap/README.md`](../roadmap/README.md)
- [`../proposals/framework-reset.md`](../proposals/framework-reset.md)
