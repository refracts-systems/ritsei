# Reference: Universal Cartographic Archetypes, Deterministic Variation, and Semantic Depth

> **Status:** Historical reference analysis — the cartographic visual direction was superseded by
> [ADR-0090](../../decisions/0090-adopt-operational-clarity-visual-language.md).
>
> **Owns:** The rationale, examples, and working hypotheses behind RITSEI's universal cartographic
> archetypes, deterministic visual variation, and semantic depth vocabulary.
>
> **Does not own:** Binding architecture rules. The accepted decision is
> [`ADR-0071`](../../decisions/0071-adopt-universal-cartographic-archetypes.md); current rules are
> owned by [`../design-system.md`](../design-system.md),
> [`../frontend.md`](../frontend.md), and the related renderer decision
> [`../../decisions/0070-select-vgpu-and-defer-typegpu.md`](../../decisions/0070-select-vgpu-and-defer-typegpu.md).
>
> **Related documents**
>
> - Design system: [`../design-system.md`](../design-system.md)
> - Frontend architecture: [`../frontend.md`](../frontend.md)
> - Cartographic visual grammar decision: [`../../decisions/0069-adopt-cartographic-enterprise-visual-grammar.md`](../../decisions/0069-adopt-cartographic-enterprise-visual-grammar.md)
> - Universal archetypes decision: [`../../decisions/0071-adopt-universal-cartographic-archetypes.md`](../../decisions/0071-adopt-universal-cartographic-archetypes.md)
> - Renderer selection: [`./cartographic-renderer-selection.md`](./cartographic-renderer-selection.md)
> - Documentation boundaries: [`../../documentation-boundaries.md`](../../documentation-boundaries.md)

## 1. The scalable interpretation of “cartographic”

Cartographic must not be interpreted as “put a map or topographic contour on every page.” That would
turn a useful language into a visual gimmick.

For RITSEI, cartographic is a grammar for:

```text
structure
relationship
pressure
movement
boundary
state
```

The visual question determines whether a contour, field, route, marker, boundary, density, depth, or
pulse is useful. A finance screen does not need to look like a mountain map. It may use a restrained concentration
field or pressure boundary instead:

```text
normal
────────────────

high exposure
────────╮
        │ dense field
────────╯
```

The core rule is:

> **The structure stays consistent; the surface adapts to meaning.**

## 2. Core system: the stable RITSEI language

The core system is stable across restaurants, manufacturers, hospitals, distributors, professional
services, and other businesses:

```text
Typography
Grid
Spacing
Paper material
Geometry
Elevation
Interaction
Accessibility
Color semantics
Motion rules
```

These foundations provide the RITSEI identity. Industry and domain differences should not create
separate design systems. They should compose the same foundations and the same semantic grammar.

The stable layer remains responsible for:

- layout, typography, spacing, and density;
- accessible interaction and keyboard behavior;
- semantic color and contrast;
- UI depth hierarchy;
- reduced-motion and power rules; and
- renderer-neutral component contracts.

## 3. Seven universal business archetypes

Five industry categories such as Retail, Manufacturing, Distribution, Finance, and Services are too
coarse to serve as a universal ERP foundation. The design system should instead start from business
primitives that recur across industries.

RITSEI adopts these seven visual archetypes:

| Archetype | Meaning | Visual grammar |
|---|---|---|
| **Stock** | Something available, stored, or held | density, mass, level |
| **Flow** | Something moving from one point or state to another | route, direction, velocity |
| **Capacity** | Load compared with ability or limit | pressure, compression, elevation |
| **Value** | Money, exposure, or value concentration | field, concentration, variance |
| **Relationship** | People, accounts, vendors, teams, or networks | nodes, proximity, connection |
| **Progress** | Work moving toward an outcome | path, milestones, blockage |
| **Asset / Space** | A thing or place with position and state | regions, boundaries, markers |

A business does not select one archetype. It composes several:

```text
business question
      ↓
one or more archetypes
      ↓
semantic state
      ↓
cartographic primitives
      ↓
deterministic material expression
```

The archetypes are visual interpretation tools, not domain authorities and not a replacement for
owner-controlled business semantics.

## 4. Industry composition

Industry composition becomes a combination of archetypes rather than an industry-specific theme:

```text
RETAIL
Stock + Flow + Value + Relationship

MANUFACTURING
Stock + Flow + Capacity + Progress + Asset / Space

LOGISTICS
Flow + Capacity + Asset / Space + Progress

BANKING
Value + Relationship + Flow + Capacity

CONSULTING
Progress + Capacity + Relationship + Value

CONSTRUCTION
Progress + Asset / Space + Capacity + Stock + Value

HOSPITALITY
Capacity + Relationship + Stock + Value

HEALTHCARE
Capacity + Asset / Space + Flow + Relationship + Stock

TELECOM
Asset / Space + Flow + Capacity + Relationship + Value

SOFTWARE / SaaS
Relationship + Capacity + Progress + Value

EDUCATION
Relationship + Capacity + Progress + Asset / Space

UTILITIES
Asset / Space + Flow + Capacity + Value
```

This means RITSEI does not need:

```text
Retail design A
Manufacturing design B
Distribution design C
```

It needs one grammar with different compositions:

> **All businesses use the same grammar; their primitive combinations differ.**

This is a working coverage hypothesis for common visual-operational ERP needs, not a measured claim
that seven archetypes literally cover a fixed percentage of all companies. If a percentage is used,
it should mean approaching `95–97%` of common visual-operational ERP needs—not `97%` of company types.
The useful target is broad cross-industry coverage without forcing every domain into the same
projection.

## 5. Context changes the visual meaning

The same state, including `risk`, must map differently depending on the object and question:

```text
Supplier risk
→ pressure + contour density

Financial exposure
→ concentration + depth

Machine failure risk
→ local pulse + boundary

Project risk
→ obstruction + path compression

Warehouse risk
→ density + spatial pressure
```

The design system must not apply a universal rule such as:

```text
high number
→ everything becomes higher
```

The correct mapping depends on the semantic dimension:

```text
Inventory capacity
capacity ↑
→ terrain elevation ↑

Risk
risk ↑
→ compression / pressure ↑

Movement
movement ↑
→ velocity ↑

Uncertainty
uncertainty ↑
→ boundary softness ↑

Discrepancy
discrepancy ↑
→ continuity breaks ↑
```

This lets the user perceive that an area is under pressure without relying on a loud glow or a
single red color. Semantic color and explicit labels remain required for accessibility.

## 6. Deterministic variation is not randomness

RITSEI may use procedural variation so repeated surfaces do not feel copy-pasted, but it must not
use unbounded randomness on each render.

Avoid:

```ts
Math.random()
```

on every render. That makes a card or field change after refresh and gives an entity an unstable
visual identity.

Use deterministic procedural variation instead:

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

A conceptual adapter may look like:

```ts
visual = material({
  seed: hash(entityId),

  pressure: risk,
  density: risk * 0.8,
  amplitude: risk * 0.35,
  semantic: "critical"
})
```

The exact implementation remains renderer-specific. The contract is that the same entity and
semantic inputs produce the same family of visual behavior. Different entities may have organic
differences without losing semantic comparability.

For example, two suppliers can have the same `critical` risk level and still receive different
stable field shapes:

```text
Risk 80% — Supplier A

 ≋≋≋≋╭───────────────╮
 ≋≋  │ Supplier A    │
  ≋≋≋╰───────────────╯


Risk 80% — Supplier B

  ≋≋ ╭───────────────╮
 ≋≋≋│ Supplier B    │≋
 ≋  ╰───────────────╯≋≋
```

Both remain:

```text
critical
red
 dense
high pressure
```

The field differs, but the meaning does not. RITSEI should distinguish:

```text
randomness      ✗
variation       ✓
```

## 7. Semantic depth and UI depth

Depth is a required capability of the grammar, although not every screen needs to render a deep
field. It must carry meaning and must not be random.
RITSEI separates two kinds of depth.

### UI depth

UI hierarchy is stable across the application:

```text
L0 Canvas
L1 Content
L2 Card
L3 Interactive
L4 Modal
```

This is the standard surface and elevation system. It should not change because a value is high.

### Semantic depth

Semantic depth is the perceived depth of data inside a visual field. It is derived from the
archetype and semantic state:

```text
risk = 0.1

flat
──────────────


risk = 0.5

──────╮  ╭─────
      ╰──╯


risk = 0.95

────╮      ╭────
   ╭╯╲____╱╰╮
───╯          ╰──
```

For a pressure-oriented risk field:

```text
density ↑
contrast ↑
field depth ↑
contour concentration ↑
```

The intended perception is:

> **This area is under pressure.**

The mapping is not universal. Capacity may use elevation, risk may use compression, movement may use
velocity, and uncertainty may use softness. Semantic depth is a projection choice, not a new source
of business truth.

## 8. The GPU material vocabulary

The GPU renderer should receive a small, generic material vocabulary rather than domain-specific
business names. The vocabulary is broader than color and opacity:

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

Business semantics map into this vocabulary:

```text
                    CARTOGRAPHIC VISUAL GRAMMAR

Risk ──────────────→ compression
                     density
                     intensity

Capacity ──────────→ elevation
                     mass

Activity ──────────→ velocity
                     pulse

Uncertainty ───────→ blur
                     boundary softness

Discrepancy ───────→ discontinuity

Concentration ─────→ field density
                     depth

Relationship ──────→ proximity
                     connection

Progress ──────────→ continuity
                     blockage

Stock ─────────────→ level
                     density
```

This material vocabulary is presentation semantics. It must not become an alternative domain model
or a hidden authorization/status system.

## 9. Cross-business visual expression

The same primitives can express different business questions:

```text
RETAIL
Inventory availability
████████

MANUFACTURING
Work center pressure
^^^^^^^

DISTRIBUTION
Material movement
→→→→→

FINANCE
Exposure concentration
((((●))))

SERVICES
Team allocation
○──○──●
```

The primitive set remains small:

```text
Field
Contour
Route
Marker
Boundary
Density
Depth
Pulse
```

Variation comes from composition, semantic mapping, and stable material seeds—not from creating a
new renderer or dashboard family for every industry.

## 10. Rendering pipeline

The final conceptual pipeline is:

```text
BUSINESS DATA
      ↓
7 BUSINESS ARCHETYPES
      ↓
SEMANTIC STATE
      ↓
CARTOGRAPHIC GRAMMAR
      ↓
deterministic variation + semantic depth
      ↓
HTML semantics + optional GPU material
```

HTML remains responsible for business-readable semantics, labels, controls, summaries, and
accessible data alternatives. The GPU can render the material expression after the CPU-side adapter
has removed domain-specific business names and produced generic visual semantics.

This is compatible with the selected `vgpu` boundary:

```text
Domain projection
      ↓
visual semantics
      ↓
cartography contract
      ├── SVG / CSS / Canvas fallback
      └── vgpu material adapter
```

The renderer never becomes the owner of the business data or semantic state.

## 11. Design philosophy ratios

The design-system material emphasis remains:

```text
55% Cartographic Structure
25% Architectural Paper
15% Precision Geometry
 5% Optical Glass
```

A useful per-screen visual philosophy is:

```text
90% deterministic structure
 8% semantic procedural variation
 2% entity-specific variation
```

The second ratio is not an engineering budget, performance guarantee, or literal pixel allocation.
It is a guardrail against noisy design:

- most of the screen remains structurally stable;
- semantic state can change material behavior;
- entity-specific variation remains subtle and bounded.

The goal is:

> **Consistent at the system level, adaptive at the semantic level, unique at the material level.**

## 12. Relationship to the renderer decision

The archetype model strengthens, rather than weakens, the decision to keep `vgpu` peripheral.
Archetypes and semantic depth belong to the RITSEI cartography contract. `vgpu` is only one possible
material renderer behind that contract.

This preserves the replacement path:

```text
@ritsei/cartography
          │
          ├── SVG / CSS / Canvas
          └── vgpu
```

If a future measured workload needs a GPU-compute platform, TypeGPU may be evaluated separately. It
must not be introduced merely because deterministic procedural material is useful.

## 13. Final conclusion

The universal design-system foundation is not:

```text
Retail UI
Manufacturing UI
Finance UI
Services UI
```

It is:

```text
one stable RITSEI core
      +
seven universal business archetypes
      +
context-aware semantic mapping
      +
deterministic procedural variation
      +
semantic depth
      +
HTML-first accessibility
      +
optional vgpu material rendering
```

That is how RITSEI can scale from a small store to a multinational enterprise without either losing
identity or forcing every business to look like a topographic map.
