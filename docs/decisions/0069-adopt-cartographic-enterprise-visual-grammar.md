# ADR-0069: Adopt the Cartographic Enterprise Visual Grammar

- Status: Superseded
- Date: 2026-09-01
- Amends: ADR-0056 for visual language and renderer policy
- Compatible with: ADR-0009, ADR-0010, ADR-0048, ADR-0057
- Supersedes: None
- Superseded by: ADR-0090 (Operational Clarity visual language)

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Design system: [`../architecture/design-system.md`](../architecture/design-system.md)
> - Frontend architecture: [`../architecture/frontend.md`](../architecture/frontend.md)
> - Architecture enforcement: [`../architecture/architecture-enforcement.md`](../architecture/architecture-enforcement.md)
> - Semantic frontend design system: [`./0056-adopt-ritsei-semantic-frontend-design-system.md`](./0056-adopt-ritsei-semantic-frontend-design-system.md)

## Context

ADR-0056 established RITSEI's semantic frontend design-system boundary, Product Patterns, Interaction
Grammar, Visual Grammar, Ark UI boundary, and constrained Panda CSS foundation. It intentionally left
the concrete visual language open.

RITSEI needs a recognizable enterprise visual language that can represent movement, relationships,
capacity, pressure, location, commitments, processes, time, and exceptions without forcing every
domain into the same dashboard layout. It also needs a renderer policy that preserves semantic HTML,
accessibility, deterministic operation, and long-session performance when richer material or dense
visualization is useful.

## Decision

RITSEI adopts **Cartographic Enterprise UI** as its canonical visual grammar.

The visual thesis is:

> **A living map of the business — precise enough to operate, expressive enough to understand.**

The visual emphasis is an art-direction target:

```text
55% Cartographic Structure
25% Architectural Paper
15% Precision Geometry
 5% Optical Glass
```

These ratios are qualitative guidance, not a universal layout, per-component compliance budget, or
requirement that every screen contain a map. The business question selects the projection. Forms and
tables may remain almost entirely semantic HTML/CSS.

The canonical design system defines the exact palette, semantic aliases, typography, geometry,
surface, material, state, accessibility, motion, domain-composition, and component rules. Its
important constraints are:

- cartographic primitives represent declared business meaning and are not wallpaper;
- source business relationships and graph cycles remain domain facts, not visual errors;
- semantic state is never communicated by color alone;
- optical glass is limited to temporary interactive depth and requires contrast/performance evidence;
- standard tables, forms, labels, controls, focus, and accessible alternatives remain DOM-owned; and
- visual ratios never override readability, auditability, authorization, or business truth.

RITSEI adopts an HTML-first renderer boundary:

```text
WebGPU
↓
Canvas 2D / SVG
↓
CSS
↓
Static semantic UI
```

The fallback is mandatory. WebGPU is optional and may be used only for measured procedural topology,
dense visualization, dynamic fields, particle movement, spatial visualization, or material rendering
that lower layers cannot satisfy. It must not own semantics, business aggregation, authorization,
workflow state, or authoritative facts.

The default implementation target is approximately `80–95%` HTML/CSS and `5–20%` Canvas/WebGPU for
experiences that actually require a visual renderer. This is a planning target, not a requirement for
every route.

No WebGPU, map, chart, glass, or design-system dependency is activated by this ADR. Activation stays
behind the implementation and evidence gates in the canonical design-system document.

## Alternatives Considered

### Generic SaaS card language

Rejected. It does not provide a durable representation vocabulary for business movement, pressure,
relationships, and operating state, and it encourages every screen to become the same card grid.

### Literal maps or graphs everywhere

Rejected. Cartographic language is broader than geographic mapping. Accounting, forms, tables, and
record views must remain precise and scannable; the projection follows the user's question.

### Glassmorphism as the primary material

Rejected. Glass is temporary interactive depth, not the base surface. Broad use harms contrast,
readability, power consumption, and information hierarchy.

### WebGPU-first application rendering

Rejected. HTML owns semantics, accessibility, interaction, and standard enterprise data. GPU use is
optional, replaceable, measurable, and must have a usable fallback.

### Feature-local colors and visual effects

Rejected. Raw colors, arbitrary spacing, and local material choices create competing dialects and
make accessibility and state meaning drift between domains.

### Prohibit cyclic source relationships

Rejected. Enterprise roles such as founder, director, shareholder, and beneficial owner may form valid
cycles. The non-reflexive rule belongs to the related-party projection result, not the source graph.

## Consequences

### Positive

- RITSEI has a recognizable visual identity tied to operating meaning rather than decoration.
- Domain teams can compose different projections while sharing tokens, states, patterns, and
  interaction behavior.
- Semantic HTML, accessible fallbacks, and renderer replacement remain first-class constraints.
- Paper, terrain, contour, route, density, and marker treatments have controlled roles.
- Forms, tables, financial numbers, and audit evidence remain readable and precise.

### Negative

- The design system needs stronger token, contrast, usage-contract, and renderer validation.
- Some visual work requires a projection decision instead of a local styling shortcut.
- WebGPU and glass work cannot be accepted on appearance alone; it needs measured evidence.
- The frontend activation spike must prove SolidJS, Ark UI, Panda CSS, and renderer compatibility.

### Risks

- The material ratios could be misread as a rigid page template.
- Cartographic effects could become decorative background noise.
- A visual projection could be mistaken for current business authority or authorization evidence.
- GPU scenes could consume power or hide semantics if fallbacks are not tested.
- Exact primitive colors could be used directly instead of through semantic tokens.

## Validation

Before broad frontend adoption, prove:

- semantic token and recipe enforcement rejects raw colors, arbitrary spacing, and unapproved style
  props;
- light, dark, high-contrast, and reduced-motion variants preserve state meaning and contrast;
- shared components have usage contracts, keyboard behavior, empty/loading/error/degraded states,
  localization review, and visual regression coverage where appropriate;
- forms, tables, charts, and process interactions remain usable without Canvas or WebGPU;
- any WebGPU scene has device detection, visibility-based rendering, bounded frame rate, static-frame
  caching, runtime failure recovery, and a tested semantic fallback;
- renderer and vendor imports remain inside the internal UI layer;
- bundle, frame-time, memory, interaction-latency, and long-session power measurements justify any
  richer renderer; and
- no frontend representation becomes an authorization, transaction, workflow, or domain-state
  authority.

The detailed current contract is maintained in [`../architecture/design-system.md`](../architecture/design-system.md).
