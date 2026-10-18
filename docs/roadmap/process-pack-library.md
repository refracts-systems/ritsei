# Process Pack Library Roadmap

> **Status:** Canonical roadmap subdocument
>
> **Track ID:** `packs`
>
> **Owns:** sequencing, dependencies, readiness, measures, and exit criteria for the Business Pack
> Library.
>
> **Measured by:** `packs.contract` exit evidence (reviewed; the mechanical evaluator was retired by ADR-0089).
>
> **Detailed semantics belong to:**
> [`../architecture/process-studio.md`](../architecture/process-studio.md).
>
> **Product positioning belongs to:**
> [`../architecture/reference/process-pack-positioning.md`](../architecture/reference/process-pack-positioning.md).
>
> **Reviewed:** September 2, 2026
>
> **Related documents**
>
> - Roadmap index: [`./README.md`](./README.md)
> - Product vision: [`../product/vision.md`](../product/vision.md)
> - Process Studio: [`./process-studio.md`](./process-studio.md)
> - Domain maturity: [`./domain-maturity.md`](./domain-maturity.md)
> - Authorization: [`../architecture/authorization.md`](../architecture/authorization.md)
> - Analytics:
>   [`../architecture/analytics-architecture.md`](../architecture/analytics-architecture.md)
> - Capability governance:
>   [`../decisions/0020-adopt-capability-release-and-runtime-governance.md`](../decisions/0020-adopt-capability-release-and-runtime-governance.md)
> - AI boundary:
>   [`../decisions/0063-define-governed-ai-recommendation-and-agent-boundary.md`](../decisions/0063-define-governed-ai-recommendation-and-agent-boundary.md)

## Scope

A pack is a distribution artifact for public, typed capabilities and editable Process IR drafts. It
is not a domain model, approval, capability grant, transaction, deployment, or runtime principal.

```text
profile → curated pack → exact public capabilities → readiness diagnostics
        → editable DRAFT → static validation → ordinary review/release/deployment
```

Do not add arbitrary pack JavaScript, SQL, prompts, private service calls, automatic grants,
approvals, deployments, migrations, autonomous actions, or a marketplace before trust and curation
are proven.

## Current baseline

The repository has public pack schemas, exact `(kind, id, version)` resolution, an experimental
Distribution starter pack, three editable starter drafts, a Templates lane, and tests for decoding,
version mismatches, draft provenance, and Process IR isolation. It does not have pack persistence,
installation mutation, onboarding authority, automatic approval/release/deployment, or execution.

Only Phase 0 is registered and measured today. Phases 1–6 are ordered future stages, not completed
or mechanically tracked work; add a registry gate only when a stage has an implementation owner and
executable or operational evidence.

## Sequence

### Phase 0 — Contract slice (current)

Show and resolve a safe in-memory pack. Required proof: public schemas, required-capability
diagnostics, canonical action IDs, editable drafts, ordinary `DRAFT` provenance, and no browser-side
command execution.

**Exit:** `packs.contract` passes. This is complete for the contract-only slice, not for production
installation.

### Phase 1 — Catalog-backed resolution (unregistered)

Resolve required/optional references through the versioned Process Catalog. Report owner, stability,
scope, compatibility, missing, retired, and tenant-availability reasons without granting authority.
Register this phase only after a named owner adds a catalog-backed resolver and executable contract
proof; the current in-memory pack contract is not enough.

**Dependency:** Process Studio 0.8, public domain contracts, authorization metadata, and release
governance.

**Exit:** every required reference resolves to an allowed public catalog entry or returns an
actionable failure.

### Phase 2 — Draft materialization

Load a pack and its templates into tenant/actor-scoped editable `DRAFT` definitions using typed
configuration/form references, deterministic compatibility checks, persistence, and idempotent
selection.

**Dependencies:** stable Process IR, definition storage, tenant/actor authorization, and exact
version pinning.

**Exit:** repeated selection does not create uncontrolled duplicates and cannot alter released
definitions or business facts.

### Phase 3 — Distribution vertical pack

Deliver one owner-reviewed bounded Distribution flow with order confirmation, stock correction, and
revenue posting, plus required capabilities, configuration guidance, static validation, and an
operator guide. This scope does not imply Billing, invoicing, payments, settlement, tax, or
receivables ownership. Use a representative tenant fixture, not only frontend data.

**Exit:** a new tenant reaches a valid editable `DRAFT`; every missing prerequisite has an
actionable explanation.

### Phase 4 — Profile onboarding

Add typed profile facts, deterministic profile-to-pack matching, explicit user confirmation,
measured readiness coverage, accessible keyboard-complete interaction, and advisory-only AI if later
approved.

**Dependencies:** identity and tenant scope, authorization, frontend routing, pack catalog, and
provider isolation under ADR-0063.

**Exit:** recommendation cannot grant capabilities, alter policy, approve, release, or execute.

### Phase 5 — Governed versions and upgrades

Add immutable pack versions, owner provenance, compatibility ranges, reviewed upgrade proposals,
diffs/impact reports, version-pinned process definitions, and rollback/manual recovery guidance.

**Dependencies:** capability retirement, release/deployment separation, Process Studio 0.9, audit
correlation, and recovery proof.

**Exit:** upgrades are authorized, idempotent, reviewable, and reversible or explicitly manual
recovery-only; running instances remain pinned.

### Phase 6 — Curated scale

Add contribution/review workflow, conformance tests, provenance, compatibility matrix,
deprecation/retirement, safe discovery, and partner distribution only after plugin/integration trust
gates pass.

**Exit:** a new pack needs no private imports, cross-domain table writes, second catalog, or
authorization/runtime exception.

## Future MVP gate (unregistered)

```text
[ ] one owner-reviewed Distribution pack
[ ] immutable pack identity and version
[ ] exact required PUBLIC capability resolution
[ ] actionable missing-capability diagnostics
[ ] three editable process drafts
[ ] tenant/actor-scoped draft materialization
[ ] static Process IR validation
[ ] no automatic approval, release, deployment, or execution
[ ] audit-visible pack and template provenance
[ ] representative contract and accessibility tests
```

The MVP is complete when first-use time-to-value improves without creating a new authority boundary.
This checklist does not affect `roadmap.global-exit` until it becomes a registered gate.

## Measures

| Measure                        | Definition                                         | Target                                       |
| ------------------------------ | -------------------------------------------------- | -------------------------------------------- |
| first valid DRAFT time         | profile selection to first valid editable draft    | baseline, then reduce without lowering proof |
| required capability resolution | required references resolved on first attempt      | `100%` for a released pack                   |
| draft validation pass rate     | drafts passing static validation without repair    | `100%` for curated assets                    |
| unresolved required references | count and age by pack/version                      | `0` for release                              |
| duplicate materialization rate | repeated same intent creating extra drafts         | `0`                                          |
| upgrade compatibility          | reviewed upgrade proposals that pass compatibility | `100%` or explicit manual recovery           |
| pack support incidents         | incidents caused by missing/misleading assumptions | trend to `0`                                 |

The mechanical contract gate is `packs.contract`; operational measures become executable when the
corresponding installation and onboarding services exist.

## Stop conditions

Stop pack expansion when a pack hides immature domain semantics, versions drift without diagnostics,
selection implies authority, upgrades rewrite released/running behavior, asset descriptors become a
second semantic layer, or distribution introduces untrusted code/providers.

## Decisions for later review

- signing and provenance requirements for pack artifacts;
- compatibility ranges in the pack manifest versus the catalog;
- profile taxonomy and ownership of profile facts;
- typed catalogs for forms, decisions, policies, and projections;
- pack persistence and tenant installation ownership; and
- marketplace/partner publication authority.

Any choice that changes trust, ownership, authorization, durability, or release semantics requires
an ADR before activation.
