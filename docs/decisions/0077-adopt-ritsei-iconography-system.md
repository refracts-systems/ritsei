# ADR-0077: Adopt the RITSEI Iconography System

- Status: Accepted
- Date: 2026-09-05
- Amends: ADR-0056 for iconography direction and implementation
- Compatible with: ADR-0069, ADR-0074, ADR-0076
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

RITSEI is a dense enterprise application. Icons should reduce scanning time and clarify actions,
objects, hierarchy, and status without becoming decoration. Direct provider imports would make a
future icon-set migration expensive and would make vendor names part of product vocabulary.

## Decision

RITSEI adopts a semantic icon API and registry:

```text
Application
  -> semantic Icon API
  -> icon registry
  -> provider adapter
  -> Phosphor now / Nucleo UI later
```

The current provider is Phosphor Icons. The future provider target is Nucleo UI Icons, but it is
not bundled or activated by this decision. Provider replacement must happen in the adapter and
registry layer; feature and application code must keep using semantic names such as
`action.delete`, `object.invoice`, and `status.warning`.

Canonical variants are:

```text
regular  default utility icon
fill     selected or active state, selectively
duotone  expressive and illustrative surfaces
```

Thin, Light, and Bold are not canonical UI variants. Duotone is reserved for empty states,
onboarding, introductions, and larger contextual surfaces. Core utility UI uses Regular by default.

The icon scale is:

```text
14px xs       16px sm       18px md       20px lg       24px xl       32px display
```

The default is 18px; dense controls use 16px. Glyph size never defines the interactive target,
which remains owned by the containing control. Icons default to `currentColor`; semantic tones are
available for muted, subtle, success, warning, danger, info, disabled, and inverse states.

The public implementation lives in `apps/web/src/ui/icons/`. Phosphor provider imports are
restricted to `providers/phosphor.ts`. The registry is the only place that maps semantic names to
provider names. Product code must not import Phosphor, Nucleo, or another icon pack directly.

Icons with adjacent text are decorative and hidden from assistive technology. Icon-only controls
must receive an accessible name from the control; an icon may also receive an explicit `label` when
it is itself the meaningful image. Status icons must not be the only carrier of critical state;
combine icon, text, and color.

## Consequences

### Positive

- Product code speaks in stable business semantics rather than vendor vocabulary.
- Phosphor can be replaced by Nucleo without rewriting feature imports.
- Variant and size usage remains controlled and reviewable.
- Accessibility defaults make decorative icons quiet while preserving named icon semantics.
- Cartographic identity remains a brand layer instead of contaminating utility iconography.

### Negative

- The registry must be maintained when a new semantic meaning is introduced.
- Provider mappings require optical review during a future Nucleo migration.
- The current Phosphor web font includes the provider catalog; subsetting can be measured later if
  initial-load budgets require it.

## Validation

- The semantic icon component, registry, provider adapter, and token scale typecheck.
- Registry tests preserve stable semantic names and default variants.
- Storybook exposes Regular, Fill, and Duotone examples for human review.
- Phosphor's MIT license is checked in under `licenses/icons/`.
- No direct provider import exists in feature code.

## Related Documents

- [`../architecture/design-system.md`](../architecture/design-system.md)
- [`./0056-adopt-ritsei-semantic-frontend-design-system.md`](./archive/0056-adopt-ritsei-semantic-frontend-design-system.md)
- [`./0069-adopt-cartographic-enterprise-visual-grammar.md`](./archive/0069-adopt-cartographic-enterprise-visual-grammar.md)
- [`./0076-adopt-ritsei-typography-system.md`](./0076-adopt-ritsei-typography-system.md)
