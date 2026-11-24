# ADR-0127: Adopt the Kontainer Visual Language

- Status: Accepted
- Date: 2026-11-24
- Amends: ADR-0090 and ADR-0112 (palette, accent, radii, and shadows), ADR-0076 (type families)
- Compatible with: ADR-0010, ADR-0056, ADR-0074, ADR-0077, ADR-0078, ADR-0085
- Supersedes: None
- Superseded by: None
- Changes: `docs/architecture/design-system.md`

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Design system: [`../architecture/design-system.md`](../architecture/design-system.md)
> - Mockups and extracted tokens: [`../design/kontainer/README.md`](../design/kontainer/README.md)
> - Earlier visual language: [`./0112-soften-operational-clarity-and-adopt-tactile-motion.md`](./0112-soften-operational-clarity-and-adopt-tactile-motion.md)

## Context

The owner compared six visual directions for RITSEI and chose series E, the Kontainer language: warm
paper and navy ink, a single shu red accent, a serif heading face, flat square surfaces, and a color
per object type. The six screens are kept in `docs/design/kontainer/`, with `tokens.json` extracted
from them. Until now the application used the neutral and cobalt palette of ADR-0090 and ADR-0112.

Extracting the tokens found two gaps. The mockups have no dark theme, and the focus color they use
(`#E06A4E`) is 2.94:1 on the light canvas, under the 3:1 minimum for a focus indicator.

## Decision

The application follows series E for the following, and for nothing else.

- **Color.** Every semantic token keeps its name and takes a Kontainer value in both themes. The
  accent is shu (`#B5402B`; `#E06A4E` in dark). Primary commands stay ink and turn shu on hover. The
  status tones keep their five names, with E's ok, warn, and critical colors and E's procurement
  blue for info.
- **Type families.** IBM Plex Sans for the interface, Shippori Mincho for page and section titles and
  display figures, IBM Plex Mono for identifiers. Fonts are self-hosted from the Latin subsets only:
  the full Shippori Mincho stylesheet is 110 KB and would break the 50,000-byte stylesheet budget.
- **Shape.** Surfaces and panels are square, controls, items, and menus are 4px, and controls and
  surfaces carry no shadow. Menus and dialogs keep theirs, since they sit over content.
- **The dark theme is derived.** The deck defines only the dark canvas, surface, text, secondary
  text, and accent. Every other dark value, and the light tints of the accent and the status
  backgrounds, is derived here and checked against WCAG: text and `muted` reach 4.5:1 on the canvas,
  sheet, hover, and active surfaces, and the links and focus ring reach 4.5:1 on all of them.
- **The focus color is corrected, not copied.** The ring is the darker shu (`#A33925`) in light and
  `#F6A78F` in dark. The mockups' `#E06A4E` fails on the light canvas.

Not changed: the text size scale (14px body), the 4px spacing grid, control heights, density, motion,
and the shell structure. The mockups use 15 to 17px body text on sparse screens; adopting those sizes
would reduce the rows a table shows, which is a density decision of its own.

The ink frame around surfaces (`frame`; a lighter blue-gray in dark, derived to keep 3:1) and the five
object-type colors (`type.*`, with light `onType` letters) arrive with the first screen that renders
them, the Approvals queue, through the `TypeTag` primitive. The subtle surface tone keeps its hairline.

## Consequences

- The `neutral` and `cobalt` primitives are gone; semantic tokens hold their values directly, so
  feature code is unaffected.
- `@fontsource/pretendard` is removed; `@fontsource/ibm-plex-sans` and `@fontsource/shippori-mincho`
  are added at exact versions, as the dependency rule requires.
- One dark-theme axe scan is added so the derived dark values are checked, as the light ones are.
- Reversing this means restoring the previous values in `apps/web/panda.config.ts`; no feature code
  depends on them.
