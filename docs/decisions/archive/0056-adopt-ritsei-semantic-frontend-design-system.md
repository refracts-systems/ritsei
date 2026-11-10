# ADR-0056: Adopt the RITSEI Semantic Frontend Design System

- Status: Superseded
- Date: 2026-08-26
- Amends: ADR-0010 only for the accessible primitive and styling foundation selection
- Compatible with: ADR-0009, ADR-0010, ADR-0024, ADR-0048, ADR-0049
- Supersedes: The Kobalte primitive selection in ADR-0010
- Superseded by: ADR-0074 for the accessible primitive selection only

> **Related documents**
>
> - ADR index: [`./README.md`](../README.md)
> - Frontend architecture: [`../architecture/frontend.md`](../../architecture/frontend.md)
> - Design system architecture:
>   [`../architecture/design-system.md`](../../architecture/design-system.md)
> - Active architecture:
>   [`../architecture/architecture-spec-v4.md`](../../architecture/architecture-spec-v4.md)
> - Process Studio: [`../architecture/process-studio.md`](../../architecture/process-studio.md)
> - Frontend state ownership:
>   [`./0048-define-effect-application-architecture-and-frontend-state-ownership.md`](../0048-define-effect-application-architecture-and-frontend-state-ownership.md)

## Context

RITSEI is not only a collection of authenticated CRUD screens. Its frontend must represent movement,
capacity, location, process, relationships, commitments, time, and exceptions across multiple
industries while preserving one recognizable product language.

A component library, token set, or styling engine alone does not provide that language. They provide
implementation material. RITSEI also needs canonical Product Patterns, Interaction Grammar, Visual
Grammar, usage guidance, accessibility behavior, density rules, and renderer boundaries so that
multiple developers or coding agents do not repeatedly make the same product decisions.

ADR-0010 selected Kobalte as the accessible UI primitive source while leaving the internal UI system
undefined. `apps/web/` has not yet been implemented, so this is the lowest-cost point to establish a
single primitive source and a constrained styling boundary.

## Decision

RITSEI adopts the semantic frontend design-system architecture defined in
[`design-system.md`](../../architecture/design-system.md).

The governing philosophy is:

> **RITSEI standardizes the language, not the sentence.**

Different businesses should not share the same interface. They should share the same visual
language. Product Patterns, projections, and workspace composition may differ by business model;
semantic states, hierarchy, interaction behavior, accessibility, density, and visual contracts
remain recognizably RITSEI.

The design system therefore separates:

- **Stable language:** semantic vocabulary, tokens, typography, density, interaction states,
  recipes, core components, attention hierarchy, and accessibility rules.
- **Extensible expression:** projections, Visual Grammar, Product Pattern composition, workspace
  composition, domain-specific combinations, and new representations.

Extensibility has three forms: changing the representation of an existing meaning, adding a governed
representation for a new meaning, and composing approved meanings differently for a business model.
New business meaning still requires a typed projection contract and an owning domain decision; it
must not become an untyped feature-local dialect.

The frontend layers are:

```text
Business truth
      ↓
Business semantics
      ↓
Projection intent
      ↓
Product Patterns + Interaction Grammar
      ↓
Visual Grammar
      ↓
RITSEI UI components
      ↓
Behavior + visual contracts
      ↓
Implementation engines
```

### Accessible behavior primitives

Use **Ark UI** as the single headless accessible primitive source for the RITSEI UI layer. Feature
code must use RITSEI-owned components and must not import Ark UI directly.

Kobalte and Ark UI are not additive primitive sources. The Kobalte selection in ADR-0010 is replaced
by this decision. The Vite, SolidJS 2.0, SPA, router, Effect, Effect Schema, and TanStack state
choices in ADR-0010 remain unchanged.

### Styling foundation

Use **Panda CSS** as the styling substrate with a constrained RITSEI authoring profile. The RITSEI
public styling vocabulary is:

```text
semantic tokens
config recipes
config slot recipes
approved layout patterns
approved conditions
css() as an exceptional escape hatch
```

Feature code must not treat Panda's complete API surface as its design-system API. Raw foundation
colors, arbitrary spacing, broad JSX style props, direct vendor styling, and unapproved recipes are
not the default authoring model.

Panda-generated output remains frontend implementation material inside `apps/web`. It must not enter
backend packages, public domain contracts, or persistence models.

### Drag and drop

Use the Solid dnd-kit adapter only behind a RITSEI interaction adapter for bounded drag, drop, sort,
and reorder behavior. dnd-kit state is normalized into RITSEI vocabulary such as `dragging`,
`drop-target`, `valid`, `invalid`, and `constrained`.

Drag state and DOM coordinates are presentation state. They must not become business semantics,
Process IR, authorization, or persistence state. Every pointer interaction must have an equivalent
keyboard and structured-form path where the workflow requires editing.

### Data visualization

Use TanStack Charts as a replaceable, provisional quantitative renderer behind a RITSEI
`VisualizationSpec` or feature-local renderer contract. Domain and projection contracts must not
import TanStack Charts types.

The renderer owns marks, channels, scales, axes, geometry, and rendering lifecycle. It does not own
fetching, authorization, business aggregation, freshness policy, or authoritative state. A renderer
replacement must not require changing domain or product-pattern contracts.

TanStack Charts remains behind an activation gate until SolidJS compatibility, accessibility,
performance, and release stability are demonstrated.

### Declarative intent

RITSEI may define bounded, typed view and projection intent in the future. It does not adopt a
universal Odoo-style metadata runtime. Declarative frontend intent must not execute arbitrary SQL,
scripts, hidden reads, mutations, authorization, or domain invariants. Tenant- or
plugin-configurable intent requires a separate ADR.

## Alternatives Considered

### Keep Kobalte

This would minimize change to ADR-0010, but it would preserve the current ambiguity about the
primitive source and would not capture the desired headless, design-system-owned boundary. It
remains a valid fallback if the Ark activation gate fails.

### Use both Ark UI and Kobalte

Rejected. Two accessible primitive sources would duplicate behavior, focus management,
documentation, testing, and styling conventions. A single RITSEI wrapper layer must have one
primitive owner.

### Tailwind CSS as the public styling model

Rejected as the primary RITSEI authoring model. Tailwind remains technically capable, but direct
utility composition keeps recurring appearance decisions at usage sites. RITSEI needs semantic,
typed, centrally governed visual contracts instead.

### StyleX

Not selected as the initial foundation. StyleX's fine-grained style contracts and compiler model are
valuable alternatives, but adopting it would require building more of the token, recipe, slot, and
pattern machinery that Panda already supplies. The decision can be revisited if the Panda profile
fails measured bundle or contract requirements.

### Native CSS plus a custom design system

Rejected for now. The frontend is not implemented, and building a bespoke styling compiler or recipe
system would add unnecessary infrastructure before a measured need exists.

### Universal Odoo-style metadata UI

Rejected. RITSEI may use typed declarative intent for bounded composition, but business contracts,
authorization, invariants, and Process IR remain owned by their existing architecture boundaries.

## Consequences

### Positive

- RITSEI gains one documented design-system owner for Product Patterns and Visual Grammar.
- Business semantics remain separate from CSS semantics and renderer APIs.
- Ark behavior and accessibility are hidden behind stable RITSEI component contracts.
- Panda can propagate foundation changes without exposing raw styling decisions to feature code.
- dnd-kit and chart renderers remain replaceable implementation details.
- Coding agents receive usage rules, not only component prop types.
- Industry differences remain projection composition rather than dashboard forks.

### Negative

- The team must create and maintain Product Pattern and Visual Grammar documentation.
- A RITSEI UI wrapper layer adds initial frontend work.
- The constrained Panda profile needs linting and review discipline.
- Some feature work will be slower until canonical patterns exist.

### Risks

- Product Patterns could become generic abstractions that hide business meaning.
- Semantic tokens could become a second domain model.
- Ark UI adoption could expose SolidJS 2 compatibility or accessibility gaps.
- dnd-kit could be used outside bounded interaction scenarios.
- Chart freshness or presentation could be mistaken for authoritative business state.
- Declarative intent could become a hidden authorization or mutation path.
- A large design-system document could become stale without ownership and validation.

## Activation and Validation

This ADR defines architecture; it does not add frontend dependencies immediately. Activation
requires an implementation spike in `apps/web` that proves:

- Vite and SolidJS 2.0 integration;
- Ark UI keyboard, focus, and screen-reader behavior;
- Panda token, recipe, slot, density, theme, reduced-motion, and high-contrast behavior;
- dnd-kit pointer/keyboard parity for the first Process Studio interaction;
- renderer adapter behavior, accessibility, units, freshness, and degraded states;
- bundle size, route splitting, interaction latency, and visual regression baselines;
- no direct vendor imports outside the internal UI layer.

The repository must add enforcement before broad feature adoption:

- Ark UI imports are restricted to the internal UI layer;
- Panda-generated artifacts remain inside `apps/web`;
- dnd-kit operations are translated into typed application intent;
- chart definitions do not enter domain packages;
- Product Patterns have usage and accessibility contracts;
- critical workflows have keyboard and public-contract tests.

The design-system architecture is successful when two independent builders given the same business
requirement naturally compose the same Product Pattern, interaction behavior, and semantic visual
contract without copying page-specific styling or inventing a competing workflow.

## Related Documents

- [`../architecture/design-system.md`](../../architecture/design-system.md)
- [`../architecture/frontend.md`](../../architecture/frontend.md)
- [`../architecture/process-studio.md`](../../architecture/process-studio.md)
- [`./0010-use-vite-solidjs-spa.md`](../0010-use-vite-solidjs-spa.md)
- [`./0048-define-effect-application-architecture-and-frontend-state-ownership.md`](../0048-define-effect-application-architecture-and-frontend-state-ownership.md)
