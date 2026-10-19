# Roadmap Track Considerations

> **Status:** Reference analysis; informs three registered tracks and deferred stages
>
> **Reviewed:** September 2, 2026
>
> **Review corpus:** The 136 Markdown files enumerated under `docs/` on September 2, 2026, including
> canonical architecture, reference material, operations, development workflows, current roadmaps,
> and ADRs through ADR-0071.
>
> **Does not own:** Active sequencing, gate status, architecture semantics, or provider selection.
> Those remain with the roadmap index, subsystem architecture, and accepted ADRs.
>
> **Related documents**
>
> - Roadmap index: [`../../roadmap/README.md`](../../roadmap/README.md)
> - Documentation boundaries:
>   [`../../documentation-boundaries.md`](../../documentation-boundaries.md)
> - Decision map: [`../../decisions/decision-map.md`](../../decisions/decision-map.md)
> - Frontend architecture: [`../frontend.md`](../frontend.md)
> - Design system: [`../design-system.md`](../design-system.md)
> - Deployment posture: [`../../deployment/README.md`](../../deployment/README.md)
> - Release workflow: [`../../development/releasing.md`](../../development/releasing.md)

## Purpose

This review asks which missing delivery concerns are distinct enough to become roadmap tracks, which
should be added to existing tracks, and which should remain unregistered until a concrete capability
or measured need exists.

A new track is justified only when it has:

1. a distinct semantic or operational owner;
2. committed delivery scope rather than an optional architecture possibility;
3. ordered dependencies and stop conditions;
4. executable or reviewed operational evidence; and
5. a release or activation outcome that cannot be represented honestly by an existing track.

## Recommendation Summary

| Candidate                                                      | Consideration                                               | Activation trigger                                                   | Reason                                                                                                                          |
| -------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Workload isolation                                             | Registered `workload` track                                | The next supported profile claims a protected command reserve        | It has accepted staged adoption gates and is a shared operational dependency that no current track owns.                        |
| Frontend readiness                                             | Registered `frontend` track                                | A production frontend and representative user workflow are committed | The SPA, state, design-system, accessibility, and performance contracts are selected but only the Process Designer is measured. |
| Production profile readiness                                   | Registered narrow `production` track                       | A release will promise installable artifacts and a supported profile | Source releases exist, but artifact, installation/upgrade, and profile-approval evidence are not roadmap-owned.                 |
| Identity and authorization                                     | Strengthen `domain`; keep provider activation profile-owned | D0 implementation or a selected external identity profile begins     | Domain D0 owns internal foundations; external provider activation is a composition/deployment concern.                          |
| Analytics                                                      | Defer a dedicated track                                     | One named dashboard, fact contract, metric, and projection are owned | The architecture deliberately selects no module, schema, API, DSL, or provider yet.                                             |
| Search                                                         | Defer a dedicated track                                     | A named cross-domain or ranked discovery surface is selected         | Exact domain-local PostgreSQL queries belong to their owning domain; ranked/global providers remain optional.                   |
| Messaging and durable engines                                  | Add conditional gates to existing tracks                    | PgQue or `pg_durable` activation starts                              | Messaging and Process already own their respective semantics; a new umbrella runtime track would mix independent primitives.    |
| Stateful runtime, plugins, Zig, WebGPU, autonomous AI, Billing | Do not add tracks now                                       | Evidence- or ADR-gated                                               | These remain optional, proposed, deferred, or explicitly outside current activation scope.                                      |

## Registered Track 1: Workload Isolation

**Registered track ID:** `workload`

**Why a separate track is warranted:**

- ADR-0034 establishes non-interference as an accepted operational target.
- The canonical architecture defines five ordered adoption gates.
- PostgreSQL, analytics, search, reporting, Process, and external workloads may depend on the same
  admission and resource-reserve fabric.
- PostgreSQL GA can verify database capabilities, but it cannot own router admission, executor
  budgets, cross-plane credentials, or application-level overload behavior.

Canonical evidence:

  Criteria**
- [`../../decisions/0034-adopt-non-interference-overload-isolation.md`](../../decisions/0034-adopt-non-interference-overload-isolation.md)
- [`../postgresql-19-architecture.md`](../postgresql-19-architecture.md), **Guarantee Boundary** and
  **Operational Requirements**
- [`../../operations/database-roles.md`](../../operations/database-roles.md)

### Registered gates

```text
workload.classify
    ↓
workload.command-reserve
```

| Gate                       | Minimum exit evidence                                                                                                                                                                                                                     |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workload.classify`        | Command/query/async metadata is explicit; in-flight work, queues, deadlines, statements, results, and expensive dimensions are bounded; representative route cost is measured.                                                            |
| `workload.command-reserve` | Hard per-plane ceilings exist; query and async work cannot acquire the reviewed command ingress, executor, or connection reserve; adversarial multitab and retry-storm tests preserve the approved command success and latency objective. |

### Conditional phases that should remain unregistered

```text
workload.projection-isolation.<route>
WorkloadCells
recursive shuffle sharding
```

Physical projection isolation applies only to a named dashboard, report, search, or analytical route
whose deployment claims hard query-to-command non-interference. Register WorkloadCells or shuffle
sharding only after earlier gates pass and measurements show unacceptable blast radius. Database
sharding and multi-region canonical writes remain separate decisions.

### Stop conditions

- logical semaphores are described as physical isolation;
- a projection executor possesses a command or PostgreSQL-primary credential;
- overload falls back to the primary or command pool;
- adaptive limits can exceed hard ceilings;
- queues or waits are unbounded; or
- published claims omit shared dependencies and excluded failure classes.

## Registered Track 2: Frontend Readiness

**Registered track ID:** `frontend`

**Why a separate track is warranted:**

The current Process Studio designer gate proves one bounded interaction surface. It does not prove a
buildable and deployable application shell, frontend-wide contract decoding, remote-state ownership,
forms/tables, shared Product Patterns, accessibility, localization behavior, route performance, or
design-system activation.

Canonical evidence:

- [`../frontend.md`](../frontend.md), **Accessibility**, **Performance**, **Testing**, and
  **Completion Criteria**
- [`../design-system.md`](../design-system.md), **Activation, validation, and governance**
- [`../../decisions/0048-define-effect-application-architecture-and-frontend-state-ownership.md`](../../decisions/0048-define-effect-application-architecture-and-frontend-state-ownership.md)
- [`../../decisions/0056-adopt-ritsei-semantic-frontend-design-system.md`](../../decisions/0056-adopt-ritsei-semantic-frontend-design-system.md)
- [`../../decisions/0069-adopt-cartographic-enterprise-visual-grammar.md`](../../decisions/0069-adopt-cartographic-enterprise-visual-grammar.md)

### Registered gates

```text
frontend.shell
    ├── frontend.application-boundaries ──┐
    └── frontend.design-system ──────────┴── frontend.accessibility-performance
```

| Gate                                 | Minimum exit evidence                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `frontend.shell`                     | The Vite/SolidJS SPA has a reproducible production build, typed routing, transport decoding, and no backend implementation imports.                                                                                                                                                                                                            |
| `frontend.application-boundaries`    | TanStack Solid Query owns shared cached server state where cache policy is required; local uncached async composition may remain in Solid primitives; forms, tables, route state, invalidation, loading, conflict, denial, degraded, and recovery behavior have representative tests; authoritative state is not mirrored into browser stores. |
| `frontend.design-system`             | RITSEI-owned UI wrappers enforce approved Kobalte/Panda boundaries, semantic tokens, Product Pattern contracts, density/theme behavior, and no feature-local vendor imports.                                                                                                                                                                       |
| `frontend.accessibility-performance` | Critical workflows pass keyboard, screen-reader, focus, contrast, high-contrast, reduced-motion, zoom/localization, route-splitting, bundle, interaction, and long-session checks.                                                                                                                                                             |

### Conditional gate

`frontend.vgpu` should remain unregistered until a named cartographic workload demonstrates measured
benefit over HTML, CSS, SVG, or Canvas. Activation must preserve a complete semantic DOM fallback,
deterministic browser/headless/mock behavior, failure recovery, bounded frame rate, and long-session
power evidence.

### Stop conditions

- frontend state becomes a shadow domain model;
- vendor types or imports escape the internal UI layer;
- Canvas or WebGPU becomes the only semantic or interactive representation;
- accessibility is postponed until after feature completion;
- a permanent rendering loop is used for static scenes; or
- SolidStart/SSR is introduced without its separately approved requirement.

## Registered Track 3: Production Profile Readiness

**Registered track ID:** `production`

**Accountable owner:** the release and operations composition root.

**Why a separate track may be warranted:**

The release workflow intentionally supports source-only pre-releases. Current tags do not promise a
build artifact, package distribution, production deployment, or supported upgrade path. Deployment
profiles describe topology posture, but no roadmap owns the narrow sequence from reproducible
artifacts to a reviewed profile manifest.

This candidate must not redefine PostgreSQL recovery, workload isolation, access, frontend, Process,
integration, or financial activation. It composes their accepted results for one selected profile.

Canonical evidence:

- [`../../development/releasing.md`](../../development/releasing.md), **Release status** and
  **Migration and upgrade caveats**
- [`../../deployment/README.md`](../../deployment/README.md), **Deployment Profiles**
- [`../postgresql-19-architecture.md`](../postgresql-19-architecture.md), **Operational
  Requirements**
- [`../state-and-consistency.md`](../state-and-consistency.md), recovery and reconciliation rules

### Registered gates

```text
production.artifacts
    ↓
production.install-upgrade
    ↓
production.entry-profile
```

| Gate                         | Minimum exit evidence                                                                                                                                                                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `production.artifacts`       | Reproducible API, worker, migration, and frontend artifacts exist with version and provenance records.                                                                                                                                          |
| `production.install-upgrade` | Clean install, forward migration, supported upgrade, rollback or forward-recovery, configuration validation, and compatibility rehearsal pass on deployment-like data.                                                                          |
| `production.entry-profile`   | A machine-readable profile manifest names selected capabilities and accepted subsystem evidence; its evaluator rejects missing gates, incompatible selections, or stale approval; release and operations owners explicitly approve the profile. |

Add separate profile gates such as `production.standard` only when those profiles receive committed
support. If profile composition becomes dynamic, use a reviewed manifest evaluator rather than
pretending one static dependency list represents every deployment.

### Dependency rule

A profile depends only on the capabilities it selects. TigerBeetle, an external connector, physical
projection isolation, `pg_durable`, PgQue, or an optional renderer must not become a universal
production blocker for profiles that do not use them.

### Stop conditions

- a source tag is presented as a supported deployment;
- upgrade or subsystem recovery support is inferred rather than referenced from accepted evidence;
- one configuration switch changes financial authority or consistency semantics;
- a profile silently activates an optional provider;
- the profile manifest omits its accountable release or operations owner; or
- deployment approval is inferred from `roadmap.global-exit` alone.

## Additions to Existing Tracks

The following gaps need measured gates, but not new roadmap documents.

### ERP primitives

For an upgrade cohort containing legacy ambiguous rows, add or strengthen a P0 migration/backfill
gate covering exact operator mapping, row preservation, missing/duplicate/unknown mapping rejection,
and zero inferred Legal Entity ownership. Clean-install validation should not require fictional
legacy mappings.

Evidence:

- [`../../decisions/0028-complete-p0-identity-party-and-branch-metadata.md`](../../decisions/0028-complete-p0-identity-party-and-branch-metadata.md)
- [`../../decisions/0029-rename-user-and-party-public-vocabulary.md`](../../decisions/0029-rename-user-and-party-public-vocabulary.md)

### Domain maturity

Keep Identity, Auth, and Authorization in D0, but add explicit gates for:

```text
domain.identity-lifecycle
domain.authorization-foundation
domain.capability-grammar
```

Required domain evidence includes disabled-account and membership-revocation behavior, scoped
grants, native relationship/object checks, SoD, explainable denial, canonical capability naming, and
fail-closed unknown/stale results.

Evidence:

- [`../identity-and-principals.md`](../identity-and-principals.md)
- [`../authorization.md`](../authorization.md)
- [`../../decisions/0030-user-account-lifecycle-and-tenant-membership.md`](../../decisions/0030-user-account-lifecycle-and-tenant-membership.md)
- [`../../decisions/0031-capability-naming-and-business-verb-conventions.md`](../../decisions/0031-capability-naming-and-business-verb-conventions.md)
- [`../../decisions/0058-define-provider-neutral-identity-and-authentication-boundary.md`](../../decisions/0058-define-provider-neutral-identity-and-authentication-boundary.md)
- [`../../decisions/0059-define-replaceable-relationship-authorization-engine.md`](../../decisions/0059-define-replaceable-relationship-authorization-engine.md)

Issuer-plus-subject mapping, external provider conformance, principal provenance, credential
rotation, and optional RelationshipEngine adapter activation are composition/deployment concerns.
Place them in the selected production profile, or create a separate `access` track only when they
have independent operational owners and multiple supported profiles.

### Process Studio

Add a fencing evidence gate between durable runtime and operational maturity:

```text
process.runtime085
    ↓
process.fencing087
    ↓
process.ops09
```

It should execute the shared-scope and stale-writer tests required by ADR-0052 through ADR-0055.
Generation must be checked at the actual side-effect mutation boundary and must remain separate from
idempotency identity.

Add a separate Process operational-activation gate only when a production Process deployment is
planned; mechanical catalog/runtime/designer passage is not an outage, upgrade, migration, or
operator-recovery rehearsal.

### Financial execution

Keep staging inside the existing financial track. Add visible provider-neutral preparation gates
before F6:

```text
financial.staging-decision
    ↓
financial.staging-provisioned
    ↓
financial.staging-preflight
    ↓
existing financial evidence evaluator
```

The decision gate must remain blocked until ADR-0064 or a replacement primary staging decision is
accepted. ADR-0065 is optional and needs an explicit accept, reject, or defer disposition;
Cloudflare must not become a mandatory dependency merely by remaining Proposed. No provider,
custody, retention, or topology choice is accepted before its required approval.

### External integration

Add one activation gate per selected provider after `integration.governed10`. Require a named owner,
version and compatibility range, credentials boundary, production endpoint, outage and
unknown-outcome rehearsal, duplicate-effect proof, secret rotation, redaction, and reviewed runbook.
Do not register an unspecified provider.

### Business Packs

Register Phase 1 only when catalog-backed resolution work has an owner. Keep Phases 2–6 unregistered
until their implementations start. Before Phase 3, replace an ambiguous complete “Order-to-Cash”
claim with a bounded non-billing Distribution flow, or make it depend on a future Billing ownership
ADR.

### Procurement

Add separate receipt correction, return, event-publication, and Level 3 gates when that capability
is requested. Do not widen the existing Purchase Order confirmation gate to imply Goods Receipt
maturity.

### Messaging and durable execution

- Add a Messaging-owned PgQue activation gate when real fan-out or throughput justifies activation.
- Add a Process-owned `pg_durable` compatibility and recovery gate only when it is selected over the
  compatibility job layer.
- Keep their event, job, and workflow semantics separate.

## Candidates to Defer

### Analytics

Do not register a general Analytics track yet. Preserve the accepted first-slice trigger: one
owner-approved Business Fact Contract, one named metric/dashboard with complete grain and
arithmetic, one rebuildable PostgreSQL projection, one bounded semantic query with current
authorization and `dataAsOf`, deterministic rebuild proof, no-primary-fallback behavior, and
command-reserve evidence. If that bounded slice has an implementation owner and independent release
outcome, reconsider an `analytics` track.

### Search

Domain-local exact and structured search belongs to the owning domain. Create a Search track only
when a named cross-domain, lexical, semantic, or hybrid surface has a representative corpus,
relevance target, authorization model, rebuild source, workload budget, and owner.

### Stateful Entity Runtime and `celld`

No general runtime track is warranted. First select one non-critical category, prove the local
adapter contract, benchmark the current PostgreSQL path, and satisfy the category-specific recovery,
fencing, reconciliation, and disablement gates. ADR-0026 remains Proposed.

### Plugins, localization, and marketplace

Keep these unregistered until the first concrete trusted plugin, declarative tenant extension,
jurisdiction adapter, or marketplace capability has an owner and trust decision.

### Zig and optional renderers

Zig and WebGPU remain workload-specific optimization gates. They do not justify platform roadmaps
without measured TypeScript, HTML/CSS/SVG, or Canvas limits.

### Billing and settlement

Invoices, AP/AR, payments, settlement, tax, FX, credit, and valuation remain deferred semantic
ownership decisions under ADR-0060. A roadmap must not infer their model from Process Pack or
Distribution terminology.

### Autonomous AI execution

Drafts and recommendations remain non-authoritative. Do not create an autonomous-agent roadmap
without a later accepted ADR and bounded safety evidence.

## Registered sequencing and conditional follow-ons

```text
Existing-track corrections
  legacy-cohort P0 migration evidence, when applicable
  Domain identity and authorization evidence
  Process fencing evidence
        ↓
Registered workload track
  classify → command reserve
        ↓
Registered frontend track
  shell → application boundaries → design system → accessibility/performance
        ↓
Registered production profile track
  artifacts → install/upgrade → entry-profile manifest
        ↓
Conditional product capabilities
  route-specific projection isolation
  first analytic dashboard
  cross-domain search
  selected connector provider
  PgQue / pg_durable
  optional runtime or renderer
```

Only registered, committed gates should enter `roadmap.global-exit`. Future or conditional stages
must remain visibly unregistered until they have an owner and executable evidence.

## Resulting roadmap decision

The three tracks are now registered in [`../../roadmap/README.md`](../../roadmap/README.md) with
executable gate IDs and explicit stop conditions. Registration commits the sequencing work, not
physical isolation, frontend provider activation, artifact publication, or deployment approval.

The following remain conditional and unregistered: route-specific projection isolation, WorkloadCells,
shuffle sharding, optional renderers, selected connector providers, PgQue/`pg_durable` activation,
analytics, search, and additional deployment profiles.
