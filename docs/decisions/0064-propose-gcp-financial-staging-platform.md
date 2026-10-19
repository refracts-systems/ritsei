# ADR-0064: Propose GCP as the First Financial Staging Platform

- Status: Superseded
- Date: 2026-08-31
- Amends: None
- Compatible with: ADR-0040, ADR-0041, ADR-0061
- Supersedes: None
- Superseded by: ADR-0091 (product reset)

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Financial staging infrastructure selection:
>   [`../financial/staging-infrastructure-selection.md`](../financial/staging-infrastructure-selection.md)
> - Financial staging topology: [`../financial/staging-topology.md`](../financial/staging-topology.md)
> - Financial ledger architecture: [`../architecture/financial-ledger.md`](../architecture/financial-ledger.md)
> - Financial evidence matrix: [`../financial/evidence-matrix.md`](../financial/evidence-matrix.md)
> - Proposed Cloudflare edge/evidence boundary:
>   [`./0065-propose-cloudflare-financial-edge-evidence-plane.md`](./0065-propose-cloudflare-financial-edge-evidence-plane.md)

## Context

Repository-local financial readiness implementation is complete. The current mechanical result is
`2/16` financial gates passed; the remaining gates require provider, infrastructure, or
`staging-real` evidence. The repository must now select the smallest environment that can honestly
exercise those gates without changing the frozen roadmap, weakening fail-closed behavior, or adding a
second financial authority.

The repository requires PostgreSQL 19+, TigerBeetle as the target financial authority, an unchanged
provider-neutral `FinancialLedgerPort`, production custody for evidence signing, immutable evidence
retention, independent restore, supervised workers, and operator-visible failure alerts.

No staging deployment is currently approved. This proposal therefore selects a default direction but
does not authorize provisioning, cluster formatting, WORM locking, financial data seeding, or
failure-injection execution.

## Decision

**Propose Google Cloud as the first production-equivalent staging platform**, subject to explicit
Operations, Security, Kernel, Accounting, and release-owner approval.

The proposed minimum shape is:

- Compute Engine for six dedicated TigerBeetle replicas, two per zone across three low-latency zones.
- Self-managed PostgreSQL 19+ on Compute Engine until a managed service proves the required major
  version, schema, backup, restore, and outage behavior.
- Two supervised worker/adapter VMs, one API host, and one temporary query/load-generator host.
- Cloud KMS HSM for the existing Ed25519 signing boundary, subject to custody approval.
- Secret Manager for workload-specific credentials and TLS material.
- Cloud Storage dual-region Bucket Lock for immutable evidence after retention approval.
- Cloud Monitoring and Pub/Sub, with an independent operator acknowledgement channel.
- Artifact Registry with digest-pinned images and immutable release metadata.
- A separate project, VPC, and region for paired PostgreSQL/TigerBeetle restore.

Cloudflare is not a replacement for this platform. It may be added as an optional edge and
hash-bound evidence plane under proposed ADR-0065, but it must not host PostgreSQL, TigerBeetle,
financial workers with provider authority, or the production signing custody boundary.

This proposal does not claim complete cloud-provider outage tolerance. If the approved production
availability objective includes provider loss, the TigerBeetle topology must use six replicas across
three cloud providers or an equivalently approved managed topology.

## Alternatives considered

### AWS single-cloud

AWS EC2, object-lock storage, IAM, secrets, monitoring, and HSM services are viable candidates, but
this proposal does not select them as the default because the existing signer contract requires
Ed25519 and the PostgreSQL 19+, TigerBeetle backup/restore, and custody combinations still require
provider-specific compatibility proof.

### Azure single-cloud

Azure VMs, immutable Blob Storage, managed identities, monitoring, and HSM services are viable
candidates, but the same PostgreSQL 19+, Ed25519, TigerBeetle recovery, and evidence-custody proofs
remain outstanding.

### Three-cloud TigerBeetle

Three-cloud placement gives a stronger provider-failure-domain claim, but it increases networking,
latency measurement, operational ownership, support, and cost. It should be selected only when the
approved production SLO requires complete cloud-provider loss tolerance.

### TigerBeetle managed service

The managed service may reduce provider lifecycle and recovery work. It remains a valid candidate,
but it must provide accepted evidence for quorum, backup/restore, complete inventory/history
observation, outage behavior, tenant scope, and auditability before replacing the self-managed
baseline.

### Managed PostgreSQL

A managed PostgreSQL service may replace the self-managed VM only after it supports PostgreSQL 19+
and the repository's migration, backup, restore, connection, outage, and isolation requirements.
Version support alone is not sufficient.

### Single-tenant HSM

A dedicated HSM may strengthen custody isolation but is not the minimum required capability. It is
reserved for a security or residency requirement that cannot be met by an approved multi-tenant HSM
service.

## Consequences

### Positive

- One provider supplies the proposed compute, identity, custody, evidence, observability, and
  artifact building blocks.
- The Ed25519 signer contract can remain unchanged while production custody is introduced.
- Three zones and six TigerBeetle replicas provide a bounded quorum and failure-rehearsal target.
- Restore, evidence, and workload identities can be isolated by project and service account.
- The proposal keeps provider products outside domain contracts and does not alter financial
  authority semantics.

### Negative

- PostgreSQL 19+ and TigerBeetle remain self-managed until managed compatibility is proven.
- A single-cloud topology does not prove complete cloud-provider loss tolerance.
- TigerBeetle backup/restore and complete inventory/history support remain provider-selection gates.
- WORM retention and KMS key choices create difficult-to-reverse operational commitments.
- Continuous staging cost is expected to be approximately `$1,300–$2,300/month`, excluding managed
  TigerBeetle support, unusual egress, and multi-cloud expansion.

### Risks

- A provider may not supply an accepted complete TigerBeetle inventory or cursor boundary.
- A raw provider snapshot may not be a supported TigerBeetle restore artifact.
- KMS algorithm, residency, or audit semantics may not satisfy the custody gate after integration.
- Managed PostgreSQL version support may lag the repository's PostgreSQL 19+ minimum.
- Alert delivery may be configured but not independently acknowledged or retained.
- The staging profile may accidentally claim production guarantees beyond its failure domains.

## Validation

Before any destructive operation, the decision must be approved and the following compatibility
checks must pass:

1. PostgreSQL 19+ starts with the complete repository schema, including `process.jobs`.
2. TigerBeetle supports the pinned client, six-replica topology, supported recovery, and complete
   inventory/history boundary required by global reconciliation.
3. The custody provider signs and independently verifies the existing Ed25519 payload without
   exporting private key material.
4. Workload identities are distinct, least-privileged, and visible in audit logs.
5. Evidence objects cannot be replaced or deleted after the approved WORM policy is locked.
6. Metrics and alerts capture delivery and operator acknowledgement.
7. A restore project can be created without any route or credential path to live authority.
8. Deployment artifacts are digest-pinned and reproducible.
9. The provider-neutral contracts remain unchanged.
10. The financial readiness gate remains `NO-GO` until accepted staging evidence exists.

## Approval boundary

This is a proposed infrastructure direction, not an accepted platform decision. Approval must record:

- selected TigerBeetle hosting model and failure-domain claim;
- PostgreSQL hosting and version proof;
- backup/restore and global inventory/history capability;
- HSM key policy, residency, rotation, and audit owner;
- WORM retention owner and duration;
- alert acknowledgement owner;
- cost ceiling and support model;
- whether the optional Cloudflare edge/evidence plane from ADR-0065 is adopted.

Until that approval exists, `infrastructure_ready_to_provision` remains `no`.
