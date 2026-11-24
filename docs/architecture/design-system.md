# RITSEI Design System: Operational Clarity

> **Status:** Canonical and active design-system specification, compacted to its outcome-bearing rules
>
> **Implementation:** `apps/web` (tokens and recipes in `apps/web/panda.config.ts`, layouts in
> `apps/web/src/ui/foundations/layout.ts`, the shell in `apps/web/src/app/shell.tsx`, primitives and
> Product Patterns under `apps/web/src/ui/`). **Owns:** shell and navigation, Product Patterns,
> Interaction Grammar states, color, typography, density, surfaces, formatting, semantic tokens,
> component and accessibility contracts, renderer boundaries, and governance.
>
> **Related:** [`frontend.md`](./frontend.md) ·
> [ADR-0090](../decisions/0090-adopt-operational-clarity-visual-language.md) ·
> [ADR-0112](../decisions/0112-soften-operational-clarity-and-adopt-tactile-motion.md)

Section numbers are stable: removed sections are not renumbered, so links such as
`#6-product-patterns` keep working. **MUST** is required, **SHOULD** is the default (an exception needs
a documented product reason), **MAY** is permitted inside the contract.

## 2. Design thesis

People use RITSEI for hours to post journals, confirm orders, receive goods, and investigate
exceptions. The interface makes that work fast, legible, and trustworthy.

> **The data is the interface. Chrome stays quiet so state, numbers, and the next action are
> obvious.**

1. **Hierarchy before decoration.** Position, size, weight, and spacing say what matters; color and
   depth are reserved for meaning (selection, focus, status).
2. **Ink for commands, one accent for meaning.** The primary command is ink, one cobalt accent marks
   links, keyboard focus, and selection, and everything else is an untinted neutral.
3. **Density with breathing room.** 36px controls, 40px rows, 14px text on a 4px grid; surfaces pad 24px.
4. **Motion by frequency.** What users do hundreds of times a day does not animate; the rest eases
   out and stays under 320ms. Reduced motion MUST be honored.

An effect that harms determinism, readability, accessibility, or speed is a defect: no gradients,
glass, glow, texture, nested cards, or decorative maps. A deviation MUST name the problem it solves,
the affected states, its accessibility behavior, and its exit path.

## 6. Product Patterns

A Product Pattern is a recurring product decision. The user's dominant job selects it, not the route
shape, and each semantic responsibility has one visual owner.

| User job | Pattern | Contract |
|---|---|---|
| Scan or compare records while inspecting one | `MasterDetail` | Keep collection and selection in view; not for deep editing |
| Inspect, create, or deeply edit one object | `EntityWorkspace` | Clear identity, lifecycle, evidence, a focused working area |
| Understand and advance a situation | `OperationalWorkspace` | State, impact, evidence, and history legible; not a dashboard per route |
| Investigate a blocked or anomalous state | `ExceptionInvestigation` | What happened, why, scope, evidence, safe next actions |
| Act on many records | `BulkOperation` | Explicit selected set, preview, confirmation, per-result outcome |
| Offer business actions in context | `CommandSurface` | Named, context-bound commands; not navigation or authorization |

`Settings` and `Approval` remain named patterns; a new pattern needs a named semantic problem and the
contract in Section 23. A major workspace follows
`ORIENT → LOCATE → RECOGNIZE → INVESTIGATE → ACT → OBSERVE`. **Flexible Workspace** sets how much
context stays visible (`Single`, `MasterDetail`, `DetailInspector`, `MasterDetailInspector`); a pane
MUST NOT stay merely because the previous view had it, and narrow viewports drop columns or turn the
inspector into a drawer.

## 7. Interaction Grammar and semantic states

State is intent, never a raw color. Interaction (hovered, selected, dragging, disabled), placement
(valid, invalid, constrained), operational (normal, attention, constrained, critical, blocked), and
system (pending, completed, failed, cancelled) states are orthogonal. `disabled` is availability, not
authorization; the backend denies unauthorized actions. Summary precedence: `blocked > critical >
constrained > attention > informative > normal`. Every important state uses at least two channels
(text, icon, shape, border, color).

## 8. Color system

Color is a semantic resource. Primitive palettes (a neutral scale and one cobalt accent) live only in
`apps/web/panda.config.ts`; components consume semantic tokens, each with a light and a dark value.

| Token | Light | Dark | Use |
|---|---|---|---|
| `canvas` | `#FAFAFA` | `#09090B` | Application background, navigation column |
| `content` | `#FFFFFF` | `#131316` | Workspace sheet, tables, forms, dialogs |
| `contentSubtle` | `#FAFAFA` | `#18181B` | Toolbars, inset regions, row hover |
| `contentHover` / `contentActive` | `#F4F4F5` / `#EDEDEF` | `#1F1F23` / `#27272A` | Hover; current navigation destination |
| `text` / `muted` | `#18181B` / `#6A6A72` | `#EDEDEF` / `#A1A1AA` | Primary and secondary text |
| `boundary` / `boundaryControl` / `boundaryStrong` | `#E4E4E7` / `#D4D4D8` / `#8B8B94` | `#232327` / `#2E2E33` / `#71717A` | Dividers; button borders; input borders (3:1) |
| `action` / `actionHover` / `onAction` | `#18181B` / `#2E2E33` / `#FAFAFA` | `#FAFAFA` / `#E4E4E7` / `#18181B` | Primary button (ink) |
| `accent` / `accentSubtle` / `link` | `#2E52D6` / `#EEF2FF` / `#2442B0` | `#7C9BFF` / `#1B2440` / `#A9BCFF` | Selection edge and row; links |
| `focusRing` | `#2E52D6` | `#7C9BFF` | Solid focus edge, with a soft 3px halo |
| `danger` / `onDanger` | `#C0352B` / white | `#FF8A80` / `#09090B` | Destructive buttons, errors |

Status triples (`status.<tone>.fg | bg | border`) exist for `neutral`, `success`, `warning`, `danger`,
and `info`. The accent is for links, keyboard focus, and selection only, never buttons, the current
navigation destination, headings, or large fills. A region has at most one primary button. Status
color MUST accompany a text label. Text meets WCAG 2.2 AA (4.5:1, large text 3:1); input borders,
focus indicators, and chart marks meet 3:1; `forced-colors` mode keeps state through borders and
text. Dark mode is defined, not inverted; the theme comes from the stored choice, then
`prefers-color-scheme`, and is never business state.

## 10. Typography, density, and surfaces

Pretendard for UI and IBM Plex Mono for identifiers only; components MUST use semantic text styles:
`pageTitle` 24/32 (one `h1` per workspace), `sectionTitle` 16/24, `body`, `label`, `button`, and
`tableCell` 14/20, `tableHeader` and `helper` 13, `metadata` and `status` 12, `display` 32/40 for key
figures. Hierarchy comes from weight and color; nothing primary is below 12px; numeric columns are
right-aligned with tabular numerals. Phosphor is the only icon source, and icon-only controls need an
accessible name.

The grid is 4px with 36px controls (32px in toolbars) and about 40px rows. Feature code MUST NOT use
arbitrary spacing. Density is `comfortable`, `compact` (default), or `dense` (only with readability
evidence), always with targets of at least 24px. Depth comes from tone, a 1px hairline, and one small
shadow; nested cards SHOULD NOT be used.

## 13. Data visualization

A chart answers a declared business question; prefer a table when exact values matter. Every chart has
a text or table alternative and labels units, currency, range, and freshness. HTML owns semantics, and
no critical value or action exists only in pixels. WebGPU is not part of the system; reintroducing it
needs a named need, measurement, and an ADR.

## 15. Content and formatting

Format API decimals with `ui/foundations/format.ts#formatDecimal`, never through floating point, and
show the currency code where several can appear. Quantities are right-aligned and tabular with units;
identifiers are monospaced. Empty states say what is empty and the next action, loading states keep a
`role="status"` label, and buttons name the outcome ("Confirm order").

## 16. Core component contracts

Every shared component has a typed contract (props, variants, slots, events, focus, keyboard,
accessibility) and a `USE WHEN` and `DO NOT USE FOR` product contract.

### Navigation and workspace shell

A global navigation rail, an optional domain-local navigator, and a dominant workspace sit under a
thin global topbar. Each layer answers one question and MUST NOT take over another's job:

| Layer | Answers | MUST NOT own |
|---|---|---|
| Global navigation | Where am I in the business? | Record actions, filters, object tabs |
| Global topbar (about 48px) | Under which operating context? | A second domain menu, object mutations |
| Local navigation | Which capability in this domain? | Repeated global destinations, mutations |
| Context header | Which object or situation? | Global context, repeated labels |
| Workspace | What is happening, and why? | Authority inferred from presentation |
| Command surface | What authorized command can I run? | Navigation or frontend authorization |

Five laws: (1) global structure stays stable and marks the current location with
`aria-current="page"`; (2) one semantic level has one visual representation; (3) navigation locates and
commands change, through the owning authorized boundary; (4) preserve context until it becomes a
burden; (5) the workspace outranks navigation chrome. Global navigation is collapsible with accessible
names when collapsed, and its active destination uses the `contentActive` fill and a filled icon,
never the accent.

## 17. Accessibility and interaction rules

Every interactive control MUST have visible keyboard focus, a logical tab order, an accessible name and
role, status announcements, and sound behavior at 200% zoom. Kobalte is the only headless
accessibility source, approved per exercised primitive with a RITSEI wrapper and a browser test;
native HTML is the fallback. Drag and drop is an enhancement: pointer, keyboard, and form editing give
equivalent results, and a drop becomes a validated command before persistence.

## 21. Token and styling contract

Tokens flow `primitive → semantic → recipe/component → state` with Panda `strictTokens`. Feature code
MUST NOT use raw colors, primitive tokens, arbitrary spacing, or unapproved recipes; Panda extracts
styles only from `apps/web/src/ui/**`, and features compose named layouts, recipes, and primitives.
Theme, density, high-contrast, and reduced-motion variants live in semantic tokens, and the stylesheet
stays within the 50 KB budget of `apps/web/src/ui/accessibility.test.ts`.

## 22. Frontend location and dependency boundaries

The design system is the internal library `apps/web/src/ui/` inside the single frontend application;
a separate package needs measured reuse or an independent release need. Feature code MUST NOT import
Kobalte, dnd-kit, Panda-generated artifacts, renderer libraries, or Motion directly; it uses the
RITSEI wrappers.

## 23. Activation, validation, and governance

A Product Pattern, shared component, or renderer adapter is complete only with a named semantic
problem, a `USE WHEN` and `DO NOT USE FOR` contract, typed props and events, keyboard and
screen-reader behavior, empty, loading, error, and degraded states, contrast and reduced-motion
evidence, and a test when behavior is non-trivial. There is no visual-regression baseline: a rule that
can be stated has a test that states it, and a token or recipe change is reviewed as its diff
([ADR-0113](../decisions/0113-retire-frontend-compatibility-probes-and-visual-contract-test.md)).
Feature teams compose existing patterns and preserve backend authority; they MUST NOT create
industry-specific dashboard families, rely on color alone for state, or bypass the renderer boundary.

## 25. Final formula

```text
Neutral canvas + a white workspace sheet + soft hairline surfaces
Ink for commands; one cobalt accent for links, focus, and selection
Status color only with a status label
14px text · 36px controls · 24px surface padding · 4px grid
Motion by frequency: answer every press, ease out, stay under 320ms
Semantic HTML first; visualization only for a declared question
```

> **RITSEI should feel like a precise instrument: quiet until something needs attention, then
> unmistakable about what it is and what to do next.**
