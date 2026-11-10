# ADR-0112: Soften Operational Clarity and Adopt Tactile Motion

- Status: Accepted
- Date: 2026-11-10
- Amends: ADR-0090 (palette, accent use, shell, radii, shadows, spacing, and text-style mapping),
  ADR-0078 (easing curves, press feedback, and overlay entrance)
- Compatible with: ADR-0010, ADR-0056, ADR-0074, ADR-0076, ADR-0077, ADR-0085
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Design system: [`../architecture/design-system.md`](../architecture/design-system.md)
> - Visual language: [`./0090-adopt-operational-clarity-visual-language.md`](./0090-adopt-operational-clarity-visual-language.md)
> - Motion system: [`./0078-adopt-ritsei-motion-system.md`](./0078-adopt-ritsei-motion-system.md)

## Context

Operational Clarity (ADR-0090) gave RITSEI hierarchy, one accent, and compact controls. In use it
read as hard rather than calm:

- Blue-tinted greys, 6–8px corners, 13px text, and 16px surface padding made dense screens feel
  cramped and cold.
- Every primary button, the current navigation item, and every link were the same saturated cobalt,
  so the accent stopped meaning anything.
- The navigation column and the topbar were two bordered slabs around the work, competing with it.
- Motion was a set of durations with no rule for when to move. One curve eased in, buttons gave no
  answer to a press, dialogs and menus appeared with no entrance, hover styles stuck on touch
  screens, and the embedded process designer kept the superseded beige, navy, and lime palette in
  both themes.

The owner asked for the interface to be redesigned for smoothness: the roomy spacing and soft
neutral surfaces familiar from shadcn/ui, and motion built to Emil Kowalski's interface-craft rules
(animate by frequency of use, ease out, stay under 300ms, answer every press, grow overlays from
their origin, animate only transform and opacity, respect reduced motion and touch).

## Decision

Operational Clarity stays the name and the thesis. Its values change as follows; the numbers are
owned by [`design-system.md`](../architecture/design-system.md).

1. **One neutral scale, no tint.** The `steel` and `graphite` palettes are replaced by a single
   `neutral` scale used by both themes. The canvas and the navigation column share one tone.
2. **Ink for commands, the accent for meaning.** The primary button is ink (near-black on light,
   near-white on dark). Cobalt is kept for links, keyboard focus, and selection only. The current
   navigation item is marked by weight and a quiet neutral fill.
3. **The workspace is a sheet.** On desktop the workspace is a rounded, lightly raised sheet inset
   from the canvas, and the navigation column sits on the canvas with no border. On a phone the
   workspace is the full screen.
4. **Roomier, rounder, softer.** Surfaces pad 24px (16px on a phone); page groups sit 24px apart.
   Radii are 8px controls, 12px surfaces, 14px dialogs and the workspace sheet, 10px menus, and 6px
   items inside them, so nested corners stay concentric. Depth has four small shadows instead of
   two.
5. **One reading size.** Body, labels, buttons, and table cells are 14/20. Page titles are 24/32
   with tight tracking and section titles 16/24. Supporting text is 12–13px. This amends the size
   mapping of ADR-0090 item 4; the typefaces of ADR-0076 do not change.
6. **Accessible contrast is kept where the reference is weak.** Input borders stay at 3:1 against
   the surface and the focus indicator is a solid accent edge with a soft halo, because the
   reference kit's pale input border and translucent ring do not meet WCAG 2.2 non-text contrast.
7. **Motion follows frequency.** What a user does all day does not animate: row hover, keyboard
   commands, collapsing the navigation, and switching theme are immediate. Occasional things do:
   a button answers a press by scaling to 0.97 in 160ms; dialogs and menus fade and scale in from
   0.96 in 180ms, a dialog from its center and a menu from its trigger; the phone navigation drawer
   slides in 240ms on a drawer curve.
8. **Curves.** `out` for anything entering or answering a press, `inOut` for something that moves
   while staying on screen, `drawer` for the navigation drawer, and `standard` for color changes.
   No curve eases in. No interface motion runs longer than 320ms. A test enforces both.
9. **Overlays leave at once.** The pinned Kobalte alpha unmounts a closed overlay immediately, so no
   exit animation is specified. Leaving faster than arriving is the intended asymmetry.
10. **Only transform and opacity animate,** with named transition properties, never `all`. The one
    exception is the tabs chip, whose width Kobalte sets together with its transform.
11. **Hover is for pointers that hover.** Hover styles apply only under
    `(hover: hover) and (pointer: fine)`. Reduced motion removes movement and keeps fades.
12. **The process designer reads the tokens.** Its stylesheet uses the semantic token variables, so
    it follows the theme like every other surface.
13. **The stylesheet budget stands.** The stock preset loses the scales RITSEI defines itself and
    the spacing steps out of reach, which keeps the shipped stylesheet under the 50 KB budget of
    ADR-0090 with the new tokens.

## Alternatives Considered

- **Install shadcn/ui or a Solid port of it:** rejected, as in ADR-0090. It is a React kit; a port
  would add a second component source beside the RITSEI-owned Panda recipes and Kobalte wrappers.
  The reference is used for proportion, not for code.
- **Keep cobalt primary buttons and only soften the surfaces:** rejected; the accent would still be
  spent on every command.
- **Animate route changes and stagger lists:** rejected. Navigation and lists are seen hundreds of
  times a day, where motion reads as delay.
- **Adopt the reference kit's input border and focus ring unchanged:** rejected; both fail 3:1
  non-text contrast.
- **Raise the stylesheet budget:** rejected; trimming unused stock tokens was enough.

## Consequences

- Every screen changes appearance without a change to feature code, except three counts that now
  read correctly at one (`1 entry`), the accounts filter that now uses the shared select, and the
  process designer's stylesheet.
- Text is one size larger in tables, so a dense table shows slightly less per row width. Density
  profiles remain the place to tighten a specific surface.
- Token names changed: `actionText` is `link`, `actionSubtle` and `contentSelected` are
  `accentSubtle`, `navigation` is `canvas`, and `action` now means the ink command fill. The
  `bodyCompact` text style is gone; `body` replaces it. Only `apps/web/src/ui/` and the Panda config
  used these names.
- A missing spacing or size step is now a type error at authoring time instead of an unused
  variable in the stylesheet. Add the step to the config when a design needs it.
- The stylesheet has about 650 bytes of headroom under its budget.
- The visual-contract baseline was regenerated. Pixel-level visual regression remains an
  activation gate (design-system Section 23).
- The concept images referenced from the design system show the earlier cobalt treatment and are
  now historical.
- Exit animations can be specified once Kobalte lets a closing overlay stay mounted.
