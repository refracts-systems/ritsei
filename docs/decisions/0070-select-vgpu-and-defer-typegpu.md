# ADR-0070: Select `vgpu` as the Optional Cartographic Renderer and Defer TypeGPU Compute

- Status: Superseded
- Date: 2026-09-02
- Amends: ADR-0069 for concrete renderer selection, implementation balance, and activation policy
- Compatible with: ADR-0009, ADR-0010, ADR-0048, ADR-0056, ADR-0057, ADR-0068
- Supersedes: None
- Superseded by: ADR-0091 (product reset)

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Decision map: [`./decision-map.md`](./decision-map.md)
> - Design system: [`../architecture/design-system.md`](../architecture/design-system.md)
> - Frontend architecture: [`../architecture/frontend.md`](../architecture/frontend.md)
> - Cartographic visual grammar: [`../architecture/reference/cartographic-renderer-selection.md`](../architecture/reference/cartographic-renderer-selection.md)
> - Cartographic visual grammar decision: [`./0069-adopt-cartographic-enterprise-visual-grammar.md`](./0069-adopt-cartographic-enterprise-visual-grammar.md)
> - Universal cartographic archetypes: [`./0071-adopt-universal-cartographic-archetypes.md`](./0071-adopt-universal-cartographic-archetypes.md)
> - Architecture enforcement: [`../architecture/architecture-enforcement.md`](../architecture/architecture-enforcement.md)

## Context

ADR-0069 established an HTML-first, fallback-first cartographic visual grammar but intentionally did
not select a concrete WebGPU implementation. RITSEI now needs a bounded renderer choice for future
cartographic material and dense visualization work.

The decision must fit the whole product rather than optimize only for GPU-programming capability:

- RITSEI is an ERP with long-lived, interaction-heavy sessions;
- SolidJS owns fine-grained presentation reactivity;
- Ark UI supplies accessible headless interaction behavior behind RITSEI-owned components;
- semantic HTML, CSS, and SVG remain the default presentation layers;
- WebGPU is an optional visual enhancement, not a business or application-state runtime; and
- the design system must remain accessible, replaceable, testable, and power-conscious.

The key distinction is:

> **RITSEI needs a GPU renderer, not a GPU application architecture.**

TypeGPU is a strong choice for typed GPU programming, compute pipelines, and custom GPU applications.
That is not the current requirement for the RITSEI design system. Making TypeGPU central too early
would encourage domain data, application state, and business concepts to flow into a GPU programming
model that should remain peripheral.

## Decision

RITSEI selects **`vgpu`** as the optional implementation behind its cartographic WebGPU renderer
boundary. This selection is an adapter choice, not permission for feature code to import `vgpu`
directly and not immediate activation of a runtime dependency.

The active boundary is:

```text
Business truth
      ↓
Domain/application semantics
      ↓
Typed visual projection intent
      ↓
RITSEI cartography contract
      ↓
RITSEI renderer adapter
      ├── SVG / Canvas / CSS fallback
      └── vgpu adapter
                ↓
             WebGPU
```

`vgpu` is therefore a hidden rendering implementation. It does not own business facts,
aggregation, authorization, workflow state, fetching, accessibility, or the application frame loop.
The browser remains fully usable when WebGPU is unavailable, denied, too expensive, or fails at
runtime.

For composed experiences that actually need a visual renderer, the current planning target is
approximately `85–95%` HTML/CSS/SVG and `5–15%` Canvas/WebGPU. This is an art-direction and capacity
target, not a per-route requirement; ordinary forms, tables, and record editors may remain entirely
semantic HTML/CSS.

### Rendering and application boundaries

The RITSEI visual stack is:

```text
SolidJS
  │ reactive presentation and semantic changes
  ▼
Ark UI behind RITSEI-owned components
  │ accessible interaction and state-machine behavior
  ▼
Semantic HTML / CSS / SVG
  │ primary interface and fallback
  ▼
RITSEI cartography contracts
  ▼
vgpu adapter
  ▼
WebGPU
```

SolidJS may synchronize renderer resources when semantic inputs change, but Solid signals must not
be used as a 60 FPS frame counter. Renderer-owned time, delta, particles, simulation, scheduling,
and frame submission remain outside the application state model. Ark UI controls, tooltips,
popovers, dialogs, menus, and other complex interactions remain DOM-based and accessible; they must
not be simulated inside a canvas.

### Semantic projection boundary

Domain data is converted on the CPU into generic visual semantics before it reaches a renderer.
For example:

```text
Inventory domain:
  availableQuantity, reservedQuantity, reorderPoint, warehouseCapacity

Visual projection:
  intensity, pressure, density, velocity, region, position

GPU:
  position, intensity, pressure, density, velocity, region
```

A GPU scene may reinforce a business condition, but it cannot be the only place where the user can
learn that condition. A critical risk must remain available as semantic text, status, table data, or
another accessible representation without the GPU scene.

### Data-driven material variation

Material variation is allowed when it is derived from domain/application context rather than random
decoration:

| State or meaning | Permitted material response |
|---|---|
| Risk | Denser contours and stronger critical intensity |
| Capacity | Greater elevation or height |
| Flow | Directional lines or movement following transaction direction |
| Idle / stable | Flatter, sparser, calmer field |
| Forecast | Softer or ghosted layer |
| Discrepancy | Broken contour or restrained jitter |
| Success / recovery | Lower density and a return toward the neutral palette |

Layout, typography, spacing, interaction behavior, and semantic labels remain stable. Only the
material layer and approved visual semantics vary. The result is a consistent structure with a
surface that responds to business conditions rather than a different dashboard dialect on every
page.

### Static-first rendering and bounded motion

The default ERP scene is static or event-driven:

```text
STATIC

semantic data changes
        ↓
     render()
        ↓
     GPU idle
```

```text
ACTIVE

pointer / transition / data flow
             ↓
         bounded loop
             ↓
       animation settles
             ↓
             stop
```

Static topology, paper grain, and other unchanged inputs should be baked or cached. Continuous
animation is reserved for a real-time operational need, remains visibility-aware and throttled, and
is replaced or disabled for reduced-motion preferences. This protects long-lived ERP sessions from
unnecessary CPU, GPU, battery, and thermal cost.

### Package and import boundary

The conceptual package split is:

```text
@ritsei/cartography
  semantic visual primitives and renderer-neutral contracts

@ritsei/cartography-gpu
  vgpu-backed renderer adapter, shaders, topology, paper, optical, and pulse implementations

@ritsei/ui
  Solid + Ark UI application components
```

The current repository does not activate these as separate packages. Until measured cross-application
reuse justifies extraction, the implementation remains inside `apps/web/src/ui/` with domain
projections under `apps/web/src/features/<domain>/projections/`. The package names above describe
stable conceptual boundaries and a future extraction shape, not a request to create speculative
packages now.

Feature and domain code must not import `vgpu`, `vgpu/node`, `vgpu/mock`, `vgpu/scene`, or raw WebGPU
objects. Only the internal renderer adapter may do so. Application code should consume semantic
operations such as:

```ts
createTopologyField()
createRouteField()
createDensityField()
createPaperMaterial()
createOpticalSurface()
createDataPulse()
```

The low-level operations `effect`, `draw`, `storage`, `frame`, `GPUBuffer`, and WGSL binding details
remain adapter internals.

### Fallback and accessibility

The cartography contract supports replaceable renderers:

```text
TopologyField
      ├── SVG / CSS renderer
      └── vgpu renderer
```

Decorative canvas output is `aria-hidden="true"`. Analytical visualizations provide a DOM summary,
accessible labels, and a semantic data/table alternative. Pointer picking may select an object in
the canvas, but Solid owns the selected identifier and Ark UI owns the accessible popover, tooltip,
or dialog that explains it.

The fallback is mandatory for critical values, actions, statuses, and relationships. Canvas or
WebGPU must never become the accessibility layer.

### Testing and activation

When activated, the renderer adapter must prove one semantic contract across:

- browser rendering;
- headless Node rendering through `vgpu/node` and its Dawn-backed adapter; and
- deterministic CI tests through `vgpu/mock` without requiring a physical GPU.

Activation evidence must include adapter/projection tests, deterministic output or pixel-diff tests
where appropriate, semantic fallback tests, accessibility tests, reduced-motion tests, device
capability detection, visibility-based rendering, runtime failure recovery, bounded frame rate,
static-frame caching, bundle/route impact, memory, interaction latency, and long-session power
measurements. The same RITSEI adapter contract must be testable without WebGPU.

`vgpu` is selected but remains activation-gated. If it is added later, its dependency version belongs
in the root `package.json` and its resolved graph in `deno.lock`; no version is duplicated in
`deno.json`. No `vgpu` or TypeGPU dependency is added by this ADR alone.

## TypeGPU policy

TypeGPU is **deferred**, not rejected. It becomes a candidate when RITSEI has a measured,
GPU-compute-centered requirement such as:

```text
10 million warehouse points
        ↓
GPU aggregation
        ↓
GPU spatial indexing
        ↓
GPU forecasting field
        ↓
GPU clustering
        ↓
GPU route solver
        ↓
GPU-generated geometry
```

At that point, a separate decision must evaluate TypeGPU or another compute abstraction for typed
schemas, buffers, resources, compute pipelines, CPU/GPU type relationships, and controlled
interoperability with raw WebGPU. That future decision must not move business semantics or
authoritative state into shaders.

## Alternatives considered

### TypeGPU as the application foundation

Rejected for the current renderer requirement. Its typed GPU data model and custom-compute
capabilities are valuable, but they make it too easy to model ERP concepts as GPU schemas and to
couple application architecture to a GPU programming platform.

### Raw WebGPU

Not selected as the RITSEI-facing boundary. It may remain an implementation detail or future adapter,
but using it directly throughout the application would leak device, buffer, pipeline, binding, and
lifecycle details into feature code.

### CSS, SVG, or Canvas only

Insufficient as a universal choice for future procedural topology, high-density spatial views, large
particle/data-flow scenes, or other measured workloads. They remain the default and mandatory
fallback layers.

## Consequences

### Positive

- RITSEI gets a small, renderer-oriented WebGPU dependency boundary.
- Solid, Ark UI, semantic HTML, and accessibility remain the application platform.
- Business semantics stay CPU-side and renderer-neutral.
- Static scenes can avoid a permanent frame loop and unnecessary power use.
- `vgpu/mock` and `vgpu/node` provide a path toward deterministic, headless renderer validation.
- `vgpu` can be replaced without changing domain contracts, Process Studio, or the design system.
- TypeGPU remains available for a future GPU-compute subsystem without prematurely becoming a core
  application dependency.

### Negative and risks

- `vgpu` is a young external dependency and its API may change quickly.
- WebGPU remains unavailable or inconsistent on some clients.
- A renderer adapter still requires fallback, accessibility, performance, and failure-recovery work.
- Visual material can be mistaken for business authority unless projection and DOM alternatives are
  enforced.
- The conceptual package split must not become speculative repository structure before reuse evidence
  exists.

## Validation gate

No implementation dependency is added until the canonical design-system activation gates pass:

- measured benefit over CSS, SVG, or Canvas for a named workload;
- semantic fallback remains fully usable;
- browser, headless, and deterministic test paths agree at the adapter boundary;
- no direct vendor imports leave the internal UI layer;
- static frames are cached and active loops are bounded;
- reduced motion, visibility, contrast, keyboard, and screen-reader behavior are verified; and
- bundle, memory, interaction, and long-session power evidence is recorded.

The detailed rationale, examples, comparison matrix, and source links are preserved in
[`../architecture/reference/cartographic-renderer-selection.md`](../architecture/reference/cartographic-renderer-selection.md).
