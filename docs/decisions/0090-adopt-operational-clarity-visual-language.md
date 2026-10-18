# ADR-0090: Adopt the Operational Clarity Visual Language

- Status: Accepted
- Date: 2026-10-19
- Amends: ADR-0056 (palette, surfaces, and component visual treatment), ADR-0076 (text-style size
  mapping), ADR-0077 (icons become the global-navigation marker)
- Compatible with: ADR-0010, ADR-0048, ADR-0057, ADR-0070, ADR-0074, ADR-0078, ADR-0085
- Supersedes: ADR-0069 (cartographic enterprise visual grammar as the product's visual identity) and
  ADR-0071 (universal cartographic archetypes as the domain-composition vocabulary)
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Design system: [`../architecture/design-system.md`](../architecture/design-system.md)
> - Frontend architecture: [`../architecture/frontend.md`](../architecture/frontend.md)
> - Typography: [`./0076-adopt-ritsei-typography-system.md`](./0076-adopt-ritsei-typography-system.md)
> - Iconography: [`./0077-adopt-ritsei-iconography-system.md`](./0077-adopt-ritsei-iconography-system.md)
> - Renderer selection: [`./0070-select-vgpu-and-defer-typegpu.md`](./0070-select-vgpu-and-defer-typegpu.md)

## Context

ADR-0069 made a "cartographic" visual grammar the product identity: an ivory paper canvas
(`#F4F0E6`), a near-black structural sidebar, terrain-blue actions, brass survey accents, material
ratios (55% cartographic structure, 25% architectural paper, 15% geometry, 5% glass), and planned
contour, paper-grain, and glass materials. ADR-0071 extended it with seven cartographic archetypes,
deterministic procedural variation, and semantic depth for domain composition.

The implemented result did not serve operational ERP work:

- The warm beige canvas against an ink-black sidebar produced low-value contrast at the edges of the
  screen and a muddy, dated surface where users spend their time.
- Navigation used two-letter text markers (`MW`, `RV`, `SP`) instead of recognizable icons.
- Every surface used the same border weight, 44px controls, and equal-weight buttons, so pages had no
  visual hierarchy; several features showed three or four primary buttons side by side.
- Table captions intended to be visually hidden rendered on screen because the referenced `sr-only`
  utility did not exist; decimal amounts were shown ungrouped.
- Most of the specified material system (contour fields, paper grain, glass, procedural variation)
  was never activated, yet it shaped the palette and the documentation, adding cognitive and
  documentation cost without user value.

ERP users scan dense records, compare values, and act on state. Proven operational systems (SAP
Fiori, financial terminals, and modern product tools such as Linear and Stripe) converge on neutral
surfaces, a single interaction accent, strict typographic hierarchy, compact controls, and status
color used only for status.

## Decision

1. Adopt **Operational Clarity** as RITSEI's visual language, specified in
   [`design-system.md`](../architecture/design-system.md) Sections 2–3 and 8–21.
2. **Color:** cool neutral `steel` (light) and `graphite` (dark) palettes, a single `cobalt` accent
   for action, links, focus, current location, and selection, and status triples
   (`status.<tone>.fg|bg|border`) for neutral, success, warning, danger, and info. Light and dark are
   defined separately; all text pairs meet WCAG 2.2 AA.
3. **Shell:** a light global navigation column with Phosphor icons, a filled icon and tinted row for
   the current destination, and a collapsible 56px rail; a 48px topbar carrying the breadcrumb-style
   local navigation, the operating context, and global utilities. The theme is stored per device and
   applied to the document root so portaled overlays inherit it.
4. **Typography and density (amends ADR-0076's mapping, not its typefaces):** page titles 20/28,
   section titles 14/20, table cells 13/20, table headers 12/16 muted; 36px default controls and 32px
   small controls; ~40px table rows on a 4px grid.
5. **Surfaces:** canvas, white surfaces with 1px hairlines and an 8px radius, a subtle tone for
   toolbars, and a single overlay elevation. Glass, blur, paper texture, gradients, and decorative
   contour are removed from the system.
6. **Components:** button variants `primary | secondary | ghost | danger` with `md | sm` sizes and
   the rule of one primary command per region; tinted badges with a dot; tables that bleed to
   surface edges with tinted headers and accent-edged selection; a global `sr-only` utility; and an
   exact decimal formatter (`ui/foundations/format.ts`) that never converts to floating point.
7. **Icons and stylesheet budget:** icons render from a generated static SVG sprite containing only
   registry glyphs instead of the Phosphor icon font, and Panda's stock preset is used without its
   color palette, blurs, aspect ratios, stock shadows, and stock keyframes. `@pandacss/preset-panda`
   (already installed transitively at the same version) is declared as an explicit web
   devDependency so the config can import and trim it. Together these keep the shipped stylesheet
   under the existing 50 KB budget.
8. **Visualization:** the `CartographyField` HTML/SVG renderer and the ADR-0070 `vgpu` selection
   remain available as a visualization tool for relationship and topology projections. They no
   longer define the brand, palette, or domain composition.

## Alternatives Considered

- **Keep the cartographic grammar and tune the palette:** rejected; the grammar's materials and ratios
  would keep steering every screen toward decoration and kept most of the specification unimplemented.
- **Adopt a third-party component kit's theme wholesale:** rejected; it would add dependencies and
  bypass the RITSEI-owned Panda recipes, Kobalte wrappers, and Product Pattern contracts.
- **Dark-first interface:** rejected as the default; long data-entry sessions in lit offices favor a
  light theme. Dark mode remains first-class and user-selectable.

## Consequences

- The UI gains clear hierarchy, recognizable navigation, consistent density, and AA-compliant
  contrast in both themes without new runtime dependencies.
- `ui/grammar/` archetype and procedural-variation code remains for the existing projection but is
  no longer a required composition step for new screens.
- Feature code keeps consuming layout names, recipes, and primitives; the redesign changed shared UI
  code and a small number of feature-level presentation choices (button emphasis, formatted totals,
  customer names in sales tables).
- Visual-regression evidence for the new language is still an activation gate (design-system
  Section 23); the shell and workflow browser tests continue to validate behavior and accessibility.
- ADR-0069 and ADR-0071 remain as historical records and are marked superseded.
