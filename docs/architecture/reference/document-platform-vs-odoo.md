# Reference: RITSEI Document Platform vs Odoo-Style Report Rendering

> **Status:** Reference analysis
>
> **Reviewed:** September 6, 2026
>
> **Owns:** Comparative background, the document-compiler analogy, and the proposed customization
> tiers for RITSEI document templates.
>
> **Does not own:** Binding document contracts, renderer selection, artifact authority, or tenant
> security rules. Those remain with the canonical document-rendering architecture and ADR-0081.
>
> **Related documents**
>
> - Document rendering architecture: [`../document-rendering.md`](../document-rendering.md)
> - Document AST decision: [`../../decisions/0081-adopt-document-ast-rendering-platform.md`](../../decisions/archive/0081-adopt-document-ast-rendering-platform.md)
> - P2 document and financial baseline: [`../../decisions/0036-define-p2-document-and-financial-baseline.md`](../../decisions/0036-define-p2-document-and-financial-baseline.md)
> - Documentation boundaries: [`../../documentation-boundaries.md`](../../documentation-boundaries.md)

## Purpose

This reference explains the conceptual difference between a conventional ERP report pipeline and the
RITSEI document-platform direction. The comparison is intentionally approximate: it is a design
contrast, not a complete audit of Odoo's current implementation.

The central distinction is not `pdfnative` versus `wkhtmltopdf`. It is where the document model lives.

## 1. The fundamental distinction

A conventional template-and-print pipeline can be summarized as:

```text
Business Record
      ↓
QWeb / HTML Template
      ↓
HTML
      ↓
PDF Engine
      ↓
PDF
```

RITSEI's target pipeline is:

```text
Business Truth
      ↓
Immutable Document Snapshot
      ↓
Document Context
      ↓
Document Schema
      ↓
Document AST
      ↓
Capability-Based Renderer
      ↓
Immutable Artifact
```

The most important consequence is:

```text
HTML is an output compatibility format.
HTML is not the canonical document model.
```

The RITSEI AST can target several backends:

```text
Document AST
├── native transactional PDF
├── publishing/typesetting output
├── static HTML compatibility
└── browser HTML compatibility
```

This lets a transactional document use a native path without making HTML or a browser part of its
extension contract.

## 2. Templates describe documents, not renderers

In a renderer-coupled system, a template tends to inherit the semantics of its presentation and
rendering technology:

```text
template
    ↓
HTML / template semantics
    ↓
renderer-specific behavior
```

RITSEI places an intermediate contract between customization and rendering:

```text
customer template
      ↓
Document Schema / Template DSL
      ↓
Document AST
      ↓
selected renderer
```

The customer describes the document's meaning and structure. The platform selects a renderer that
satisfies the declared capabilities. A customer template should not need to know whether an adapter
uses a native PDF library, Typst, WeasyPrint, Chromium, or a future backend.

## 3. Capability-based renderer selection

Renderer selection is based on required document capabilities, not only on a generic “PDF report”
label:

| Document requirement | Suitable profile |
| --- | --- |
| Text, tables, images, QR, bounded transactional layout | Native transactional renderer |
| Footnotes, table of contents, cross-references, long-form pagination | Publishing renderer |
| Existing HTML/CSS without browser semantics | Static HTML renderer |
| JavaScript, dynamic DOM, canvas, or browser APIs | Browser HTML renderer |

Conceptually:

```text
required capabilities
        ↓
capability resolver
        ↓
compatible renderer profile
```

This is similar to a compiler choosing a backend for an intermediate representation. The template
declares what it needs; the platform owns the execution choice.

A browser is therefore an explicit compatibility exception, not the default document runtime.

## 4. Snapshot first, render later

Rendering directly from current ORM state makes historical reproduction depend on mutable records:

```text
current business record
        ↓
 template
        ↓
 report
```

RITSEI separates issuance from later rendering:

```text
business state
      ↓
owner-approved issue boundary
      ↓
immutable document snapshot
      ↓
context / AST
      ↓
artifact
```

For example:

```text
2026: customer address = Bandung; invoice issued
2028: customer address = Jakarta
```

Re-rendering the 2026 artifact uses the issued snapshot and therefore retains Bandung. It does not
read `Customer.currentAddress` as a substitute for historical truth.

The owning domain remains authoritative for lifecycle, amounts, tax meaning, posting, settlement,
and correction behavior. The snapshot is an immutable rendering input, not a second business
aggregate.

## 5. PDF is an artifact, not the business document

A conventional print action often looks like:

```text
click Print → generate report
```

The platform model is:

```text
business event
      ↓
versioned snapshot
      ↓
render request
      ↓
immutable artifact
```

An artifact can be bound to:

```text
snapshot checksum
template version
document schema version
renderer family and version
asset versions
render fingerprint
content hash
```

A document family may therefore have multiple representations without treating PDF as business
truth:

```text
Owner business state
├── immutable snapshot
├── PDF artifact
├── XML or e-invoice artifact
├── HTML representation
└── future channel-specific artifact
```

The artifact is evidence/output. It does not replace the owning domain record or its corrections.

## 6. Document system as a compiler pipeline

The most useful analogy is:

```text
source code
   ↓
AST / IR
   ↓
backend
   ↓
machine code
```

Applied to RITSEI:

```text
business facts
   ↓
Document Context
   ↓
Document Schema
   ↓
Document AST / IR
   ↓
renderer backend
   ↓
PDF, HTML, or another artifact
```

This analogy explains why the AST must remain renderer-independent. A renderer may change without
requiring every tenant template to be rewritten, provided the AST contract and capability semantics
remain compatible.

The AST is not a second business model. It is a portable presentation intermediate representation
produced from an owner-controlled, versioned context.

## 7. Designer output is AST, not HTML

A visual designer can expose document concepts such as:

```text
Text · Image · Table · Totals · QR Code · Signature · Tax Summary
```

The designer should produce a versioned document definition or AST-like structure, for example:

```json
{
  "type": "Document",
  "children": [
    { "type": "Text", "binding": "invoice.number" },
    { "type": "Table", "binding": "invoice.lines" },
    { "type": "Totals", "binding": "invoice.total" }
  ]
}
```

This example is illustrative, not the binding Effect Schema contract. The important boundary is:

```text
visual designer
      ↓
Document Schema / AST
      ↓
renderer adapter
```

not:

```text
visual designer
      ↓
HTML or pdfnative-specific API
```

A preview may use the same renderer contract as production output, but the preview remains a
non-authoritative projection.

## 8. Customization tiers

The goal is ERP-level customization without making HTML, a browser, or a PDF library the extension
API.

### Tier 1: Visual customization

Business users can adjust:

- logo, font, color, spacing, borders, and density;
- header and footer content;
- address, total, and column placement; and
- approved size and alignment properties.

These changes should remain inside the safe style and layout vocabulary.

### Tier 2: Structural customization

Power users can add, remove, or reorder approved sections:

```text
Invoice
├── Header
├── Customer
├── Item Table
├── Tax Summary
├── Payment Information
├── QR Code
└── Signature
```

Another tenant may use:

```text
Invoice
├── Government Header
├── Customer
├── Item Table
├── VAT Breakdown
├── Regulatory Reference
└── Dual Signature
```

Both definitions still compile to the same renderer-independent document contract.

### Tier 3: Conditional customization

Templates may use a small, deterministic expression language for approved conditions:

```text
if customer.country == "ID"
    show NPWP

if invoice.total > 100000000
    show approval signature

if company.industry == "telecom"
    show service period
```

The safe vocabulary may include primitives such as:

```text
Condition · Repeat · approved expression · money() · date() · uppercase() · number()
```

This is deliberately not arbitrary JavaScript. Expressions must be bounded, typed, tenant-scoped,
and evaluated against the supplied context.

### Tier 4: Developer or enterprise components

A customer-specific component can encapsulate a reusable business presentation concept:

```text
IndonesianTaxSummary
BankRemittanceSlip
TelecomUsageSummary
ManufacturingLotTraceability
```

The component boundary remains:

```text
custom component
      ↓
Document AST
      ↓
renderer
```

It must not draw directly through a concrete PDF engine or acquire database access. A custom
renderer/plugin is a separate, higher-trust extension concern and requires its own accepted
architecture and activation gates.

A practical target is for approximately 95% of customization to stop at Tier 1 or Tier 2, with Tier
3 handling controlled policy variation and Tier 4 reserved for genuinely reusable enterprise needs.
The percentage is a planning heuristic, not a measured product commitment.

## 9. Tenant template resolution

Template versions remain immutable after release. A resolver can apply tenant and industry
specificity without forking the platform core:

```text
request document
      ↓
tenant template?
   ├── yes → tenant template version
   └── no
        ↓
industry template?
   ├── yes → industry template version
   └── no
        ↓
RITSEI default template version
```

Illustrative identifiers:

```text
invoice/default@v1
invoice/acme@v7
invoice/government-format@v3
```

The selected template, schema version, assets, and renderer capability requirements become part of
the versioned render input. Template resolution must remain deterministic and tenant-scoped.

## 10. Context and security boundary

Templates must not know the database or live domain implementation. They receive a validated
`DocumentContext`, such as:

```text
invoice.number
invoice.customer.name
invoice.lines
invoice.total
```

They must not receive:

```text
PostgreSQL or Drizzle clients
repositories or service implementations
credentials or environment variables
filesystem or process handles
arbitrary tenant SQL
uncontrolled network access
```

The business layer prepares the context. This protects templates from internal persistence changes
and keeps domain authorization and data ownership outside the presentation DSL.

Arbitrary customer JavaScript is also out of scope. Code such as `fetch(...)`, `fs.readFile(...)`,
`process.env`, or unbounded loops would turn customization into an execution and isolation problem.
A constrained expression language provides useful conditional behavior without surrendering the
execution model.

## 11. Comparative summary

| Area | Odoo-style report pipeline | RITSEI document platform |
| --- | --- | --- |
| Canonical representation | QWeb/HTML-oriented report template | Renderer-independent Document AST |
| Business input | Current record/context | Immutable owner-approved snapshot |
| Template contract | Presentation and renderer semantics | Semantic document definition |
| Renderer choice | Usually coupled to the report path | Capability-driven backend resolution |
| Browser role | Normal HTML rendering path | Explicit compatibility escape hatch |
| PDF role | Generated report output | Versioned immutable artifact |
| Designer output | Layout/template representation | Document Schema / AST definition |
| Extension boundary | Template and presentation stack | Context, safe DSL, AST, then renderer |
| Renderer dependency | Relatively coupled | Replaceable adapter implementation |
| Architecture analogy | Template engine plus print path | Compiler pipeline |

The comparison can be summarized as:

> **A conventional ERP report system treats PDF as the result of printing a template. RITSEI treats
> the document as a renderer-independent model that is compiled into one or more artifacts.**

The corresponding customization principle is:

> **Customers may change the shape and presentation of a document, but they may not redefine the
> document platform's execution model.**
