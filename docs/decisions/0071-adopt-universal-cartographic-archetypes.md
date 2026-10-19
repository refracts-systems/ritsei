# ADR-0071: Adopt Seven Universal Cartographic Visual Archetypes

- Status: Superseded
- Date: 2026-09-02
- Amends: ADR-0069 for the cartographic semantic vocabulary and domain-composition model
- Compatible with: ADR-0056, ADR-0070
- Supersedes: None
- Superseded by: ADR-0090 (Operational Clarity visual language)

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Decision map: [`./decision-map.md`](./decision-map.md)
> - Design system: [`../architecture/design-system.md`](../architecture/design-system.md)
> - Frontend architecture: [`../architecture/frontend.md`](../architecture/frontend.md)
> - Cartographic renderer selection: [`./0070-select-vgpu-and-defer-typegpu.md`](./0070-select-vgpu-and-defer-typegpu.md)
> - Cartographic visual grammar: [`./0069-adopt-cartographic-enterprise-visual-grammar.md`](./0069-adopt-cartographic-enterprise-visual-grammar.md)

## Context

ADR-0069 established Cartographic Enterprise UI as RITSEI's visual grammar. Its initial examples
used domain or industry categories such as Retail, Manufacturing, Distribution, Finance, and
Services. Those categories are useful illustrations but are too coarse to serve as the foundation
for a universal ERP visual system.

Cartographic must not mean “topographic map on every page.” Repeated contours would quickly become
decoration rather than meaning. RITSEI needs a grammar that can express structure, relationship,
pressure, movement, boundary, and state across different businesses while preserving one stable
visual identity.

The design system also needs a disciplined answer to two related problems:

- how to create organic visual variation without unstable random output; and
- how to use visual depth without mapping every high number to “higher.”

## Decision

RITSEI defines seven universal business archetypes as the semantic foundation for cartographic
visual composition:

| Archetype | Meaning | Visual grammar |
|---|---|---|
| **Stock** | Something available, stored, or held | density, mass, level |
| **Flow** | Something moving from one point or state to another | route, direction, velocity |
| **Capacity** | Load compared with ability or limit | pressure, compression, elevation |
| **Value** | Money, exposure, or value concentration | field, concentration, variance |
| **Relationship** | People, accounts, vendors, teams, or networks | nodes, proximity, connection |
| **Progress** | Work moving toward an outcome | path, milestones, blockage |
| **Asset / Space** | A thing or place with position and state | regions, boundaries, markers |

A business composes archetypes; it does not select an industry-specific visual theme. The intended
coverage is approaching `95–97%` of common visual-operational ERP needs, not `97%` of all company
types; this remains a design hypothesis, not a measured guarantee. For example:

```text
Retail       = Stock + Flow + Value + Relationship
Manufacturing = Stock + Flow + Capacity + Progress + Asset / Space
Logistics    = Flow + Capacity + Asset / Space + Progress
Banking      = Value + Relationship + Flow + Capacity
Consulting   = Progress + Capacity + Relationship + Value
Construction = Progress + Asset / Space + Capacity + Stock + Value
Hospitality  = Capacity + Relationship + Stock + Value
Healthcare   = Capacity + Asset / Space + Flow + Relationship + Stock
Telecom      = Asset / Space + Flow + Capacity + Relationship + Value
Software/SaaS = Relationship + Capacity + Progress + Value
Education    = Relationship + Capacity + Progress + Asset / Space
Utilities    = Asset / Space + Flow + Capacity + Value
```

The archetypes are visual projection concepts. They do not own business facts, authorization,
workflow state, or domain invariants.

### Context-aware semantic mapping

A semantic value must map according to its meaning and context, not through one universal visual
operation:

```text
Inventory capacity ↑  → terrain elevation ↑
Risk ↑               → compression / pressure ↑
Movement ↑           → velocity ↑
Uncertainty ↑        → boundary softness ↑
Discrepancy ↑        → continuity breaks ↑
```

For example:

```text
Supplier risk         → pressure + contour density
Financial exposure    → concentration + depth
Machine failure risk  → local pulse + boundary
Project risk          → obstruction + path compression
Warehouse risk        → density + spatial pressure
```

The design system MUST NOT map:

```text
high number → everything becomes higher
```

### Material vocabulary

The renderer-neutral visual vocabulary includes more than color and opacity:

```text
density
amplitude
compression
roughness
continuity
velocity
depth
blur
field radius
contour count
mass
level
concentration
boundary softness
proximity
pulse
```

Business semantics map into this vocabulary through a CPU-side projection adapter. The resulting
visual intent may be rendered by SVG, CSS, Canvas, or the selected `vgpu` adapter, but it must not
become a second business model.

### Deterministic procedural variation

RITSEI distinguishes randomness from variation:

```text
randomness      ✗
variation       ✓
```

Visual variation MUST be deterministic for the same stable entity identity, semantic state, surface
type, and design-token inputs. Render-time `Math.random()` or equivalent unbounded randomness MUST
NOT determine the appearance of a business entity.

The conceptual pipeline is:

```text
stable entity identity
      +
semantic state
      +
surface type
      +
design tokens
      ↓
stable seed
      ↓
procedural variation
```

This permits two entities with the same state to share the same semantic meaning while retaining a
stable, organic family of shapes. The seed is an implementation input to the projection/renderer
adapter; raw business identifiers must not be exposed to shaders when a derived seed is sufficient.

### UI depth and semantic depth

RITSEI treats semantic depth as a required capability of the grammar, while allowing individual
screens to remain flat when depth would not clarify the business question. It separates stable UI
depth from data-driven semantic depth.

UI depth remains:

```text
L0 Canvas
L1 Content
L2 Card
L3 Interactive
L4 Modal
```

Semantic depth expresses a data condition inside a visual field. It is selected by archetype and
meaning. Risk may use compression and contour concentration; capacity may use elevation; movement
may use velocity; uncertainty may use boundary softness. Semantic depth MUST NOT be random and MUST
NOT replace explicit labels, semantic color, contrast, or accessible alternatives.

### Screen-level variation

As a design philosophy—not an engineering budget—RITSEI may target:

```text
90% deterministic structure
 8% semantic procedural variation
 2% entity-specific variation
```

This keeps layout, typography, spacing, interaction, and accessibility stable while allowing a
surface to respond to business conditions and a small amount of stable entity-specific variation.

## Alternatives considered

### Industry-specific design systems

Rejected. Retail, Manufacturing, Distribution, Finance, Services, and other industry themes would
multiply visual dialects and make cross-industry reuse harder. Industries should compose the same
archetypes instead.

### Topography on every page

Rejected. Contours and fields are useful only when they carry declared meaning. Forms, tables,
financial records, and ordinary workflows may use little or no cartographic material.

### Per-render randomness

Rejected. It creates unstable identity, visual churn after refresh, poor testability, and weak
semantic comparison between entities.

### One-dimensional height mapping

Rejected. Capacity, risk, movement, uncertainty, discrepancy, value, and relationship have different
semantics and need different material mappings.

## Consequences

### Positive

- RITSEI gets one cross-industry visual grammar instead of a theme per business type.
- Domain teams can compose Stock, Flow, Capacity, Value, Relationship, Progress, and Asset/Space.
- The same `risk` concept can be expressed correctly for suppliers, finance, machines, projects, or
  warehouses.
- Deterministic variation gives scenes organic character without unstable identity.
- Semantic depth adds material meaning without relying on loud glow or color alone.
- The material vocabulary remains compatible with SVG, CSS, Canvas, and `vgpu` fallback adapters.

### Negative and risks

- Archetype selection and semantic mappings require projection decisions rather than local styling.
- Poor mappings can still turn material into decoration or imply an incorrect business meaning.
- The `90/8/2` ratio may be misread as an implementation budget unless it remains explicitly
  non-normative.
- Broad cross-industry coverage is a design hypothesis, not a measured guarantee.

## Validation

A conforming archetype or material projection must prove:

- the selected archetype and visual primitive have a declared semantic meaning;
- context-specific mappings are documented for values such as risk, capacity, movement, uncertainty,
  and discrepancy;
- stable inputs produce deterministic visual variation;
- layout, typography, spacing, interaction, accessibility, and semantic labels remain consistent;
- semantic depth does not replace text, icon, shape, border, pattern, or accessible data alternatives;
- the projection remains usable through the renderer fallback hierarchy; and
- any `vgpu` implementation follows ADR-0070's adapter, activation, testing, and power gates.

The detailed rationale and examples are preserved in
../architecture/reference/cartographic-archetypes-and-semantic-depth.md.
