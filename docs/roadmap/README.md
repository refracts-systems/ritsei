# RITSEI Roadmap

> **Status:** Canonical roadmap index
>
> **Owns:** sequencing, dependencies, readiness gates, measures, and milestone exit criteria.
>
> **Does not own:** domain invariants, runtime semantics, or historical decision rationale. Those
> belong to the owning architecture document or ADR.
>
> **Related documents**
>
> - Documentation governance: [`../documentation-boundaries.md`](../documentation-boundaries.md)
> - Product vision: [`../product/vision.md`](../product/vision.md)
> - Architecture overview: [`../architecture/overview.md`](../architecture/overview.md)
> - Process Studio architecture:
>   [`../architecture/process-studio.md`](../architecture/process-studio.md)
> - Identity and principals:
>   [`../architecture/identity-and-principals.md`](../architecture/identity-and-principals.md)
> - Integration architecture:
>   [`../architecture/integration-architecture.md`](../architecture/integration-architecture.md)
> - Product release workflow: [`../development/releasing.md`](../development/releasing.md)
> - Product SemVer ADR:
>   [`../decisions/0066-adopt-single-product-semver-authority.md`](../decisions/0066-adopt-single-product-semver-authority.md)

- Reference analysis and deferred-stage review:
  [`../architecture/reference/roadmap-track-considerations.md`](../architecture/reference/roadmap-track-considerations.md)

## How to read this folder

- This index owns the dependency graph and global exit conditions.
- Each subroadmap owns one delivery track and its phase gates.
- Architecture documents own current semantics; ADRs own difficult-to-reverse decisions.
- Status is evidenced by the repository's existing tests and CI checks plus reviewed operational
  evidence, not by a dedicated aggregator ([ADR-0089](../decisions/0089-retire-roadmap-completion-evaluator.md)).
  Prose status must not contradict a failing test or check.

Every track uses the same small contract: scope, ordered phases, measurable exit evidence, measures,
and stop conditions. Implementation inventories belong in code, tests, or operational evidence—not
in this folder.

## Gate semantics

ADR-0061 requires executable evidence, not a new evaluator for each change. Reuse existing focused
tests and validation commands; ordinary feature work and owner risk acceptance do not imply a
roadmap redesign.
Keep manual approval distinct from automated results. Agent scope rules belong in
[`AGENTS.md`](../../AGENTS.md#working-rules).

Roadmap status uses distinct evidence classes:

- **Mechanical gate:** repository artifacts and focused executable checks pass.
- **Operational gate:** reviewed environment, rehearsal, or recovery evidence is accepted.
- **Activation approval:** an owner explicitly approves a provider, authority, route, or deployment
  profile after its required gates pass.
- **Product release:** an annotated source release governed by
  [`../development/releasing.md`](../development/releasing.md); open roadmap gates do not prevent a
  source-only pre-release.

`roadmap.global-exit` means every gate assigned to the current ten tracks has accepted evidence. It does not by
itself publish a product release, activate an unregistered connector provider, or approve a
particular deployment profile. Numeric labels such as `0.8` and `1.0` are historical roadmap
milestones and gate IDs, not product SemVer.

There are no live roadmap counters. Subroadmap measures are required exit or activation evidence,
reviewed by a person against the repository's checks.

## Current position

This snapshot was updated on September 3, 2026. The numbers below are a reviewed snapshot, not live output.

| Area                | Measured position                                                                 | Next decision                                                            |
| ------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| ERP primitives      | P0–P3 plus exact legacy-mapping evidence are registered                          | Expand only when a requested capability needs a new primitive            |
| Domain providers    | Identity lifecycle is covered; relationship/SoD foundation gates Level 3 slices | Close D0 evidence before broadening provider readiness                   |
| Financial execution | `2/16` activation gates pass; production decision is **NO-GO**                    | Close outage, restore, replay, and bounded-cutover evidence              |
| Process Studio      | Runtime/designer evidence exists; chain is gated by D0 and lease fencing        | Close domain and fencing dependencies before governed release            |
| Integrations        | Governed surface evidence exists; readiness follows the Process dependency       | Activate providers only with owner, credentials, recovery, and runbooks  |
| Business Packs      | Contract slice exists; catalog-backed resolution remains unregistered            | Add a named owner before installation or onboarding mutation             |
| PostgreSQL 19       | Minimum version and bounded capability pilots implemented; GA is open             | Finish GA, failover, workload, and production evidence                   |
| Workload isolation  | Newly registered; classification and command-reserve evidence are open            | Implement bounded admission before a protected-reserve claim             |
| Frontend readiness  | Newly registered; shell, application-boundary, and accessibility evidence are open | Build the SPA shell and representative workflow                          |
| Production profile  | Newly registered; artifact, upgrade, and profile-approval evidence are open       | Produce artifacts and rehearse the selected entry profile                 |

The current product releases are pre-release, source-only snapshots. Release status and upgrade
caveats are owned by [`../development/releasing.md`](../development/releasing.md).

## Tracks

| ID            | Track                 | Owns                                                                              | Gate set          | Source                                                             |
| ------------- | --------------------- | --------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------ |
| `erp`         | ERP primitives        | reusable scope, product, document, quantity, money, audit, and event decisions    | `erp.*`           | [`erp-primitives.md`](./erp-primitives.md)                         |
| `domain`      | Domain maturity       | D0 identity/AuthZ foundations and Level 3 action/event evidence                   | `domain.*`        | [`domain-maturity.md`](./domain-maturity.md)                       |
| `financial`   | Financial execution   | TigerBeetle transition, reconciliation, rehearsal, and activation                 | `financial.*`     | [`financial-ledger-execution.md`](./financial-ledger-execution.md) |
| `process`     | Process Studio        | catalog, runtime, fencing, operations, designer, and governed release gates      | `process.*`       | [`process-studio.md`](./process-studio.md)                         |
| `integration` | External integration  | connector contracts, delivery, reliability, Process Studio bridge, and governance | `integration.*`   | [`integration-surface.md`](./integration-surface.md)               |
| `packs`       | Business Pack Library | pack resolution, draft materialization, onboarding, and governed upgrades         | `packs.contract`  | [`process-pack-library.md`](./process-pack-library.md)             |
| `postgres19`  | PostgreSQL 19         | version floor, consistency, read-projection, and operational capability evidence  | `postgres19.*`    | [`postgresql-19.md`](./postgresql-19.md)                           |
| `workload`    | Workload isolation    | workload classification and protected command-reserve evidence                    | `workload.*`      | [`workload.md`](./workload.md)                                     |
| `frontend`    | Frontend readiness    | SPA shell, application boundaries, design system, and user-workflow evidence      | `frontend.*`      | [`frontend.md`](./frontend.md)                                     |
| `production`  | Production profile    | artifacts, install/upgrade rehearsal, and reviewed profile manifests              | `production.*`    | [`production.md`](./production.md)                                 |

There are ten subdocuments and ten measured tracks. `README.md` is the index, not an eleventh
track. They remain separate because primitive decisions, provider maturity, financial authority,
process execution, external providers, pack distribution, and database activation have independent
owners and stop conditions. A new track requires a registry entry, a measured gate, and a documented
owner.

## Dependency graph

```text
ERP primitives → exact legacy-cohort migration
        ↓
Identity/AuthZ foundations → Level 3 providers
        ↓
Process pre-0.8 → catalog → runtime → lease fencing → operations → designer
        │                                                     │
        └── PostgreSQL 19 minimum → workload classification → command reserve
                                                              │
                                      designer ───────────────┘
                                                              ↓
                                             frontend shell ──┬→ boundaries/design system → accessibility/performance
                                                              │
                                      PostgreSQL 19 minimum ──┴→ artifacts → install/upgrade → profile approval
```

Registered cross-track dependencies are explicit:

| Gate or chain                         | Registered dependency                                                               |
| ------------------------------------- | ----------------------------------------------------------------------------------- |
| `erp.p0-migration`                    | `erp.p0`                                                                            |
| `erp.p1` → `erp.p3`                   | preceding ERP gate                                                                  |
| `domain.identity-lifecycle`           | `erp.p0-migration`                                                                  |
| `domain.authorization-foundation`     | `domain.identity-lifecycle`                                                         |
| `domain.capability-grammar`           | `domain.authorization-foundation`                                                  |
| `domain.*.level3`                     | `domain.capability-grammar`                                                         |
| `process.pre08`                       | ERP baseline plus Inventory and Sales Level 3 slices                                |
| `process.fencing087`                  | `process.runtime085`; `process.ops09` follows fencing                              |
| later `process.*` gates               | the preceding Process Studio gate                                                  |
| `integration.contract08`              | `process.pre08`; later integration gates follow the preceding integration gate      |
| `packs.contract`                      | `process.pre08`                                                                     |
| `postgres19.production-ga`            | minimum-version, `WAIT FOR`, property-graph, and operational-rehearsal gates        |
| `workload.classify`                   | `process.pre08` and `postgres19.minimum-version`                                    |
| `workload.command-reserve`            | `workload.classify`                                                                 |
| `frontend.shell`                      | `workload.command-reserve` and `process.designer095`                                |
| later `frontend.*` gates              | the required preceding frontend gate(s)                                             |
| `production.artifacts`                | `frontend.shell` and `postgres19.minimum-version`                                   |
| `production.install-upgrade`          | `production.artifacts` and `postgres19.production-ga`                               |
| `production.entry-profile`            | `production.install-upgrade`                                                        |
| `roadmap.global-exit`                 | every gate assigned to all ten registered tracks                                    |

Financial execution remains a parallel activation track over the bounded Accounting port. Provider
activation, deployment-profile approval, and source publication are not inferred from this graph;
they require their separately owned evidence and approval.

## Registered roadmap exit

The registered roadmap remains open until all of these are true:

```text
[ ] no material primitive decision is UNKNOWN
[ ] each mutable fact has one semantic owner
[ ] tenant, organization, legal, product, quantity, document, and money scopes are explicit
[ ] public domain actions/events have stable failures, authorization, and compatibility
[ ] committed effects have compensation or manual recovery
[ ] Process IR and catalog versions are deterministic and pinned
[ ] restart, duplicate, unknown-outcome, and recovery behavior is proven
[ ] authentication, current tenant membership, scope, relationship/SoD, and revocation fail closed
[ ] authorization and audit are enforced outside the browser
[ ] visual behavior is only a projection over validated runtime semantics
[ ] every gate assigned to the ten registered tracks has accepted evidence
```

The global gate is composite: an open financial activation, PostgreSQL 19 production gate, workload
reserve, frontend readiness gate, or production profile gate keeps the global result open even when
another track has passed its own mechanical gates. A passing global gate still does not activate a
particular connector provider, approve a deployment profile, or publish a product release.

## Exit evidence

The mechanical `roadmap:measure` aggregator was retired by
[ADR-0089](../decisions/0089-retire-roadmap-completion-evaluator.md). Gate IDs in this folder are
stable labels. A gate is complete when the checks it names (tests, `pnpm run check`, `boundary:lint`,
`financial:gate`, PostgreSQL 19 rehearsal, and similar) pass and any required operational evidence is
reviewed and accepted.

## Change control

- Change ownership, trust, durability, transaction semantics, or public contracts through an ADR.
- Add a track only with one owner, stable gate IDs, named evidence, and measurable exit criteria.
- If connector or deployment activation becomes roadmap-owned, add an explicit gate instead of
  broadening `roadmap.global-exit` prose.
- Remove duplicated architecture detail; link to the canonical owner instead.
- Do not create a package merely because a roadmap item names a functional area.
- Update this index only when sequencing, dependencies, or global exit conditions change.
