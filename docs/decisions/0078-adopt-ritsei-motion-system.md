# ADR-0078: Adopt the RITSEI Motion System

- Status: Accepted
- Date: 2026-09-05
- Amends: ADR-0056 for motion and interaction behavior
- Compatible with: ADR-0069, ADR-0074, ADR-0076, ADR-0077
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Decision map: [`./decision-map.md`](./decision-map.md)
> - Design system: [`../architecture/design-system.md`](../architecture/design-system.md)
> - Frontend architecture: [`../architecture/frontend.md`](../architecture/frontend.md)
>
## Context

RITSEI needs motion to explain state changes, spatial relationships, causality, and continuity
without turning an enterprise interface into a spectacle. CSS is sufficient for most component
feedback; runtime geometry and physics need a separate mechanism with lifecycle cleanup and a
reduced-motion policy.

## Decision

RITSEI adopts this ownership boundary:

```text
PandaCSS  visual states, transitions, keyframes, animation styles, reduced motion
Motion    runtime geometry, springs, gestures, reordering, orchestration, complex SVG
Solid     state, reactivity, DOM ownership, lifecycle cleanup
Kobalte   accessible interaction semantics and focus behavior
Domain    business truth; never animation
```

The current runtime provider is the framework-independent JavaScript API from `motion@13.2.0`.
It is an exact web-member dependency under the repository's application-boundary policy. Product
code must not import `motion/react`, `framer-motion`, or Motion directly from arbitrary feature
components; runtime calls go through `apps/web/src/ui/motion/`.

The canonical CSS motion tokens are:

```text
Durations  0ms, 80ms, 120ms, 180ms, 240ms, 320ms
Distances  2px, 4px, 8px, 16px
Variants   feedback, enter, exit, disclosure, spatial, emphasis
```

Motion is causal, spatial, quiet, purposeful, interruptible, state-driven, and accessible. The
default motion should preserve the user's mental map. Reduced-motion users receive useful state
feedback without unnecessary spatial traversal. Animation never determines whether a command,
transaction, authorization decision, or workflow step succeeds.

## Consequences

### Positive

- CSS remains the default and keeps ordinary UI motion cheap and inspectable.
- Runtime spatial motion has one lifecycle-aware wrapper and one spring policy.
- Process Studio can add direct manipulation and reordering without leaking a vendor API into features.
- Reduced-motion behavior is centralized instead of invented per component.
- Motion remains a projection of application state rather than a source of business truth.

### Negative

- `motion@13.2.0` adds runtime and transitive bundle weight; output must be measured before broad use.
- Process Studio and other high-frequency surfaces require profiling and interruption tests.
- New spring behavior needs design-system review instead of local constants.

## Validation

- Panda duration, easing, keyframe, animation-style, Solid JSX, and reduced-motion generation succeeds.
- The web application and Storybook build with the Motion wrapper and CSS tokens.
- Motion token and reduced-motion tests pass without timing sleeps.
- No product code imports `motion/react` or `framer-motion`.

## Related Documents

- [`../architecture/design-system.md`](../architecture/design-system.md)
- [`./0056-adopt-ritsei-semantic-frontend-design-system.md`](./0056-adopt-ritsei-semantic-frontend-design-system.md)
- [`./0069-adopt-cartographic-enterprise-visual-grammar.md`](./archive/0069-adopt-cartographic-enterprise-visual-grammar.md)
- [`./0074-switch-to-kobalte-for-solid2-accessible-primitives.md`](./0074-switch-to-kobalte-for-solid2-accessible-primitives.md)
- [`./0076-adopt-ritsei-typography-system.md`](./0076-adopt-ritsei-typography-system.md)
- [`./0077-adopt-ritsei-iconography-system.md`](./0077-adopt-ritsei-iconography-system.md)
