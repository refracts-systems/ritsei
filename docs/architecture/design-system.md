# RITSEI Design System: Operational Clarity

> **Status:** Canonical. Every rule below is either **Tested** (a named test fails when it breaks) or
> **Reviewed** (a pull-request reviewer checks it). Anything that is neither is not a rule.
>
> **Source of values:** token values, sizes, and radii live in `apps/web/panda.config.ts`, recipes in
> `apps/web/src/ui/recipes/`, layouts in `apps/web/src/ui/foundations/layout.ts`, and the shell in
> `apps/web/src/app/shell.tsx`. This document states roles and rules, not copies of those values.
>
> **Related:** [`frontend.md`](./frontend.md) · [ADR-0090](../decisions/0090-adopt-operational-clarity-visual-language.md) ·
> [ADR-0112](../decisions/0112-soften-operational-clarity-and-adopt-tactile-motion.md)

**MUST** is required, **SHOULD** is the default (an exception needs a documented product reason),
**MAY** is permitted. A deviation MUST name the problem it solves, the states it affects, its
accessibility behavior, and its exit path.

## 1. Design thesis

People use RITSEI for hours to post journals, confirm orders, receive goods, and investigate
exceptions.

> **The data is the interface. Chrome stays quiet so state, numbers, and the next action are
> obvious.**

1. **Hierarchy before decoration.** Position, size, weight, and spacing say what matters; color and
   depth are reserved for meaning (selection, focus, status). Reviewed.
2. **Ink for commands, one accent for meaning.** The primary button is ink; the cobalt accent marks
   links, keyboard focus, and selection only; the rest is neutral. Reviewed.
3. **Density with breathing room.** Controls, rows, and padding come from the Panda scale on a 4px
   grid; feature code MUST NOT introduce arbitrary spacing. Reviewed (`strictTokens` rejects unknown
   tokens at build).
4. **Motion by frequency.** Repeated actions do not animate; the rest eases out and finishes within
   320ms. Section 8 lists what is tested.

No gradients, glass, glow, texture, nested cards, or decorative maps. Reviewed.

## 2. Product Patterns

The user's dominant job selects the pattern, not the route shape; each responsibility has one visual
owner. Components live in `apps/web/src/ui/patterns/`. Reviewed.

| User job | Pattern | Contract |
|---|---|---|
| Scan or compare records beside a selection | `MasterDetail` | Collection and selection stay in view; not for deep editing |
| Inspect, create, or deeply edit one object | `EntityWorkspace` | Identity, lifecycle, evidence, and a focused working area |
| Understand and advance a situation | `OperationalWorkspace` | State, impact, evidence, and history legible; not a dashboard per route |
| Investigate a blocked or anomalous state | `ExceptionInvestigation` | What happened, why, scope, and safe next actions |
| Act on many records | `BulkOperation` | Explicit selected set, preview, confirmation, per-result outcome |
| Offer actions in context | `CommandSurface` | Named, context-bound commands; not navigation or authorization |

`Settings` and `Approval` are also patterns. A screen follows `ORIENT → LOCATE → RECOGNIZE →
INVESTIGATE → ACT → OBSERVE`: the user can tell where they are, what needs attention, what they can
do, and what changed. A new pattern needs a named semantic problem and the checklist in Section 11.
Keep a pane only while it helps the task; on narrow viewports drop columns and keep identity,
selection, and focus.

## 3. Shell and navigation

The shell (`apps/web/src/app/shell.tsx`) has a collapsible **global navigation** (`aside`, toggled with
the button or ⌘B/Ctrl+B), a **topbar** holding the local section navigation, the operating context
(tenant) and utilities (theme, sign out), and a single `main` landmark with a skip link. Page identity
and commands belong to the workspace's pattern, not the shell. Reviewed, plus these tested facts
(`apps/web/src/ui/accessibility.test.ts`, `tests/frontend/shell.test.ts`): the skip link targets
`#main`, there is exactly one `main`, navigation and the theme control are reachable by keyboard and
named, the shell fits a 390px viewport without horizontal scroll, and tenant switch and sign-out work.

Five laws (Reviewed): (1) global structure keeps a stable order and marks the current destination with
`aria-current="page"`; (2) one semantic level has one visual representation, so a breadcrumb or tab
only appears for a real hierarchy; (3) navigation locates and commands change, and commands go through
the owning authorized boundary; (4) keep context until it becomes a burden; (5) the workspace outranks
navigation chrome. The topbar carries no object-level commands. A region has at most one primary
button, where a region is a pattern's header, toolbar, or dialog footer. The current navigation
destination uses the `contentActive` fill and a filled icon, never the accent.

## 4. Color and status

Components consume semantic tokens from `apps/web/panda.config.ts`, never primitive palettes or raw
colors: surfaces (`canvas`, `content`, `contentSubtle`, `contentHover`, `contentActive`), text (`text`,
`muted`), borders (`boundary`, `boundaryControl`, `boundaryStrong`), commands (`action`, `actionHover`,
`onAction`, `danger`), and the accent (`accent`, `accentSubtle`, `link`, `focusRing`, `focusHalo`).
Every token has a light and a dark value; dark mode is defined, not inverted. Reviewed.

- The accent is for links, focus, and selection only: not buttons, headings, the current navigation
  destination, or large fills.
- Status uses `Badge` with five tones (`neutral`, `success`, `warning`, `danger`, `info`); the label
  text is the status and the tint and dot are a second channel. Color alone MUST NOT carry status.
- `disabled` means unavailable, not unauthorized; the backend denies unauthorized actions.
- Text meets WCAG 2.2 AA, and input borders, focus indicators, and meaningful marks meet 3:1.
  **Tested:** axe `wcag2a` and `wcag2aa` on the shell and key workflows, in light mode.
- The theme comes from the stored choice, then `prefers-color-scheme`, and is never business state.

## 5. Typography, spacing, and surfaces

Use the named text styles in `apps/web/src/ui/foundations/typography.ts` (`pageTitle`,
`sectionTitle`, `body`, `label`, `button`, `tableHeader`, `tableCell`, `helper`, `metadata`, `status`,
`numeric`, `display`, `code`), never raw sizes; one `h1` per workspace. Pretendard is the UI face and
IBM Plex Mono is for identifiers only; numeric columns are right-aligned with tabular numerals;
labels and headings are sentence case. Spacing, radii, and sizes come from the Panda scale. Depth
comes from tone, a 1px hairline, and one small shadow; use the `surface` recipe tones (`default`,
`subtle`, `flush`). Reviewed.

## 6. Content and formatting

Format API decimals with `formatDecimal` in `apps/web/src/ui/foundations/format.ts`, never through
floating point. **Tested:** `format.test.ts`. Reviewed: show the currency code where several can
appear; right-align quantities with units; identifiers are monospaced; empty states say what is empty
and the next action; loading states keep a `role="status"` label; buttons name the outcome ("Confirm
order").

## 7. Accessibility

Every interactive control MUST have visible keyboard focus, a logical tab order, an accessible name
and role, and status announcements where state changes; icon-only controls need an accessible name.
Reviewed, plus the **Tested** items: axe scans (Section 4), the sign-in and shell under
`forced-colors` and reduced motion at 390px, and the heading and theme control staying visible at 200%
zoom. Kobalte is the only headless accessibility source and is used only through RITSEI wrappers; each
primitive is approved when it has a wrapper and a browser test (`tests/frontend/kobalte.test.ts`
covers the dialog). Native HTML is the fallback.

## 8. Motion

Tokens live in `apps/web/src/ui/motion/tokens.ts` and are mirrored in Panda. **Tested**
(`tests/frontend/motion.test.ts`): no ease-in curve (only `inOut`, for things that stay on screen),
no duration over 320ms, exit faster than enter, and the Panda tokens equal the runtime tokens. Reduced
motion is read through `apps/web/src/ui/motion/preference.ts`; feature code uses the RITSEI wrapper, not
Motion directly. Reviewed.

## 9. Icons

Phosphor, through the `Icon` API and registry names, is the only icon source. **Tested:** the committed
sprite matches the registry (`tests/frontend/iconography.test.ts`).

## 10. Styling contract and boundaries

Tokens flow `primitive → semantic → recipe/component → state`, with Panda `strictTokens` on. Feature
code MUST NOT use raw colors, primitive tokens, arbitrary spacing, or unapproved recipes, and Panda
extracts styles only from `apps/web/src/ui/**`. Feature code MUST NOT import Kobalte, Panda-generated
artifacts, or Motion directly; today no file outside `apps/web/src/ui` does. Reviewed. The design
system is the internal library `apps/web/src/ui/`; a separate package needs measured reuse or an
independent release need. **Tested budgets** (`accessibility.test.ts`): every stylesheet at most
50,000 bytes, every JavaScript chunk at most 200,000 bytes, the theme control answers within 200ms.

## 11. Governance

A Product Pattern or shared component is complete only with a named semantic problem, a `USE WHEN` and
`DO NOT USE FOR` note, typed props, keyboard and screen-reader behavior, empty, loading, and error
states, and a test when behavior is non-trivial. There is no visual-regression baseline; a rule that
can be stated gets a test that states it, and a token or recipe change is reviewed as its diff
([ADR-0113](../decisions/0113-retire-frontend-compatibility-probes-and-visual-contract-test.md)).
Feature teams compose existing patterns and preserve backend authority; they MUST NOT build
industry-specific dashboard families or bypass the shell.
