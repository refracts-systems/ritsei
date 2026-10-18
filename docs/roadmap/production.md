# Production Profile Readiness Roadmap

> **Status:** Canonical roadmap subdocument
>
> **Track ID:** `production`
>
> **Owner:** Release and operations composition root.
>
> **Scope committed:** reproducible application artifacts, install/upgrade evidence, and one
> explicitly reviewed `entry + PostgreSQL` profile.
>
> **Measured by:** `production.*` exit evidence (reviewed; the mechanical evaluator was retired by ADR-0089).
>
> **Does not own:** PostgreSQL semantics, financial authority, workload isolation, frontend
> architecture, Process durability, connector activation, or provider selection.
>
> **Detailed semantics belong to:**
> [`../deployment/README.md`](../deployment/README.md),
> [`../development/releasing.md`](../development/releasing.md), and the selected subsystem
> architecture and ADRs.
>
> **Related documents**
>
> - Roadmap index: [`./README.md`](./README.md)
> - Entry profile: [`../../deploy/entry/README.md`](../../deploy/entry/README.md)
> - PostgreSQL 19: [`./postgresql-19.md`](./postgresql-19.md)
> - Workload isolation: [`./workload.md`](./workload.md)
> - Frontend readiness: [`./frontend.md`](./frontend.md)
> - Release workflow: [`../development/releasing.md`](../development/releasing.md)
> - Deployment notes: [`../deployment/README.md`](../deployment/README.md)
> - Financial authority boundary:
>   [`../decisions/0041-separate-deployment-profile-and-financial-authority.md`](../decisions/0041-separate-deployment-profile-and-financial-authority.md)
> - Product SemVer authority:
>   [`../decisions/0066-adopt-single-product-semver-authority.md`](../decisions/0066-adopt-single-product-semver-authority.md)

## Scope

This track adds a supportable deployment promise on top of accepted subsystem evidence. It starts
with the existing `entry + postgresql` composition and does not make an optional provider or
higher-scale topology a universal dependency.

```text
reviewed source revision
    ↓
API / worker / migration / frontend artifacts
    ↓
clean install and supported upgrade evidence
    ↓
profile manifest and owner approval
```

Registering this track does not convert a source-only tag into a supported deployment. The profile
gate must name every selected capability, its accepted evidence, its release owner, and its
operations owner.

## Dependencies

The selected profile controls dependencies:

- artifact production requires the frontend shell and the PostgreSQL 19 version floor;
- install/upgrade evidence requires the reviewed PostgreSQL 19 production gate for the selected
  database profile; and
- `entry-profile` depends only on the evidence selected by its manifest.

TigerBeetle, external connectors, WorkloadCells, physical projection isolation, PgQue, `pg_durable`,
and optional renderers remain unselected unless a later profile explicitly adds their accepted
activation gates.

## Sequence

### P0 — Reproducible artifacts (`production.artifacts`)

Produce versioned API, worker, migration, and frontend artifacts with source revision, dependency,
and provenance records. The artifact path must be reproducible from a reviewed source revision and
must not rely on mutable local state.

**Exit evidence:**

- `deploy/artifacts/manifest.json` records the artifact set and provenance;
- `docs/operations/release-artifact-evidence.json` records the reproducibility review;
- API, worker, migration, and frontend artifacts are all identified; and
- the source-only caveat is removed only for the artifact-backed release path.

### P1 — Install and upgrade (`production.install-upgrade`)

Rehearse clean installation, forward migrations, supported upgrade, configuration validation, and
forward recovery or explicitly documented manual recovery on deployment-like data. Preserve backup,
reconciliation, and compatibility evidence for invariant-sensitive facts.

**Exit evidence:**

- `tooling/production/install-upgrade.ts` executes the selected rehearsal;
- `docs/operations/production-install-upgrade-evidence.json` records versions, data shape,
  migration result, recovery result, and stop conditions; and
- no rollback claim is made where only forward recovery is supported.

### P2 — Reviewed entry profile (`production.entry-profile`)

Create a machine-readable manifest for the selected `entry + postgresql` profile. The evaluator must
reject missing or stale subsystem evidence, incompatible selections, unapproved financial
authority, and optional-provider activation without its own gates.

**Exit evidence:**

- `deploy/profiles/entry.json` names the selected profile capabilities and owners;
- `tooling/production/profile-evaluate.ts` validates the manifest;
- `docs/operations/production-profile-evidence.json` records review and approval; and
- the profile remains explicit about its limits: the current Compose artifact is not production HA
  evidence until this gate passes.

## Conditional profiles (not registered)

Register `standard`, `scale`, or `enterprise` only when each profile has committed scope, an owner,
selected subsystem dependencies, install/upgrade evidence, recovery evidence, and a reviewable
manifest. Do not infer profile support from `roadmap.global-exit` or from a source tag.

## Measures

| Measure                                      | Target before a supported-profile claim |
| -------------------------------------------- | ---------------------------------------- |
| `production.*` mechanical gates              | all three pass                           |
| artifact provenance gaps                     | `0`                                      |
| unsupported upgrade claims                   | `0`                                      |
| stale or missing profile dependencies        | `0`                                      |
| optional providers activated without approval | `0`                                      |
| profile owner omissions                      | `0`                                      |

Deployment and recovery thresholds remain reviewed operational evidence.

## Stop conditions

Stop the support claim when a source tag is presented as an artifact-backed deployment, upgrade or
recovery support is inferred rather than rehearsed, a profile changes financial authority through a
single unchecked setting, an optional provider is silently activated, the manifest omits owners or
selected evidence, or approval is inferred from `roadmap.global-exit` alone.
