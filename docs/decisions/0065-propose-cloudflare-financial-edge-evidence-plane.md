# ADR-0065: Propose Cloudflare as the Financial Edge and Evidence Plane

- Status: Superseded
- Date: 2026-08-31
- Amends: None
- Compatible with: ADR-0040, ADR-0041, ADR-0064
- Supersedes: None
- Superseded by: ADR-0091 (framework reset)

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Proposed GCP staging platform:
>   [`./0064-propose-gcp-financial-staging-platform.md`](./0064-propose-gcp-financial-staging-platform.md)
> - Financial staging infrastructure selection:
>   ../financial/staging-infrastructure-selection.md
> - Financial ledger architecture: [`../architecture/financial-ledger.md`](../architecture/financial-ledger.md)

## Context

ADR-0064 proposes GCP as the first production-equivalent financial staging platform because the
rehearsal requires PostgreSQL 19+, a supervised six-replica TigerBeetle topology, controlled disk
and network failure domains, production custody, independent restore, and immutable evidence.

Cloudflare is a strong candidate for edge delivery and can provide useful adjacent services such as
DNS, WAF, ingress, Workers, Hyperdrive, and R2 object storage. Those capabilities must not be
confused with a financial authority host. Cloudflare Containers' ephemeral local filesystem and the
unproven PostgreSQL 19 Hyperdrive path make Cloudflare unsuitable as the primary PostgreSQL or
TigerBeetle host for the current readiness gates.

The existing financial authority boundary, signer contract, evidence envelope, and frozen readiness
gates must remain unchanged.

## Decision

**Propose Cloudflare as an optional adjacent financial edge and independent evidence plane, not as
the financial execution platform.**

The proposed boundary is:

```text
Internet
   |
   v
Cloudflare DNS / WAF / optional Workers
   |
   | private, authenticated application path
   v
GCP staging
   |
   +-- API and workers
   +-- PostgreSQL 19+
   +-- TigerBeetle x6
   +-- GCP KMS/HSM
   +-- GCS locked evidence store
   |
   +-- hash-bound secondary evidence copy --> Cloudflare R2 Bucket Lock
```

Cloudflare may:

- terminate or protect public ingress;
- route requests to the private GCP API path;
- run optional non-authoritative edge logic;
- store a separate hash-verified evidence copy in R2;
- provide independent evidence-storage failure and recovery observations.

Cloudflare must not:

- host TigerBeetle replicas or financial authority state;
- host PostgreSQL control-plane authority for the readiness profile;
- receive TigerBeetle credentials or provider client objects;
- become the signer custody authority;
- authorize accepted transfers or provide PostgreSQL fallback;
- make Hyperdrive a financial command or readiness path before PostgreSQL 19 compatibility is proven;
- treat an R2 copy as a second evidence authority.

The canonical evidence identity remains the RITSEI/Accounting record and signed canonical hash. GCS
and R2 are storage locations with independently auditable retention; a secondary copy is accepted
only after hash, identity, and retention verification.

## Alternatives considered

### Cloudflare as the complete staging platform

Rejected for the current readiness profile. It does not provide the required controlled persistent
TigerBeetle replica storage and PostgreSQL 19 production-equivalent host boundary. Cloudflare may
remain useful at the edge without taking authority-host responsibility.

### GCP-only edge and evidence

Still valid and remains the minimum path. Cloudflare is optional; the financial gates must be
executable without Workers, Hyperdrive, or R2.

### Cloudflare R2 as the sole evidence store

Not selected as the default. A single provider boundary is simpler, but the proposed R2 use case is
stronger as an independent, hash-bound secondary copy. The primary evidence owner and accepted
record remain provider-neutral.

### Cloudflare Keyless SSL as financial custody

Rejected for the financial signer boundary. TLS key operations do not replace the general-purpose
Ed25519 custody, key-version resolution, audit, rotation, and fail-closed behavior required by the
financial evidence signer.

### Cloudflare Hyperdrive on the financial path

Deferred. Hyperdrive may be evaluated for non-authoritative application access only after the
PostgreSQL 19 compatibility, private path, pooling, timeout, authorization, and outage behavior are
proven. It must not be required for the first financial readiness rehearsal.

## Consequences

### Positive

- Global ingress, WAF, and DNS can remain separate from financial authority.
- R2 can provide an independent provider boundary for hash-verified evidence retention.
- The GCP authority-host recommendation and Cloudflare edge strengths can coexist without dual
  financial authority.
- Cloudflare remains removable without changing `FinancialLedgerPort` or Accounting semantics.

### Negative

- The architecture has an additional provider, credential set, audit surface, and failure path.
- R2 replication requires explicit hash, object identity, retention, and reconciliation handling.
- Private ingress and alert/evidence delivery paths require additional operational testing.
- Cloudflare adds no relief for TigerBeetle quorum, PostgreSQL restore, or provider-wide inventory
  requirements.

### Risks

- A secondary evidence copy could be misinterpreted as a second accepted record.
- Hyperdrive or Workers could accidentally receive command credentials or financial authority access.
- R2 retention and account separation may be configured without independently verifiable audit logs.
- Edge outages could be confused with authority outages unless metrics distinguish the planes.
- Provider separation may increase recovery complexity without improving a specific gate.

## Validation

Before accepting any Cloudflare integration, prove:

1. The GCP API remains reachable through a private authenticated path without exposing PostgreSQL or
   TigerBeetle.
2. Cloudflare receives no financial provider credential or client object.
3. Workers, if used, cannot authorize financial commands outside the existing API and Accounting
   contracts.
4. R2 objects contain only the approved evidence envelope, manifest, signature, and hash-bound
   references; no secrets or private keys are present.
5. R2 Bucket Lock prevents replacement and deletion for the approved retention period.
6. An R2 copy is accepted only when its record identity, canonical hash, signature, and retention
   state match the primary evidence record.
7. Cloudflare outage and R2 outage produce observable, fail-closed behavior without PostgreSQL or
   TigerBeetle fallback.
8. Hyperdrive is excluded from the financial readiness path until PostgreSQL 19 compatibility is
   demonstrated.
9. The GCP custody signer remains the production signing authority unless a later approved decision
   changes it.
10. Removing Cloudflare leaves all current financial readiness contracts and gates executable.

## Approval boundary

This is a proposed adjacent-platform decision, not an activation approval. Approval must specify:

- whether Cloudflare is used at all for the staging cohort;
- whether R2 is a secondary evidence copy or a separate approved retention destination;
- the independent account, credential, retention, and audit owners;
- the private ingress mechanism and failure-domain claim;
- whether Workers are deployed and exactly which non-authoritative operations they may perform;
- the explicit exclusion of Containers and Hyperdrive from TigerBeetle/PostgreSQL authority paths.

Until those decisions are approved, ADR-0064's GCP-only minimum remains the provisioning baseline and
`infrastructure_ready_to_provision` remains `no`.
