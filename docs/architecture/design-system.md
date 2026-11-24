# RITSEI Design System: Operational Clarity

> **Status:** Canonical description of how the UI is built. Items marked **Tested** fail CI when they
> break; everything else is guidance. Use judgment, and depart from it when the task calls for it.
>
> **Source of values:** token values, sizes, and radii live in `apps/web/panda.config.ts`, recipes in
> `apps/web/src/ui/recipes/`, layouts in `apps/web/src/ui/foundations/layout.ts`, and the shell in
> `apps/web/src/app/shell.tsx`. This document states roles and intent, not copies of those values.
>
> **Related:** [`frontend.md`](./frontend.md) · [ADR-0090](../decisions/0090-adopt-operational-clarity-visual-language.md) ·
> [ADR-0112](../decisions/0112-soften-operational-clarity-and-adopt-tactile-motion.md)

## 1. Design thesis

People use RITSEI for hours to post journals, confirm orders, receive goods, and investigate
exceptions.

> **The data is the interface. Chrome stays quiet so state, numbers, and the next action are
> obvious.**

1. **Hierarchy before decoration.** Position, size, weight, and spacing say what matters; color and
   depth are reserved for meaning (selection, focus, status).
2. **Ink for commands, one accent for meaning.** The primary button is ink; the shu accent marks
   links, keyboard focus, and selection only; the rest is paper and ink.
3. **Density with breathing room.** Controls, rows, and padding come from the Panda scale on a 4px
   grid; `strictTokens` rejects values outside the scale at build.
4. **Motion by frequency.** Repeated actions do not animate; the rest eases out and finishes within
   320ms. Section 8 lists what is tested.

The look avoids gradients, glass, glow, texture, nested cards, and decorative maps.

## 2. Product Patterns

Patterns are shared compositions for recurring jobs, in `apps/web/src/ui/patterns/`. Pick the closest
one, or compose something else when none fits.

| User job | Pattern | Typical shape |
|---|---|---|
| Scan or compare records beside a selection | `MasterDetail` | Collection and selection stay in view; not for deep editing |
| Inspect, create, or deeply edit one object | `EntityWorkspace` | Identity, lifecycle, evidence, and a focused working area |
| Understand and advance a situation | `OperationalWorkspace` | State, impact, evidence, and history legible; not a dashboard per route |
| Investigate a blocked or anomalous state | `ExceptionInvestigation` | What happened, why, scope, and safe next actions |
| Act on many records | `BulkOperation` | Explicit selected set, preview, confirmation, per-result outcome |
| Offer actions in context | `CommandSurface` | Named, context-bound commands; not navigation or authorization |

`Settings` and `Approval` are also patterns. A good screen lets the user tell where they are, what
needs attention, what they can do, and what changed. On narrow viewports, drop columns and keep
identity, selection, and focus.

## 3. Shell and navigation

The shell (`apps/web/src/app/shell.tsx`) has a collapsible **global navigation** (`aside`, toggled with
the button or ⌘B/Ctrl+B), a **topbar** holding the local section navigation, the operating context
(tenant) and utilities (theme, sign out), and a single `main` landmark with a skip link. Page identity
and commands belong to the workspace's pattern, not the shell. Tested facts
(`apps/web/src/ui/accessibility.test.ts`, `tests/frontend/shell.test.ts`): the skip link targets
`#main`, there is exactly one `main`, navigation and the theme control are reachable by keyboard and
named, the shell fits a 390px viewport without horizontal scroll, and tenant switch and sign-out work.

Design intent: global structure keeps a stable order and marks the current destination with
`aria-current="page"`; one semantic level has one visual representation; navigation locates while
commands change things, through the owning authorized boundary; context stays until it becomes a
burden; and the workspace outranks navigation chrome. Object-level commands live with the object
rather than in the topbar, a region usually has one primary button, and the current destination uses
the `contentActive` fill and a filled icon rather than the accent.

## 4. Color and status

Components consume semantic tokens from `apps/web/panda.config.ts` rather than primitive palettes or
raw colors: surfaces (`canvas`, `content`, `contentSubtle`, `contentHover`, `contentActive`), text (`text`,
`muted`), borders (`boundary`, `boundaryControl`, `boundaryStrong`), commands (`action`, `actionHover`,
`onAction`, `danger`), and the accent (`accent`, `accentSubtle`, `link`, `focusRing`, `focusHalo`).
Every token has a light and a dark value; dark mode is defined, not inverted.

- The accent is for links, focus, and selection only: not buttons, headings, the current navigation
  destination, or large fills.
- Status uses `Badge` with five tones (`neutral`, `success`, `warning`, `danger`, `info`); the label
  text is the status and the tint and dot are a second channel. Color alone should not carry status.
- `disabled` means unavailable, not unauthorized; the backend denies unauthorized actions.
- Text meets WCAG 2.2 AA, and input borders, focus indicators, and meaningful marks meet 3:1.
  **Tested:** axe `wcag2a` and `wcag2aa` on the shell and key workflows, in light mode.
- The theme comes from the stored choice, then `prefers-color-scheme`, and is never business state.

## 5. Typography, spacing, and surfaces

Use the named text styles in `apps/web/src/ui/foundations/typography.ts` (`pageTitle`,
`sectionTitle`, `body`, `label`, `button`, `tableHeader`, `tableCell`, `helper`, `metadata`, `status`,
`numeric`, `display`, `code`), rather than raw sizes; one `h1` per workspace. IBM Plex Sans is the interface face,
Shippori Mincho sets titles and display figures, and IBM Plex Mono is for identifiers only; numeric columns are right-aligned with tabular numerals;
labels and headings are sentence case. Spacing, radii, and sizes come from the Panda scale. Surfaces and panels are square and controls are 4px, as in the Kontainer
mockups ([ADR-0127](../decisions/0127-adopt-the-kontainer-visual-language.md)). Depth comes from
tone and a 1px hairline; only menus and dialogs carry a shadow; the `surface` recipe has tones `default`,
`subtle`, and `flush`.

The Kontainer screens that guide new work, and which of them exist, are mapped in
[`docs/design/kontainer/screens.md`](../design/kontainer/screens.md).

## 6. Content and formatting

Format API decimals with `formatDecimal` in `apps/web/src/ui/foundations/format.ts`, never through
floating point. **Tested:** `format.test.ts`. Also: show the currency code where several can
appear; right-align quantities with units; identifiers are monospaced; empty states say what is empty
and the next action; loading states keep a `role="status"` label; buttons name the outcome ("Confirm
order").

## 7. Accessibility

Interactive controls should have visible keyboard focus, a logical tab order, an accessible name and
role, and status announcements where state changes; icon-only controls need an accessible name.
**Tested:** axe scans (Section 4), the sign-in and shell under `forced-colors` and reduced motion at
390px, and the heading and theme control staying visible at 200% zoom. Kobalte is the headless
accessibility source, used through RITSEI wrappers (`tests/frontend/kobalte.test.ts` covers the
dialog). Native HTML is the fallback.

## 8. Motion

Tokens live in `apps/web/src/ui/motion/tokens.ts` and are mirrored in Panda. **Tested**
(`tests/frontend/motion.test.ts`): no ease-in curve (only `inOut`, for things that stay on screen),
no duration over 320ms, exit faster than enter, and the Panda tokens equal the runtime tokens. Reduced
motion is read through `apps/web/src/ui/motion/preference.ts`; feature code uses the RITSEI wrapper rather
than Motion directly.

## 9. Icons

Phosphor, through the `Icon` API and registry names, is the only icon source. **Tested:** the committed
sprite matches the registry (`tests/frontend/iconography.test.ts`).

## 10. Styling contract and boundaries

Tokens flow `primitive → semantic → recipe/component → state`, with Panda `strictTokens` on, which
rejects raw colors, primitive tokens, and arbitrary spacing at build. Panda extracts styles only from
`apps/web/src/ui/**`, and today no file outside it imports Kobalte, Panda-generated artifacts, or Motion
directly. The design system is the internal library `apps/web/src/ui/`; a separate package makes sense
when there is measured reuse or an independent release need. There is no visual-regression baseline;
token and recipe changes are reviewed as their diff
([ADR-0113](../decisions/0113-retire-frontend-compatibility-probes-and-visual-contract-test.md)).
**Tested budgets** (`accessibility.test.ts`): every stylesheet at most 50,000 bytes, every JavaScript
chunk at most 200,000 bytes, the theme control answers within 200ms.
