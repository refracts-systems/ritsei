# RITSEI Document Rendering Architecture

> **Status:** Proposed canonical subsystem architecture
>
> **Activation:** [ADR-0081](../decisions/0081-adopt-document-ast-rendering-platform.md) is
> proposed. This document is the design source of truth for the proposed platform; it does not
> activate renderer dependencies or production document routes.
>
> **Owns:** Document snapshots, renderer-independent Document AST, template and asset versioning,
> renderer capability selection, artifact reproducibility, rendering workload isolation, and
> rendering security.
>
> **Related documents**
>
> - Runtime architecture: [`./architecture-spec-v4.md`](./architecture-spec-v4.md)
> - Durable execution: [`./durable-execution.md`](./durable-execution.md)
> - Source-of-truth and derived-capability non-interference:
>   [`../decisions/0083-enforce-non-interference-between-source-of-truth-and-derived-capabilities.md`](../decisions/0083-enforce-non-interference-between-source-of-truth-and-derived-capabilities.md)
> - State and consistency: [`./state-and-consistency.md`](./state-and-consistency.md)
> - External integration surface: [`./integration-architecture.md`](./integration-architecture.md)
> - Financial ledger: [`./financial-ledger.md`](./financial-ledger.md)
> - Documentation and financial baseline:
>   [`../decisions/0036-define-p2-document-and-financial-baseline.md`](../decisions/0036-define-p2-document-and-financial-baseline.md)
> - One semantic owner per invariant:
>   [`../decisions/0015-one-semantic-owner-per-invariant.md`](../decisions/0015-one-semantic-owner-per-invariant.md)
> - Owner-local business surface:
>   [`../decisions/0046-adopt-owner-local-business-surface-and-generated-ergonomics.md`](../decisions/0046-adopt-owner-local-business-surface-and-generated-ergonomics.md)
> - UUIDv7 persistent identities: [`../decisions/0051-adopt-uuidv7-for-persistent-identities.md`](../decisions/0051-adopt-uuidv7-for-persistent-identities.md)
> - Document platform versus Odoo-style rendering reference:
>   [`./reference/document-platform-vs-odoo.md`](./reference/document-platform-vs-odoo.md)
> - Document rendering decision:
>   [`../decisions/0081-adopt-document-ast-rendering-platform.md`](../decisions/0081-adopt-document-ast-rendering-platform.md)

## 1. Position

RITSEI is a **Document Platform**, not an HTML-to-PDF wrapper and not a wrapper around one PDF
library.

The long-lived contract is:

```text
Business Context
      ↓
Document Schema
      ↓
Document AST
      ↓
Renderer Capability
      ↓
Artifact
```

A renderer is replaceable infrastructure. Customer templates must not encode a dependency on
Puppeteer, Chromium, WeasyPrint, Typst, `pdfnative`, Krilla, or any future backend.

The platform produces documents for PDF, print, email, archive, and other output channels. It does
not become the source of business truth. The owning domain remains authoritative for lifecycle,
amounts, status, tax meaning, posting, settlement, and corrections.

## 2. Ownership boundary

ADR-0036 remains in force: RITSEI does not create a universal mutable `documents` table or a
catch-all generic document domain.

| Concern | Owner |
| --- | --- |
| Business meaning, lifecycle, authorization, corrections | Owning domain such as Sales, Procurement, or Accounting |
| Issued-state transition and legal/business snapshot | Owning domain |
| Document context and AST contracts | RITSEI document-rendering capability, after owner contracts exist |
| Template selection and immutable template versions | A narrowly scoped configuration capability; ownership must be decided before persistence |
| Render job admission, retry, fencing, and orchestration | Runtime plus `foundation/jobs` |
| Concrete renderer adapters | `platform/` or approved runtime adapters |
| Artifact bytes and retention | Storage adapter and deployment profile |
| Preview/designer UI | `apps/web`; never authoritative |
| External email, archive, or delivery protocols | `modules/integrations` through public contracts |

The rendering capability owns an output projection and its operational metadata. It must not mutate
Sales, Procurement, Accounting, Inventory, Billing, or Tax facts directly. A future template registry
must not be introduced as a generic business domain merely because several domains render documents.

## 3. Core pipeline

```text
Owning Business Domain
        ↓
Immutable Document Snapshot
        ↓
Document Context
        ↓
Template Resolver
        ↓
Versioned Document Schema
        ↓
Renderer-independent Document AST
        ↓
Capability Resolver
        ↓
Bounded Renderer Worker
        ↓
Immutable Artifact + Render Metadata
```

For a normal transactional document:

```text
SalesOrder / PurchaseOrder / future Invoice
        ↓
owner-approved snapshot
        ↓
AST
        ↓
transactional renderer
        ↓
PDF
```

For imported HTML:

```text
Resolved HTML + resolved assets
        ↓
Capability declaration
        ↓
StaticHtmlRenderer or BrowserHtmlRenderer
        ↓
PDF
```

## 4. Contract layers

### 4.1 Document snapshot

The owning domain creates a snapshot at the business boundary that requires a stable document
representation. The snapshot contains the exact facts needed for rendering and references the
owner's contract and version.

A snapshot must not be rebuilt from mutable current state when reproducing an issued artifact.
Customer address, line descriptions, prices, tax values, currency, legal entity, and payment terms
must come from the issued snapshot, not a later database read.

The snapshot is not a second business authority. It is a versioned, auditable copy of owner-owned
facts for document output.

### 4.2 Document context

Templates receive a validated, tenant-scoped `DocumentContext` through an Effect Schema contract.
The context exposes business data and presentation-safe derived values, not repositories or
infrastructure.

Templates do not receive:

- PostgreSQL or Drizzle clients;
- domain repositories or service implementations;
- credentials, environment variables, filesystem access, or process handles;
- arbitrary tenant SQL or policy scripts;
- mutable live business state;
- remote network access.

Money remains exact. Templates consume formatted decimal strings or owner-approved minor-unit
values; floating-point arithmetic is not part of the document contract.

### 4.3 Document Schema and AST

A Document Schema describes the allowed structure and bindings. The compiler or resolver produces a
renderer-independent AST. The AST is the portable contract between template customization and
renderer adapters.

Initial node families are deliberately small:

```text
Text       Image        Stack        Row          Column
Grid       Table        Divider      Spacer       PageBreak
Condition  Repeat       Barcode      QRCode       Signature
Header     Footer
```

The AST must express pagination semantics where they affect correctness:

```text
repeatTableHeader
keepTogether
avoidRowSplit
pageBreakBefore
pageBreakAfter
minimumRowsBeforeBreak
```

The AST must not contain provider objects, browser DOM nodes, JSX, SQL, arbitrary JavaScript, or
renderer-specific layout handles.

### 4.4 Render request and artifact

A render request binds:

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

A rendered artifact records the immutable output location or bytes, content hash, media type, page
count when available, and the metadata needed for audit and reproduction. An artifact is not the
business document itself and cannot replace the owning domain's lifecycle.

## 5. Renderer taxonomy

Renderer selection is capability-based, not library-based.

| Capability family | Proposed backend | Intended use | Status |
| --- | --- | --- | --- |
| `native-transactional` | `pdfnative` | Invoice-like, order, receipt, voucher, and other bounded ERP output | Proposed default; requires benchmark and dependency review |
| `publishing` | Typst | Annual, audit, legal, regulatory, and long-form reports | Proposed; separate publishing profile |
| `static-html` | WeasyPrint | HTML/CSS compatibility without browser semantics | Proposed compatibility path |
| `browser-html` | Puppeteer + Chromium | JavaScript, dynamic DOM, canvas, browser-specific templates | Proposed exception path |
| `lightweight-browser` | Lightpanda candidate | Future browser-compatible fast path | Watchlist only |
| `native-performance` | Krilla candidate | Future measured high-throughput native path | Deferred until profiling proves need |

No row authorizes a dependency installation. Activation requires the gates in [ADR-0081](../decisions/0081-adopt-document-ast-rendering-platform.md).

### 5.1 Transactional default

The proposed default for bounded transactional documents is a native renderer without a browser:

```text
Document AST → NativeDocumentRenderer → PDF
```

This targets predictable resource use, low startup cost, bounded operational surface, and high
throughput for documents such as Purchase Orders, Sales Orders, receipts, delivery notes, and
payment vouchers. Invoices and tax documents remain subject to their owning domain decisions; the
renderer architecture does not activate Billing or Tax policy.

### 5.2 Publishing profile

Typst is a separate publishing profile for long-form documents with report semantics such as
cross-references, footnotes, table of contents, and complex pagination. It is not forced onto
transactional documents.

### 5.3 HTML compatibility profiles

HTML is an interoperability layer, not the internal representation.

Static HTML/CSS that declares no browser semantics may use:

```text
StaticHtmlRenderer → WeasyPrint → PDF
```

Templates that require JavaScript, dynamic DOM, canvas, browser APIs, or Chrome-specific behavior
may use:

```text
BrowserHtmlRenderer → Puppeteer → Chromium → PDF
```

Puppeteer and Chromium remain implementation details. A customer declares required capabilities,
not a library name.

Lightpanda can be evaluated behind `BrowserHtmlRenderer` only after it proves the required DOM,
JavaScript, CSS, font, image, paged-media, print, PDF, and determinism characteristics. Krilla can
be evaluated behind `NativeDocumentRenderer` only after measured profiling demonstrates that the
active renderer is a material bottleneck.

## 6. Template and asset versioning

Template resolution is deterministic:

```text
Company Template
      ↓ if absent
Industry Template
      ↓ if absent
RITSEI Default Template
```

A template is immutable after release. A new layout creates a new template version. Issued output
records at least:

```text
template_id
template_version
document_schema_version
renderer_family
renderer_version
asset_versions
render_fingerprint
```

Templates are declarative. They may bind to approved context fields and use the safe node/style DSL,
but they may not execute arbitrary tenant code.

Assets follow the same version boundary:

```text
upload → validate → normalize → hash → store → render cache
```

Logo, signature, icon, image, and font assets must be tenant-scoped, size-limited, versioned, and
available without an uncontrolled remote fetch during rendering.

## 7. Determinism and issued artifacts

The target reproducibility equation is:

```text
Document Snapshot
+ Template Version
+ Document Schema Version
+ Renderer Version
+ Asset Versions
= reproducible output
```

Render input must not depend on:

- current time unless it is an explicit snapshot field;
- randomness;
- mutable remote resources;
- remote fonts or images;
- runtime-loaded external JavaScript;
- unversioned environment configuration.

When a document is issued, its artifact is immutable. A later template version creates a new artifact
for a new render; it does not rewrite historical output. Reproduction may be byte-identical where the
backend guarantees it, or semantically equivalent under a documented renderer conformance policy.

PDF is evidence/output, not source of truth:

```text
Owner Business State → Snapshot → Document AST → Artifact
```

The reverse path is not authoritative.

## 8. Workload and worker architecture

Rendering belongs to bounded asynchronous execution for bulk work and issued artifacts. A bounded
interactive request may reuse a ready artifact or submit a job, but an HTTP worker must not fan out
unbounded rendering work.

```text
HTTP request
    ↓
create or reuse idempotent render job
    ↓
bounded queue
    ↓
renderer worker
    ↓
object storage / artifact store
    ↓
READY or FAILED
```

The first lifecycle is:

```text
DRAFT → QUEUED → RENDERING → READY
                         └→ FAILED → QUEUED
READY → ISSUED → IMMUTABLE ARTIFACT
```

Workload classes remain the existing `command`, `query`, and `async` model. Creating a render job
is a protected command when it changes durable state; rendering, rebuild, export, and bulk generation
are bounded async work. Async-triggered business commands re-enter command admission,
authorization, idempotency, and the owning transaction boundary.

Renderer families use separate queues or protected worker budgets:

```text
Native Queue  → native workers
Report Queue  → publishing workers
Browser Queue → isolated browser workers
```

A browser worker may reuse a browser process, but it must isolate contexts, enforce timeouts, and
recycle processes by age, memory, document count, crash, or failure policy. Native and browser
concurrency must be benchmarked separately.

Render jobs require an idempotency key, a render fingerprint, retry policy, timeout, cancellation
behavior, and explicit unknown-outcome/manual-recovery handling. Job leases and stale-writer fencing
follow [`durable-execution.md`](./durable-execution.md); a lease token alone is not a fencing proof.

A batch must use bounded workers, never unbounded `Promise.all` fan-out.

### 8.1 Render cost and capacity economics

The architecture does not eliminate rendering cost. It avoids paying the most expensive rendering cost
for documents that do not require browser semantics.

The undesirable capacity model is:

```text
request count × full-browser rendering cost
```

The target model is:

```text
unique versioned render input × selected renderer cost
```

For an issued document, the normal lifecycle is:

```text
issue once
    ↓
render once
    ↓
store immutable artifact once
    ↓
serve the artifact many times
```

A repeated request with the same tenant-scoped render fingerprint should reuse the existing artifact
or idempotent render job rather than start another render. Render cost is therefore driven primarily
by unique combinations of snapshot, template/schema, renderer, asset, policy, locale, and output
format—not by the number of downloads or email deliveries of the same artifact.

This changes the capacity question from “PDF is inherently expensive” to “which bounded renderer
profile and resources limit this workload?” Native transactional rendering, publishing, and browser
compatibility can each receive separate worker budgets and admission limits. A slow browser fallback
must not determine the capacity of the native transactional queue.

Likely limiting resources include:

- native layout and pagination CPU;
- image decoding, scaling, and compression;
- font shaping and embedding, especially for CJK and RTL text;
- very large tables or ASTs;
- renderer memory and process startup;
- queue wait and worker concurrency; and
- artifact storage, network, and egress throughput.

Illustrative distributions such as “most documents use the native path and a small minority use
browser compatibility” are benchmark hypotheses, not architecture guarantees. Throughput claims
must be established per renderer family using the corpus and measurements in Section 11. The goal is
not to hide the remaining cost, but to make it linear, bounded, observable, and replaceable.

## 9. Security and resource limits

Tenant templates and HTML are hostile inputs. The renderer boundary must deny by default:

```text
filesystem access
process execution
environment variables
database access
internal network access
cloud metadata access
arbitrary external scripts
```

Resolved HTML should be self-contained or use an explicit asset allowlist. Browser rendering requires
process/container isolation, disabled or restricted network access, filesystem isolation, execution
timeouts, output-size limits, and crash/restart policy.

Each renderer declares quotas such as:

```text
max_ast_nodes
max_pages
max_table_rows
max_image_resolution
max_asset_bytes
max_total_asset_bytes
max_render_time
max_output_size
max_browser_memory
```

The capability resolver must reject a template whose declared requirements exceed the selected
renderer or tenant policy. A compatibility escape hatch must not become an authorization escape
hatch.

## 10. Pagination, fonts, and internationalization

Pagination is part of the AST contract, not an accidental renderer side effect. Conformance tests
must cover repeated headers, row splitting, keep-together behavior, page breaks, long text, images,
barcodes, signatures, and empty/large collections.

Font policy must cover:

```text
font registry
font validation
font fallback
font embedding or licensing
font subsetting
Unicode coverage
CJK and RTL coverage
font versioning
```

Issued output must not rely on a mutable remote font.

## 11. Observability and benchmark corpus

Each render records bounded metrics:

```text
document_render_duration_ms
document_render_cpu_ms
document_render_peak_memory_bytes
document_render_page_count
document_render_size_bytes
document_render_queue_wait_ms
document_render_success_total
document_render_failure_total
```

Browser workers additionally record process RSS, restarts, crashes, timeouts, active contexts, and
browser render duration. Tenant IDs, template IDs, and document IDs must not become uncontrolled
high-cardinality metric labels.

Every renderer release is evaluated against real-shaped fixtures, not only synthetic microbenchmarks:

```text
small invoice-like document
large order with many lines
multi-page statement
image-heavy document
barcode/QR document
Unicode, CJK, and RTL document
static legacy HTML
JavaScript/browser HTML
```

The benchmark compares cold start, warm render, CPU, peak memory, latency, throughput, PDF size,
pagination, font fidelity, layout fidelity, and failure rate. A renderer is not promoted because it
wins one synthetic benchmark.

## 12. Activation gates

No production renderer is activated until all relevant gates pass:

1. **Contract gate:** owner snapshot, context, schema, AST, and artifact contracts are typed and
   versioned.
2. **Ownership gate:** the pilot document has a decided owning domain and does not create a generic
   document authority.
3. **Security gate:** tenant isolation, asset allowlists, sandboxing, quotas, and failure behavior
   are tested.
4. **Determinism gate:** repeated renders of the same versioned input are reproducible under the
   declared equivalence policy.
5. **Conformance gate:** pagination, font, Unicode, asset, and renderer capability tests pass.
6. **Workload gate:** queues, admission, idempotency, retry, fencing, timeout, and command reserve
   behavior are measured.
7. **Operational gate:** storage, retention, cleanup, metrics, alerts, and manual recovery are
   documented.
8. **Dependency gate:** license, version, Deno/runtime compatibility, security posture, and upgrade
   ownership are reviewed.

## 13. Delivery sequence

The smallest safe sequence is:

1. Define the renderer-independent snapshot, context, AST, artifact, and fingerprint contracts.
2. Build a fixture corpus and conformance harness without adding a production renderer.
3. Select one already-decided owner document, such as Sales Order or Purchase Order, for a native
   renderer pilot. Do not start with an unresolved Invoice, Tax, or Settlement domain.
4. Add bounded render jobs, idempotency, artifact storage, and audit metadata.
5. Benchmark and activate the native transactional profile only if the gates pass.
6. Add static HTML compatibility and its security/asset policy.
7. Add browser compatibility as an explicit exception with a separate queue and isolation profile.
8. Add publishing and future backends only when their document class and evidence justify them.

## 14. Explicit non-goals

This architecture does not:

- create a universal business `Document` aggregate;
- decide ownership of Billing, Tax, Payment, Settlement, or Regulatory domains;
- make PDF bytes the source of truth;
- make HTML the canonical internal representation;
- make a browser the default renderer;
- authorize arbitrary tenant JavaScript or network access;
- install or activate `pdfnative`, Typst, WeasyPrint, Puppeteer, Chromium, Lightpanda, or Krilla;
- claim that a renderer is production-ready without the activation gates above.

## 15. Current implementation boundary

The current implementation slice is intentionally production-gated. It may add typed snapshot, AST,
capability, fingerprint, job-payload, benchmark, conformance, and test-artifact contracts, plus one
owner-local Purchase Order pilot and an evaluation-only adapter for the selected native candidate. It
must not add a production PDF route, browser worker, template persistence model, production
artifact-retention promise, or a new Process job type/migration.

`pdfnative` and its RITSEI adapter are evaluation dependencies only until the activation gates pass.
The adapter is used for conformance and benchmark evidence; it does not activate a production
renderer profile. Browser compatibility remains documentation-only in this phase. Puppeteer,
Chromium, Lightpanda, and other browser backends remain uninstalled and unactivated until the
capability, sandbox, fidelity, determinism, dependency, and workload gates are separately proven.
Publishing backends remain unactivated as well.
