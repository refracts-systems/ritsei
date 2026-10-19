# ADR-0081: Adopt a Document AST Rendering Platform

- Status: Superseded
- Date: 2026-09-06
- Amends: None
- Compatible with: ADR-0015, ADR-0034, ADR-0036, ADR-0040, ADR-0046, ADR-0051
- Supersedes: None
- Superseded by: ADR-0091 (product reset)

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Document rendering architecture: [`../architecture/document-rendering.md`](../architecture/document-rendering.md)
> - P2 document and financial baseline: [`./0036-define-p2-document-and-financial-baseline.md`](./0036-define-p2-document-and-financial-baseline.md)
> - One semantic owner per invariant: [`./0015-one-semantic-owner-per-invariant.md`](./0015-one-semantic-owner-per-invariant.md)
> - Owner-local business surface: [`./0046-adopt-owner-local-business-surface-and-generated-ergonomics.md`](./0046-adopt-owner-local-business-surface-and-generated-ergonomics.md)
> - Durable execution: [`../architecture/durable-execution.md`](../architecture/durable-execution.md)
> - Workload isolation: [`../architecture/workload-isolation.md`](../architecture/workload-isolation.md)
> - UUIDv7 persistent identities: [`./0051-adopt-uuidv7-for-persistent-identities.md`](./0051-adopt-uuidv7-for-persistent-identities.md)

## Context

RITSEI needs company-customizable output for invoices, orders, receipts, delivery notes, vouchers,
statements, reports, tax documents, regulatory documents, and other future document families. The
output must be reproducible, tenant-safe, suitable for high-volume generation, and independent of
one rendering library.

A browser-first pipeline would make HTML and Chromium the de facto platform primitive. A direct
low-level PDF library would make that library the de facto template and layout contract. Both
choices make future renderer replacement expensive and blur the boundary between business facts and
presentation output.

Existing architecture decisions require business documents to remain owner-local. ADR-0036 rejects
a shared mutable `documents` table and a generic document domain. Therefore this decision must add
rendering capability without creating a second business authority or deciding unresolved Billing,
Tax, Payment, or Settlement ownership.

## Decision

RITSEI will use a **renderer-independent Document AST** as the long-lived contract between
owner-approved document context and replaceable rendering adapters.

The proposed pipeline is:

```text
Owner Business State
        ↓
Immutable Document Snapshot
        ↓
Document Context
        ↓
Versioned Document Schema
        ↓
Document AST
        ↓
Renderer Capability
        ↓
Immutable Artifact
```

### Ownership and authority

- Owning domains retain document meaning, lifecycle, authorization, snapshot creation, issue state,
  correction behavior, and business truth.
- Rendering is an output capability. It must not mutate owner tables or become a generic document
  authority.
- Templates receive validated, tenant-scoped context. They do not receive database clients,
  repositories, credentials, filesystem access, internal network access, or arbitrary execution.
- Persistent render jobs and artifact metadata use the existing UUIDv7, job, fencing, idempotency,
  workload, and storage boundaries. They do not introduce a new top-level workload class.
- PDF and other rendered artifacts are evidence/output, not the source of business truth.

### Renderer families

The target capability families are:

| Capability | Target backend | Role |
| --- | --- | --- |
| Native transactional | `pdfnative` | Default candidate for bounded ERP documents |
| Publishing | Typst | Long-form, legal, audit, regulatory, and complex reports |
| Static HTML | WeasyPrint | HTML/CSS compatibility without browser semantics |
| Browser HTML | Puppeteer + Chromium | JavaScript, dynamic DOM, canvas, and browser-specific templates |
| Lightweight browser | Lightpanda | Future candidate behind the browser adapter |
| Native performance | Krilla | Future candidate after measured profiling |

These are adapter targets, not public contracts. No dependency is activated by this ADR. A customer
template declares capabilities such as `css`, `paged-media`, `javascript`, `browser-dom`, or
`canvas`; RITSEI selects the backend.

The proposed default is a non-browser native renderer for transactional documents. Browser rendering
is an explicit compatibility exception. Static HTML should use a non-browser path when its declared
capabilities permit it. Lightpanda and Krilla remain watchlist candidates until their compatibility,
fidelity, determinism, security, and performance gates pass.

### Versioning and reproducibility

A render binds the following versions and identities:

```text
snapshot_id
snapshot_version
template_id
template_version
document_schema_version
renderer_family
renderer_version
asset_versions
render_fingerprint
```

Issued artifacts are immutable. A changed template creates a new version and new output; it does not
rewrite historical artifacts. The render fingerprint covers the snapshot, template, schema, renderer,
and assets. Remote mutable resources, unversioned fonts, runtime external JavaScript, randomness, and
implicit current time are not valid render inputs.

### Execution and isolation

Bulk rendering and issued-artifact generation use bounded asynchronous jobs with explicit lifecycle,
idempotency, retry, timeout, cancellation, unknown-outcome, and manual-recovery behavior. Native,
publishing, and browser renderer families receive separate queues or protected worker budgets. A
browser worker has stronger isolation, lower concurrency, resource limits, and process-recycling rules
than a native worker.

Render requests must not use unbounded `Promise.all` fan-out. Job leases and stale-writer fencing
follow the existing durable-execution architecture. Async-triggered business commands re-enter
command admission, authorization, idempotency, and the owning transaction boundary.

### Safe template model

The initial template model is declarative. Its nodes are limited to text, images, layout containers,
tables, separators, page breaks, conditions, repetition, barcodes, QR codes, signatures, headers,
and footers, with controlled style properties. It includes explicit pagination semantics such as
repeated table headers, keep-together, row splitting, and page breaks.

Arbitrary tenant JavaScript, SQL, process execution, filesystem access, secrets, uncontrolled remote
fetches, and browser escape hatches are out of scope.

## Alternatives Considered

### HTML as the canonical internal representation

Rejected. HTML is useful as an interoperability format, but it carries browser/CSS/runtime semantics
that are unnecessary for many transactional documents and make native renderer replacement harder.

### Browser as the default renderer

Rejected. Chromium adds parsing, DOM, CSS, JavaScript, painting, print, process, and memory surface
to workloads that often require only bounded document layout. Browser compatibility remains available
for templates that explicitly require it.

### One direct PDF library as the platform contract

Rejected. It would couple customer templates and RITSEI contracts to one layout engine. A native
renderer may be the default implementation, but it remains behind the AST and capability boundary.

### A universal shared document domain

Rejected. It conflicts with ADR-0036, ADR-0015, and ADR-0046. Sales, Procurement, Accounting, and
future Billing or Tax domains retain their own semantics and facts.

### Automatic heuristic renderer selection

Rejected. Templates must declare capabilities so resolver behavior is deterministic and reviewable.

### Activate Lightpanda or Krilla immediately

Rejected. Both require conformance, security, determinism, compatibility, and benchmark evidence.
They remain replaceable future adapters.

## Consequences

### Positive

- Customer templates survive renderer replacement because the AST and capability contract remain stable.
- Transactional documents can avoid browser overhead while legacy and browser-dependent HTML remain
  supported.
- Owner-local business truth, immutable snapshots, audit metadata, and artifact reproduction are
  explicit.
- Native, publishing, static HTML, and browser workloads can be isolated and scaled independently.
- Tenant templates remain declarative and bounded rather than becoming arbitrary code execution.
- Future renderer choices are evidence-gated instead of embedded in domain contracts.

### Negative

- RITSEI must define and maintain an AST, schema compiler, conformance suite, asset policy, and
  renderer adapters.
- Some advanced CSS or browser behavior will not be available in the native path.
- The same template may need an explicit capability declaration or a compatibility profile.
- Artifact storage, retention, and renderer-version management add operational work.

### Risks

- A weak AST could become a lowest-common-denominator format and force premature renderer-specific
  escapes.
- Template and asset versioning can become a second source of truth if snapshots are not created by
  owning domains.
- Browser workloads can exhaust shared resources without separate queues, limits, and isolation.
- Claims of deterministic PDF output may exceed what a backend can guarantee; the equivalence policy
  must be explicit.
- Selecting a renderer before measuring real customer-shaped documents may optimize the wrong bottleneck.

## Validation

ADR-0081 may move to Accepted only after the following evidence exists:

1. A typed snapshot, context, schema, AST, artifact, and fingerprint contract is reviewed.
2. One already-decided owner document, such as Sales Order or Purchase Order, passes the end-to-end
   contract without a generic document authority.
3. A benchmark corpus covers small/large tables, pagination, images, barcodes, Unicode, CJK, RTL,
   static HTML, and browser HTML.
4. Renderer conformance proves capability rejection, pagination, font, asset, and error behavior.
5. Repeated version-pinned renders meet a documented byte or semantic-equivalence policy.
6. Tenant isolation, sandboxing, asset allowlists, quotas, timeouts, and network restrictions are
   tested.
7. Job idempotency, retry, fencing, bounded concurrency, queue isolation, artifact retention, and
   manual recovery are measured.
8. Dependency licensing, runtime compatibility, security ownership, upgrade policy, and operational
   cost are reviewed for each activated backend.

Until these gates pass, this ADR remains a proposal and no renderer package is a production
requirement.

The current implementation phase hardens browser compatibility in documentation only: browser
compatibility is a capability and isolation policy, not an activated Puppeteer, Chromium, Lightpanda,
or browser-worker dependency. The `pdfnative` native adapter is present only for evaluation,
benchmark, and conformance evidence; it does not activate a production renderer profile. Publishing
backends remain unactivated. The evaluation slice does not extend the Process job-type registry or
add a database migration.

## Related Documents

The detailed current target and non-goals are maintained in
[`../architecture/document-rendering.md`](../architecture/document-rendering.md). Business document
ownership remains governed by the owning domain and ADR-0036.
