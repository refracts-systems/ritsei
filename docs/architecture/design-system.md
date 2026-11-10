# RITSEI Design System: Operational Clarity

> **Status:** Canonical and active design-system specification
>
> **Implementation status:** The visual language in this document is implemented in `apps/web`:
> Panda tokens and recipes (`apps/web/panda.config.ts`), shell and workspace layouts
> (`apps/web/src/ui/foundations/layout.ts`), the application shell (`apps/web/src/app/shell.tsx`), and
> the shared primitives and Product Patterns under `apps/web/src/ui/`. Kobalte activation remains
> limited to tested wrappers; visual-regression evidence and the optional WebGPU renderer remain
> activation-gated.
>
> **Owns:** Navigation and shell visual contracts, Product Pattern composition, Flexible Workspace
> presentation, Interaction Grammar, color, typography, density, surfaces, data-visualization rules,
> content formatting, semantic design tokens, component contracts, accessibility, renderer
> boundaries, and design-system governance.
>
> **Related documents**
>
> - Visual language decision: [`../decisions/0090-adopt-operational-clarity-visual-language.md`](../decisions/0090-adopt-operational-clarity-visual-language.md)
> - Softer surfaces and tactile motion: [`../decisions/0112-soften-operational-clarity-and-adopt-tactile-motion.md`](../decisions/0112-soften-operational-clarity-and-adopt-tactile-motion.md)
> - Frontend architecture: [`./frontend.md`](./frontend.md)
> - Active architecture: [`./architecture-spec-v4.md`](./architecture-spec-v4.md)
> - Design-system ownership decision: [`../decisions/0056-adopt-ritsei-semantic-frontend-design-system.md`](../decisions/archive/0056-adopt-ritsei-semantic-frontend-design-system.md)
> - Typography decision: [`../decisions/0076-adopt-ritsei-typography-system.md`](../decisions/0076-adopt-ritsei-typography-system.md)
> - Iconography decision: [`../decisions/0077-adopt-ritsei-iconography-system.md`](../decisions/0077-adopt-ritsei-iconography-system.md)
> - Motion decision: [`../decisions/0078-adopt-ritsei-motion-system.md`](../decisions/0078-adopt-ritsei-motion-system.md)
> - Solid 2 primitive selection: [`../decisions/0074-switch-to-kobalte-for-solid2-accessible-primitives.md`](../decisions/0074-switch-to-kobalte-for-solid2-accessible-primitives.md)
> - Optional visualization renderer: [`../decisions/0070-select-vgpu-and-defer-typegpu.md`](../decisions/archive/0070-select-vgpu-and-defer-typegpu.md)
> - Superseded visual direction (historical): [`../decisions/0069-adopt-cartographic-enterprise-visual-grammar.md`](../decisions/archive/0069-adopt-cartographic-enterprise-visual-grammar.md), [`../decisions/0071-adopt-universal-cartographic-archetypes.md`](../decisions/archive/0071-adopt-universal-cartographic-archetypes.md)
> - Frontend state ownership: [`../decisions/0048-define-effect-application-architecture-and-frontend-state-ownership.md`](../decisions/0048-define-effect-application-architecture-and-frontend-state-ownership.md)
> - Vite and SolidJS SPA: [`../decisions/0010-use-vite-solidjs-spa.md`](../decisions/0010-use-vite-solidjs-spa.md)
> - Process Studio: [`./process-studio.md`](./process-studio.md)
> - Authorization: [`./authorization.md`](./authorization.md)
> - Documentation boundaries: [`../documentation-boundaries.md`](../documentation-boundaries.md)

## 1. Scope and normative language

This document is the single source of truth for RITSEI's recurring visual, interaction, and
renderer decisions. Tokens, recipes, components, and styling tools implement these decisions; they
do not replace them.

The following terms are normative:

- **MUST / MUST NOT:** required for a conforming RITSEI surface.
- **SHOULD / SHOULD NOT:** default behavior; an exception requires a documented product reason.
- **MAY:** permitted when it remains inside the approved contract.

A feature deviation MUST name the semantic problem it solves, the affected states and surfaces, the
accessibility behavior, and the exit or replacement path. Local styling exceptions MUST NOT become a
new design-system dialect.

## 2. Design thesis

RITSEI is used for hours at a time by people who post journals, confirm orders, receive goods, and
investigate exceptions. The interface exists to make that work fast, legible, and trustworthy. Its
visual language is therefore **Operational Clarity**:

> **The data is the interface. Chrome stays quiet so state, numbers, and the next action are
> obvious.**

Three principles govern every decision:

1. **Hierarchy before decoration.** Position, size, weight, and spacing establish what matters.
   Color and depth are reserved for meaning: selection, focus, and status.
2. **Ink for commands, one accent for meaning.** The primary command is ink: near-black on light,
   near-white on dark. A single cobalt accent is kept for links, keyboard focus, and selection.
   Everything else is an untinted neutral. Semantic status colors appear only where a status exists.
3. **Density with breathing room.** Enterprise users scan many records. Controls stay compact
   (36px controls, 40px rows, 14px text) on a strict 4px grid, while surfaces pad 24px and groups
   sit 24px apart, so structure is visible at a glance.
4. **Motion by frequency.** What a user does hundreds of times a day does not animate. What happens
   occasionally moves quickly, eases out, and starts from where it came from (Section 18).

The language learns from proven operational software: SAP Fiori's floorplan discipline and object
identity, the information density of financial terminals, and the restraint of modern product tools
such as Linear and Stripe. It copies none of them. RITSEI's identity comes from consistency,
precision, and the quality of its information architecture, not from ornament.

The UI MUST remain deterministic, readable, accessible, power-conscious, and fast. A visual effect
that reduces those properties is a defect, not brand expression.

Concept references (generated with GPT Image during the ADR-0090 redesign; historical and
non-normative — they show the cobalt treatment that ADR-0112 replaced, and this document and the
token sources are authoritative):
[light](./assets/operational-clarity-concept-light.png) ·
[dark](./assets/operational-clarity-concept-dark.png). The concept shows a KPI strip, pagination,
and a ⌘K search field that are not implemented yet; they MUST NOT be added as inert UI.

## 3. Visual character and non-goals

The target character is:

- **Precise:** exact alignment, tabular numerals, consistent spacing, crisp 1px boundaries.
- **Calm:** untinted neutral surfaces, soft corners, no saturated backgrounds, no gradients, no
  glow.
- **Responsive:** every press is answered at once; nothing the user repeats is made to wait for an
  animation.
- **Trustworthy:** financial values and identifiers are exact, aligned, and never ambiguous.
- **Efficient:** the shortest path from orientation to action; no screen-filling hero headers.
- **Consistent:** every workspace uses the same shell, header, toolbar, table, and inspector rules.

RITSEI is NOT:

- a beige or paper-textured editorial interface;
- a dark-slab sidebar with low-contrast navigation;
- a marketing site or a dashboard of decorative KPI cards;
- glassmorphism, neumorphism, or skeuomorphism;
- a decorative map, contour, or topographic background; or
- a generic template where every action is a primary button.

## 4. System layers

RITSEI separates business meaning from its visual projection:

```text
Business truth
      ↓
Business semantics
      ↓
Typed visual projection intent
      ↓
Product Patterns + Interaction Grammar
      ↓
Visual Grammar
      ↓
RITSEI UI components
      ↓
Behavior + visual contracts
      ↓
DOM / SVG / Canvas / WebGPU renderer adapters
```

The layers have separate owners:

| Layer | Owns | Must not own |
|---|---|---|
| Domain | Authoritative facts, invariants, capabilities, typed commands | UI layout or styling |
| Projection | Decoded view models and typed representation intent | New business authority |
| Product Pattern | Canonical composition and workflow behavior | CSS implementation details |
| Interaction Grammar | Selection, editing, dragging, focus, confirmation, navigation | Backend authorization |
| Visual Grammar | How business meaning is represented visually | Domain truth or renderer internals |
| Design System | Tokens, recipes, components, accessibility, density, visual contracts | Domain mutations |
| Renderer | Geometry, lifecycle, and DOM/SVG/Canvas/WebGPU output | Business aggregation or policy |

The browser renders decoded projections and invokes public commands. It never owns a business fact,
authorization decision, transaction, or workflow invariant.

## 5. Stable language and extensible expression

The system has two zones.

### Stable language

These are controlled foundations:

```text
semantic vocabulary and states
semantic tokens
typography and hierarchy
density and spacing rules
interaction states
attention and severity treatment
recipes and core components
accessibility and reduced-motion rules
renderer and fallback contracts
```

Changes to this zone are design-system changes. They MUST preserve meaning, accessibility, public
component behavior, and token compatibility.

### Extensible expression

These adapt to a business question or domain:

```text
projection intent
visual grammar
Product Pattern composition
workspace composition
domain-specific combinations
new representations
```

The three permitted forms of extensibility are:

1. **Visual extensibility:** change how an existing semantic concept is represented.
2. **Grammar extensibility:** add a governed representation for a new business meaning.
3. **Composition extensibility:** combine approved meanings and representations differently for a
   business model.

New business meaning requires an owning domain decision and a typed projection contract. It MUST NOT
be introduced as an untyped feature-local visual dialect.

## 6. Product Patterns

Product Patterns are recurring product decisions, not Panda layout primitives. Panda `Stack`,
`Grid`, and `Container` are implementation mechanisms; RITSEI patterns decide what the user sees,
why it is there, and how it behaves.

Approved starting patterns include:

```text
EntityWorkspace
OperationalWorkspace
Settings
Approval
ExceptionInvestigation
BulkOperation
MasterDetail
CommandSurface
```

The dominant user job selects the primary Product Pattern; route shape or component availability does
not. Patterns MAY compose when they serve distinct jobs, but each semantic responsibility MUST have
one clear visual owner.

| User job | Primary pattern | Contract and boundary |
|---|---|---|
| Browse, scan, or compare records while inspecting a selection | `MasterDetail` | MUST keep the collection and selected detail in view when that context helps comparison. MUST NOT be the universal detail layout or default for deep editing. |
| Inspect one business object, create it, or edit it deeply | `EntityWorkspace` | MUST give the object clear identity, lifecycle, relevant evidence, and a focused working area. Creation and deep editing SHOULD use available space rather than retain a list by habit. |
| Understand and advance an operational situation | `OperationalWorkspace` | MUST make current state, impact, evidence, dependencies, process progress, and relevant history legible; present eligible typed commands through `CommandSurface`. MUST NOT turn every route into a dashboard. |
| Investigate a blocked, anomalous, or attention-worthy state | `ExceptionInvestigation` | MUST explain what happened, why, affected scope, evidence, and safe next actions. MUST NOT be reduced to a red badge or substitute for domain policy. |
| Apply an action to a high-volume set of records | `BulkOperation` | MUST show the explicit selected set, validation or preview, confirmation where required, and per-result outcome. Mutations MUST use the owning authorized command. |
| Present available business actions for the current context | `CommandSurface` | MUST show named, context-bound commands and their outcomes. MUST NOT act as navigation, authorization, or a second copy of the same prominent action elsewhere. |

`Settings` and `Approval` remain named patterns for their corresponding product jobs; they MUST NOT
alter the shell or workspace rules below. `OperationalWorkspace` is RITSEI's default for
situation-oriented screens, not a universal page template. Its application-state and routing integration is owned by
[`frontend.md`](./frontend.md#situation-oriented-operational-ui); this document owns the reusable
composition contract.

The core RITSEI cognitive sequence is:

```text
ORIENT → LOCATE → RECOGNIZE → INVESTIGATE → ACT → OBSERVE
```

A major workspace SHOULD help the user answer, in order: where they are in the business; which
capability they are using; what objects, states, or exceptions need attention; what is happening and
why; which authorized command they can perform; and what changed afterward. RITSEI MUST NOT reduce its
dominant interaction model to `navigate → form → save`.

### Flexible Workspace

Flexible Workspace is a reusable presentation capability, not a universal visual template or a
business-state model. Product Patterns define the user's job; the workspace mode determines how much
surrounding context remains visible.

| Mode | Use when |
|---|---|
| `Single` | Focused creation, deep editing, or work that does not benefit from an adjacent object or inspector. |
| `MasterDetail` | Scanning or comparing a collection while inspecting the selected object. |
| `DetailInspector` | A primary workspace benefits from a contextual secondary view, without a persistent collection. |
| `MasterDetailInspector` | Collection, selected detail, and a distinct contextual inspector are all useful at once and the viewport supports them. |

Collection and selection SHOULD remain visible for scanning, comparison, and investigation when they
reduce reconstruction effort. The object or canvas SHOULD receive more space for focused editing.
Panes MUST NOT remain merely because they appeared in the previous view; close or collapse context
when it becomes a burden.
Selection, column layout, route state, and focus are presentation concerns unless a user-facing
shareable or deep-link contract makes them navigable state. Frontend ownership is defined in
[`frontend.md`](./frontend.md).

On wide screens, a workspace MAY show multiple columns. At narrower widths it SHOULD remove columns
that no longer serve the current task; an inspector MAY become a drawer or focused view. Responsive
changes MUST preserve object identity, selection meaning, commands, validation, keyboard access, and
focus behavior.

### Cognitive rationale and agent entry

Stable global landmarks support spatial memory. Expanded navigation supports discovery and
recognition; its collapsed state gives experienced users more working space. `MasterDetail` lowers
the cost of comparing items by preserving useful context. Operational evidence, dependencies, state,
and history externalize memory so the user does not have to reconstruct them across screens. A
visible boundary SHOULD correspond to a real conceptual boundary. A composition SHOULD let users
identify their operating context, current object or situation, its state, what needs attention and
why, what authorized action is available, and what happened after acting—without reconstructing that
context from memory.

Before implementing a screen, an agent MUST identify:

- the owning global domain and active local capability;
- the user's primary job and matching Product Pattern;
- object or situation identity, lifecycle/operational state, and attention;
- the primary authorized command and where its result is observed;
- which surrounding context is useful and the selected Flexible Workspace mode;
- which visual boundaries represent distinct concepts and whether any visualization answers a
  declared business question; and
- how navigation, columns, keyboard focus, and accessibility adapt responsively.

Agents MUST reuse these patterns before proposing another. If none fits, they MUST name the unmet
semantic problem before extending the system. The canonical shell responsibilities and visual rules
are in [Navigation](#navigation-and-workspace-shell). Agents MUST NOT independently introduce a new
global navigation model, duplicate top navigation, per-page shell variants, permanent icon-only
global navigation, arbitrary breadcrumbs, card grids or nested cards as the default, decorative
visualization without business meaning, canvas-only business data, or a new workspace pattern where an
existing Product Pattern fits.

A Product Pattern MUST answer:

- where identity and lifecycle state appear;
- where the primary action lives and how destructive actions are handled;
- how the user moves from summary to evidence;
- how filters, bulk actions, history, loading, errors, and degraded states appear; and
- how density and responsive behavior change without changing meaning.

Feature teams MUST compose an existing pattern before creating a new one. A new pattern requires a
named semantic problem and the usage contract in Section 23.

## 7. Interaction Grammar and semantic states

Consumers express intent, not appearance. These dimensions are orthogonal and MUST NOT be collapsed
into a raw color or one overloaded `status` value.

```text
Interaction:
  idle, hovered, selected, dragging, drop-target, disabled

Placement:
  neutral, valid, invalid, constrained

Operational:
  normal, informative, attention, constrained, critical, blocked

System:
  idle, active, pending, completed, failed, cancelled
```

Rules:

- one value per state dimension is the default;
- an interaction state MAY coexist with an operational state;
- `disabled` describes interaction availability, not authorization truth;
- `blocked` describes an operational condition that prevents progress;
- `critical` describes severity and does not automatically mean blocked;
- `constrained` describes a bounded capacity, policy, or placement condition; and
- an unauthorized action MUST be denied by the backend and represented with the approved
  authorization/error contract, not simulated as a local state mutation.

When several operational signals are summarized into one visual treatment, the precedence is:

```text
blocked > critical > constrained > attention > informative > normal
```

System failure and pending states MUST retain their own label or icon even when an operational state
is also shown. Every important state MUST be communicated through at least two channels chosen from
text, icon, shape, border, position, pattern, or semantic color.

## 8. Color system

Color is a semantic resource. Primitive palettes exist only inside `apps/web/panda.config.ts`;
components and features consume **semantic tokens**. Every semantic token has a light and a dark
value.

### Primitive palettes

```text
neutral   one untinted scale for both themes            #FFFFFF … #09090B
cobalt    the single accent: links, focus, selection   #EEF2FF … #1B2440
```

Status hues (green, amber, red, blue) are defined directly as semantic status triples rather than as
general-purpose palettes, so they cannot be used decoratively.

### Semantic tokens

| Token | Light | Dark | Use |
|---|---|---|---|
| `canvas` | `#FAFAFA` | `#09090B` | Application background and the navigation column |
| `content` | `#FFFFFF` | `#131316` | The workspace sheet and surfaces: tables, forms, panels, dialogs |
| `contentSubtle` | `#FAFAFA` | `#18181B` | Toolbars, inset regions, table row hover |
| `contentHover` | `#F4F4F5` | `#1F1F23` | Control and navigation hover, quiet fills |
| `contentActive` | `#EDEDEF` | `#27272A` | The current navigation destination |
| `text` | `#18181B` | `#EDEDEF` | Primary text |
| `muted` | `#6A6A72` | `#A1A1AA` | Secondary text, descriptions, metadata |
| `boundary` | `#E4E4E7` | `#232327` | Dividers and surface borders |
| `boundaryControl` | `#D4D4D8` | `#2E2E33` | Button borders |
| `boundaryStrong` | `#8B8B94` | `#71717A` | Input borders (≥ 3:1 non-text contrast) |
| `action` | `#18181B` | `#FAFAFA` | Primary button fill (ink) |
| `actionHover` | `#2E2E33` | `#E4E4E7` | Primary hover |
| `onAction` | `#FAFAFA` | `#18181B` | Text on `action` |
| `accent` | `#2E52D6` | `#7C9BFF` | Selection edge |
| `accentSubtle` | `#EEF2FF` | `#1B2440` | Selected row, text selection |
| `link` | `#2442B0` | `#A9BCFF` | Links |
| `focusRing` | `#2E52D6` | `#7C9BFF` | The solid edge of the keyboard focus indicator |
| `focusHalo` | cobalt at 28% | cobalt at 40% | The soft 3px halo outside that edge |
| `danger` / `onDanger` | `#C0352B` / white | `#FF8A80` / `#09090B` | Destructive buttons, errors |
| `backdrop` | 50% ink | 70% black | Modal and drawer scrim |

Status triples (`status.<tone>.fg | bg | border`) exist for `neutral`, `success`, `warning`, `danger`,
and `info`. Foreground values meet 4.5:1 on both `content` and their own tinted background.
`icon.*` tokens mirror the text and status foregrounds for glyphs. `muted` meets 4.5:1 on every
neutral surface it can sit on, including `contentHover` and `contentActive`.

### Usage rules

- The accent is reserved for links, keyboard focus, and selection. It MUST NOT be used for buttons,
  the current navigation destination, decoration, headings, or large fills.
- Commands are ink. A view SHOULD contain at most one primary (`action`) button per region; sibling
  commands use the secondary or ghost treatment.
- Status color MUST accompany a text label (and, for badges, a dot). Color alone is prohibited.
- Normal text MUST meet WCAG 2.2 AA 4.5:1; large text 3:1. Input borders, focus indicators, and
  meaningful chart marks MUST meet 3:1 non-text contrast.
- Dark mode is defined separately, not inverted. It uses the dark end of the same neutral scale
  with surfaces lighter than the canvas, a near-white command fill, and a lighter accent so contrast
  holds.
- High-contrast (`forced-colors`) mode MUST preserve state through borders, text, and system colors.

## 9. Light and dark mode

Light mode is the default operational theme: a near-white `canvas` holding the white workspace
sheet, with white surfaces separated by hairline boundaries and a faint shadow. Dark mode is a first-class alternative for low-light work: `canvas` is the
darkest layer, surfaces step up in lightness, and borders replace most shadows.

The shell resolves the theme from the user's stored choice, then `prefers-color-scheme`. The
preference is a per-device convenience stored locally; it is never business state. The theme is set
on the document root so portaled overlays (dialogs, popovers) inherit it, and `color-scheme` is set
so native controls and scrollbars match.

## 10. Typography

RITSEI typography is information infrastructure: quiet, precise, and readable in dense surfaces.

```text
Product UI        Pretendard (Inter-derived metrics, strong tabular numerals)
Technical values  IBM Plex Mono — identifiers and code-like values only
```

Semantic text styles (components MUST use these instead of raw sizes):

| Style | Size / line | Weight | Use |
|---|---|---|---|
| `pageTitle` | 24 / 32 | 600 | One `h1` per workspace, tracking −0.02em |
| `sectionTitle` | 16 / 24 | 600 | Surface and section headings (`h2`) |
| `body` | 14 / 20 | 400 | Default text, descriptions, detail lists, navigation |
| `label` | 14 / 20 | 500 | Form labels, tabs |
| `button` | 14 / 20 | 500 | Button labels |
| `tableHeader` | 13 / 20 | 500 | Column headers (muted, sentence case) |
| `tableCell` | 14 / 20 | 400 | Table cells |
| `helper` | 13 / 18 | 400 | Hints and field errors |
| `metadata` | 12 / 16 | 500 | Captions, timestamps, navigation section labels |
| `status` | 12 / 16 | 500 | Badges |
| `numeric` | 14 / 20 | 500 | Standalone figures, tabular numerals |
| `display` | 32 / 40 | 600 | Key figures in summaries only |
| `code` | 12 / 16 | 400 | Identifiers (mono) |

One reading size (14/20) carries body text, labels, buttons, and table cells; hierarchy comes from
weight and color, not from a ladder of near-identical sizes. Running text is capped at 65
characters per line.

Rules: primary information MUST NOT fall below 12px; all tables use `tabular-nums`; numeric columns
are right-aligned; labels, headings, and navigation use sentence case; no text style uses
all-caps for body content. The system MUST remain usable under 200% zoom, OS text scaling, long
labels, and localization. See [ADR-0076](../decisions/0076-adopt-ritsei-typography-system.md); the
size mapping above is set by ADR-0112, which amends ADR-0090.

### Iconography

Phosphor (through the RITSEI `Icon` API and semantic registry names such as `navigation.sales` or
`status.warning`) is the only icon source; provider imports stay inside
`apps/web/src/ui/icons/providers/`. Regular weight is the default; `fill` marks the current
navigation destination. Sizes are 14, 16, 18, 20, 24, and 32px; navigation and toolbars use 18px.
Icons default to `currentColor`. Icon-only controls MUST have an accessible name, and critical state
combines icon, text, and color.

Glyphs render as inline `<svg><use>` references into a static sprite,
`apps/web/public/icons/phosphor.svg`, that contains only the registry's glyphs (regular and fill).
The sprite is generated by `tooling/frontend/phosphor-sprite.ts` and a test keeps it in sync with
the registry; the full Phosphor icon font is never loaded by the application. `duotone` currently
renders the regular glyph. See [ADR-0077](../decisions/0077-adopt-ritsei-iconography-system.md).

### Motion

PandaCSS owns CSS transitions, keyframes, animation styles, durations, easings, component states,
and reduced-motion conditions. Motion owns only runtime geometry, springs, gestures, reordering,
orchestration, and complex SVG behavior. Solid owns state and lifecycle; Kobalte owns accessible
interaction semantics; business state remains outside the animation layer. The rules for when and
how the interface moves are in [Section 18](#18-motion-system).

Durations and curves are defined in `apps/web/src/ui/motion/tokens.ts`, which the runtime wrapper
reads. The Panda config repeats them, because a config may not import UI internals, and
`tests/frontend/motion.test.ts` fails if the two differ.

The current runtime wrapper uses `motion@13.2.0` through `apps/web/src/ui/motion/`. Feature code MUST
not import Motion directly or use `motion/react`; it consumes the RITSEI wrapper. High-frequency
surfaces and Process Studio require interruption, unmount, reduced-motion, and performance testing.

See [ADR-0078](../decisions/0078-adopt-ritsei-motion-system.md) and
[ADR-0112](../decisions/0112-soften-operational-clarity-and-adopt-tactile-motion.md) for the
decision records.

### Drag and drop

The target direct-manipulation engine is the modern `@dnd-kit/solid@0.5.0` adapter. It owns sensors,
collision, sortable preview, constraints, overlays, auto-scroll, and drag accessibility; PandaCSS owns
drag-state appearance, Solid owns ephemeral interaction state, Motion owns only optional post-drop
continuity, and the domain owns the meaning and persistence of a drop.

Activation is currently **not_activated** and the package is not installed. When it was last
checked, the published Solid adapter imported `solid-js/web`, which is not exported by the
repository's Solid 2 package layout. RITSEI MUST NOT hide the failure with a Vite alias, Solid 1
compatibility shim, the legacy React package family, or an application-wide drag context. No
production feature may import the adapter until a real Solid 2 build, pointer/keyboard interaction,
accessibility, and reduced-motion gate passes; the dependency is added in the same change as the
RITSEI adapter.

When activated, the provider boundary MUST be local to a meaningful interaction surface, drag handles
SHOULD be explicit for dense Process Studio nodes, and one transform owner applies at a time: dnd-kit
during active manipulation, Motion during custom post-drop settle, and the Process Studio viewport for
camera movement. A visual drop is intent, not business truth; final movement must become a validated
process command before persistence.

See [ADR-0079](../decisions/0079-gate-dnd-kit-solid2-activation.md) for the decision record and
[ADR-0113](../decisions/0113-retire-frontend-compatibility-probes-and-visual-contract-test.md) for
why the probe and the pinned dependency were removed.

## 11. Grid, spacing, and density

```text
4px base grid
spacing scale   2px to 80px on the 4px grid, with 2px half steps below 24px
controls        36px (md, default) · 32px (sm, toolbars and dense surfaces)
table rows      ~40px (10px vertical cell padding, 14px text)
radii           6px items · 8px controls · 10px menus · 12px surfaces · 14px dialogs and the
                workspace sheet · full for badges
borders         1px hairline (boundary); inputs use boundaryStrong
```

Nested corners are concentric: an inner radius is the outer radius less the padding between them
(a 10px menu with 4px padding holds 6px items).

Rules:

- Feature code MUST NOT introduce arbitrary spacing; use the layout and recipe names.
- Gap between page-level groups is 16–24px; a surface pads 24px (16px on a phone and in toolbars)
  with 16px gaps inside. The padding is one variable (`--surface-pad`) that a bleeding table reads.
- The numbered spacing and size steps stop at 80px (5rem); a larger step is a type error at
  authoring time and is added to the Panda config when a design needs it.
- The workspace stays full width for dense tables; an inspector column is 24rem and appears only
  when the workspace has something to inspect.
- Density profiles: `comfortable` (reading, review, touch), `compact` (default operational work),
  `dense` (high-volume monitoring, only with readability evidence). A dense profile MUST preserve the
  WCAG 2.2 target size (≥ 24px), keyboard access, row association, and visible labels.

## 12. Surfaces, borders, and elevation

RITSEI uses five surface levels. Depth comes from tone, a hairline, and a small shadow.

| Level | Treatment | Use |
|---|---|---|
| L0 Canvas | `canvas`, no border | Application background and the navigation column |
| L1 Sheet | `content`, 1px `boundary`, 14px radius, `raised` shadow, inset 8px from the canvas | The workspace on desktop; full-bleed on a phone |
| L2 Surface | `content`, 1px `boundary`, 12px radius, `raised` shadow | Tables, forms, sections, cards |
| L2 Subtle | `contentSubtle`, 1px `boundary`, no shadow | Filter toolbars, status strips |
| L3 Overlay | `content`, 1px `boundary`, 14px radius and `overlay` shadow (dialogs, drawer) or 10px radius and `floating` shadow (menus) | Dialogs, menus, mobile drawer |

Rules:

- Nested surfaces (card inside card) SHOULD NOT be used; a fieldset inside a dialog or section MAY
  use a bordered group.
- A collection table placed directly inside a surface bleeds to the surface edges, with a hairline
  under its header and no bottom border on its last row.
- Selected rows use `contentSelected` plus a 2px accent edge on the first cell.
- Blur, translucency, texture, and gradients are not part of the system.

## 13. Data visualization

Charts and spatial views answer a declared business question; they are never decoration.

- Prefer a table when exact values matter; use a chart when trend, distribution, or comparison is
  the question. Every chart has an accessible text or table alternative.
- Series colors: the accent for the primary series, neutrals for context, and status colors only
  for status. Do not encode more than one meaning per channel.
- Units, currency, time range, freshness, and missing data MUST be labeled.
- Relationship and topology projections (for example the User Accounts distribution view) use the
  existing typed projection contract and the HTML/SVG `CartographyField` renderer under
  `apps/web/src/ui/renderers/cartography/`. That renderer is a visualization tool, not the brand
  language; it MUST follow the colors and type in this document.

## 14. Domain surfaces

All domains use the same shell, Product Patterns, and visual language. Domain differences come from
content and composition, never from domain-specific palettes or materials.

- **Revenue and Supply:** collection tables of customers, suppliers, quotations, and orders, with a
  selected-document inspector; one primary "create" action; lifecycle shown as status badges.
- **Inventory:** item and warehouse master data, stock positions, reservations, and movements;
  quantities right-aligned with units; available vs. reserved shown explicitly.
- **Finance:** configuration, chart of accounts, periods, and posted journals; amounts exact,
  right-aligned, and grouped; debit/credit never signalled by color alone.
- **Process Studio:** the designer canvas receives the space it needs; catalogs and monitors use
  standard tables and badges.
- **Administration:** parties, user accounts, and access use the same collection and inspector
  rules; destructive or privilege-changing actions are confirmed.

## 15. Content and formatting

ERP trust depends on exact, consistent values.

- **Money and decimals:** API decimal strings are formatted for display with
  `ui/foundations/format.ts#formatDecimal`, which groups digits without converting to floating
  point. Show the currency code where more than one currency can appear.
- **Numbers and quantities:** right-aligned, tabular, with units where meaningful.
- **Identifiers:** monospaced; in table cells long identifiers truncate visually with an ellipsis
  while the full value remains in the DOM for copy and assistive technology. Prefer a human-readable
  name with the identifier as secondary detail.
- **Dates and times:** locale-aware, with time zone when it changes meaning.
- **Status labels:** the domain's lifecycle word (`draft`, `confirmed`, `cancelled`) rendered as a
  badge whose tone is mapped by the owning feature.
- **Empty states:** say what is empty and what the user can do next. Loading states keep a semantic
  `role="status"` label.
- **Copy:** sentence case, verbs on buttons that name the outcome ("Confirm order"), no internal
  jargon in user-facing descriptions where a plain phrase exists.

## 16. Core component contracts

Every shared component has a machine contract (props, variants, slots, events, focus, keyboard, and
accessibility behavior) and a human/product contract:

```text
USE WHEN
DO NOT USE FOR
REQUIRES
ACCESSIBILITY NOTES
EMPTY / LOADING / ERROR / DEGRADED BEHAVIOR
DENSITY AND RESPONSIVE BEHAVIOR
```

### Tables

Tables MUST remain semantic HTML. An untinted header row with 13px muted labels; 14px cells;
hairline row separators; an immediate hover tint with no transition; selected rows tinted with an
accent edge; numeric columns right-aligned; captions visually hidden (`sr-only`) when a visible heading already names the table.
Canvas MUST NOT replace a standard enterprise table.

### Forms

Labels above controls (14px medium), helper text below (13px muted), errors in `danger` and
associated with the control. Inputs are 36px with `boundaryStrong` borders and an 8px radius; an
invalid field takes a `danger` border. Keyboard focus is a solid `focusRing` edge with a 3px
`focusHalo` outside it; links and rows, which have no edge, keep a 2px offset ring. A select draws
its own arrow instead of the platform one.
Group related fields with a fieldset; actions sit at the end of the form or dialog footer.

### Buttons

| Variant | Use |
|---|---|
| `primary` | The single most important command in a region; ink, not the accent |
| `secondary` | Other commands (default) |
| `ghost` | Low-emphasis and toolbar commands, icon-only utilities |
| `danger` | Destructive commands, always confirmed |

Sizes are `md` (36px) and `sm` (32px). Labels name the action and match the resulting confirmation.
A button answers a press by scaling to 0.97; fields do not move. Loading buttons show a spinner
beside the label and expose `aria-busy`.

### Action menu

`ActionMenu` (`ui/primitives/action-menu.tsx`, Kobalte `DropdownMenu`) collects a region's
secondary commands behind one "More actions" control.

```text
USE WHEN       a header or toolbar has more than two or three commands of similar weight
DO NOT USE FOR navigation, the region's primary command, or destructive commands that need
               to stay visible for safety review
REQUIRES       commands expressed as Dialogs (or other launchers) rendered as children
```

A `Dialog` rendered inside an `ActionMenu` does not render its trigger button; it registers its
trigger label as a menu item, opens after the menu has closed and released focus, and returns focus
to the menu control when it closes. Keep the primary command and at most one frequent secondary
command visible beside the menu. The panel grows from the control that opened it (its transform
origin is the trigger). It renders in place rather than in a Portal: under the pinned Kobalte Solid
2 alpha, popper positioning only runs when the panel shares the trigger's subtree. Revisit when
Kobalte is upgraded.

### Tabs

A segmented control: a quiet track with the selected tab as a raised chip that slides between
positions. Use it for a few sibling views of one workspace, never for navigation between
workspaces.

### Badges

Pill-shaped, 20px tall, tinted background, colored text, and a leading dot. The label carries the
meaning; the tone (`neutral`, `success`, `warning`, `danger`, `info`) is a second channel.

### Navigation and workspace shell

The shell has distinct semantic responsibilities. Its canonical desktop form provides a global
navigation rail, an optional domain-local navigator, and a dominant adaptive workspace under a thin
global topbar:

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ RITSEI | Operating context | Search / run command | Global utilities    │
├──────────────┬──────────────────────┬───────────────────────────────────┤
│ Global       │ Local domain          │ Workspace                         │
│ navigation   │ navigation (optional) │ context header + work + inspector │
└──────────────┴──────────────────────┴───────────────────────────────────┘
```

| Layer | Answers | Owns | MUST NOT own |
|---|---|---|---|
| Global navigation | Where am I in the business? | Stable, broad business landmarks | Record actions, filters, object tabs, or page-specific commands |
| Global topbar | Under which operating context am I working? | RITSEI identity, tenant/company/location/fiscal context, global search or command entry, justified quick-create, inbox/notifications, help, and identity | A second domain menu or object-level mutations |
| Local navigation | Which capability in this domain am I using? | Contextual domain capabilities such as overview, orders, suppliers, receiving, or reporting | Repeated global destinations, object mutations, or a complete database table of contents |
| Context header | Which object or situation is this? | Human-readable identity, identifier, lifecycle/operational state, impact, and a primary command entry where useful | Global operating context or repeated navigation labels |
| Workspace | What is happening, and why? | The selected Product Pattern, evidence, dependencies, history, and task-specific content | New business authority or state inferred from presentation |
| Command surface | What authorized business command can I perform? | Context-bound actions and their feedback | Navigation or frontend authorization authority |

In the current implementation the RITSEI wordmark sits at the top of the global navigation column,
which lies on the canvas. The workspace is a rounded sheet inset 8px from the canvas on desktop and
the whole screen on a phone. Local navigation renders as a breadcrumb-style strip (`Area / Section`)
at the start of the sheet's 48px topbar, followed by the operating context (tenant) and global
utilities (theme, sign out).

The topbar search and command entry MAY share a visual field, but search, destinations, objects, and
mutating commands MUST remain semantically distinguishable. The global entry SHOULD support direct
paths to known objects, destinations, and commands for experienced users; a keyboard shortcut such as
`⌘K` MAY supplement it. A global command entry is a discovery path, not an authorization bypass; each mutation
still invokes the owning typed command.

#### Five Navigation Laws

1. **Global structure stays stable.** Global business landmarks MUST keep a stable relative order
   across routes and MUST indicate the current location. Exact domain taxonomy is a product decision.
2. **One semantic level, one visual representation.** The same navigation meaning MUST NOT be
   repeated across global navigation, local navigation, breadcrumbs, tabs, headers, and toolbars
   without a distinct user need. Breadcrumbs MAY show real object hierarchy or traversal that is
   otherwise unavailable; they MUST NOT be added by convention alone.
3. **Navigation locates; commands change.** Navigation answers “Where can I go?” Commands answer
   “What can I change?” They MUST remain distinct, and commands MUST use the owning authorized
   boundary.
4. **Preserve context until context becomes a burden.** Browsing, comparison, and investigation
   SHOULD retain useful surrounding context. Deep editing, creation, and focused spatial work SHOULD
   receive the space they need.
5. **Workspace outranks navigation chrome.** When work and navigation compete for space, the
   workspace MUST remain dominant; collapse or omit navigation layers that do not serve the current
   task.

#### Global and local navigation

Global navigation MUST represent broad business landmarks rather than individual database entities.
It MAY include `My Work`, broad domains such as Sales, Procurement, Inventory, Manufacturing, and
Finance, Processes, Analytics, Master Data, and Settings. Its order MUST remain spatially stable;
current-location indication MUST be visually and programmatically exposed (for example, with
`aria-current="page"`), and keyboard access and accessible names MUST remain available. Active navigation MUST NOT visually compete with a blocked
transaction, critical exception, or the object being edited.

Global navigation MUST be collapsible. The expanded state supports discovery and learning; the
collapsed state supports workspace-heavy work. The collapsed icon rail MUST NOT be the only canonical
or discoverable state. In collapsed mode, every destination MUST retain an accessible name; a tooltip
MAY supplement, but MUST NOT replace, that name.

The global navigation is one continuous column on the `canvas` token; the edge of the workspace
sheet separates the two, so the column has no border of its own on desktop. The current destination
uses the `contentActive` fill, medium weight, a filled icon, and `aria-current="page"`. It MUST NOT
use the accent, a saturated fill, a large colored tile, or a glow as its active treatment.

Local navigation MAY be a contextual side navigator, compact tabs/sections, or omitted when the
workspace needs no second navigation level. It MUST collapse or disappear when its width burdens the
work. It MUST NOT repeat global navigation or expose record mutations.

#### Context, commands, and workspace priority

The context header MUST sit below the global topbar and make the current object or operational
situation recognizable. It SHOULD expose its identifier, lifecycle/operational state, and impact. It
MAY host a primary command and compact secondary-command entry; if so, the same primary action MUST
NOT be repeated with equal prominence in a second toolbar or command region.

The workspace is the dominant visual surface. Its hierarchy SHOULD follow:

```text
workspace and operational state
> object/situation context
> local navigation
> global navigation
> global utilities
> decoration
```

The topbar MUST remain thin and utility-oriented. It MUST NOT repeat broad domain navigation or carry
object-level commands such as approve, post, release, confirm, or cancel. Quick-create MAY appear only
when it is a justified global operation; object-specific actions MUST remain with their object or
situation context.

The global topbar target is approximately `48px`; the context header `56–72px`; compact local tabs or
secondary navigation approximately `40px`; expanded global navigation `220–240px`; and collapsed
global navigation `56–64px`. These are system targets, not feature-level constants. The local
navigator MAY use a side-column when its hierarchy warrants it.

The shell MUST protect content width for dense tables, financial reports, ledgers, planning surfaces,
and Process Studio. RITSEI MUST prefer one meaningful semantic layer over stacked sidebars, oversized
headers, arbitrary breadcrumbs, tabs, toolbars, filters, and nested cards. Decoration MUST NOT
compete with navigation labels, current location, and operational state.

### Cards

Cards are reserved for groups that materially improve comprehension, such as the workspace launcher
on My work. A card that is a link lifts its border and shadow on hover and answers a press. Card-inside-card, every-metric-as-card, and decorative cards SHOULD NOT be used.

### Charts

See Section 13. Labels, tooltips, units, currency, freshness, and accessible alternatives remain
explicit.

### Empty and loading states

Empty states explain what is empty and the next available action, optionally with a dashed-border
container. Loading states are quiet, respect reduced motion, and keep a semantic loading label.

## 17. Interaction, drag, and accessibility rules

Drag and drop is an interaction enhancement, not a business semantic. It MAY use the Solid dnd-kit
adapter behind a RITSEI interaction adapter.

```text
dnd-kit state
      ↓
RITSEI interaction vocabulary
      ↓
validated application intent
      ↓
Process IR or owning public command
```

Pointer drag, keyboard movement, and structured-form editing MUST produce equivalent semantic
operations where editing is required. Focus restoration, announcements, collision behavior,
undo/redo, and cancellation are part of the contract. DOM coordinates MUST NOT become Process IR,
authorization, or persistence state.

Kobalte is the single headless accessibility source behind RITSEI-owned components. Feature code MUST
NOT import Kobalte, dnd-kit, Panda-generated artifacts, or renderer libraries directly.

The pinned Kobalte Solid 2 alpha is permitted under an explicit `approved_with_risk` evidence record.
The alpha is accepted only while the compatibility/build checks and the browser behavior test
pass (its peer range names the pinned Solid release candidate exactly, so there is no peer
mismatch); a failed compatibility or behavior check remains blocked. Production
approval is per exercised primitive, not global: each activated primitive requires a RITSEI wrapper,
an application usage path, and a browser interaction/accessibility test. Unused or untested Kobalte
primitives are not approved. Native semantic HTML remains the fallback and rollback path.

Visualization layers MUST NOT carry information by themselves. Canvas and WebGPU are never substitutes for
semantic DOM, accessible labels, keyboard access, or text/table alternatives.

Analytical visualizations SHOULD use a hybrid composition: a visual canvas or SVG scene, a DOM
summary, and an accessible data or table view. Pointer picking MAY update a Solid selection, but the
explanation, tooltip, popover, or dialog remains DOM-owned and uses the RITSEI/Kobalte interaction
boundary. Decorative canvas output SHOULD be marked `aria-hidden="true"`.

All interactive controls MUST provide:

- visible keyboard focus;
- a logical tab order;
- an accessible name and role;
- an error or status announcement when needed;
- a target size appropriate to the interaction context; and
- behavior that remains understandable at 200% zoom and with long localized content.

## 18. Motion system

Motion explains change; it does not make a static screen look premium. Before anything animates,
answer in order: should it move at all, why, on which curve, and how fast.

**Frequency decides.**

| How often a user sees it | Rule | Here |
|---|---|---|
| Hundreds of times a day | No animation | Table row hover, keyboard commands, collapsing the navigation, switching theme |
| Tens of times a day | A color change only, 160ms or less | Navigation hover (80ms), control hover (160ms) |
| Occasionally | Standard motion | Dialogs, menus, the phone drawer, tabs |
| Rarely | May carry more | None yet; onboarding and empty-state illustration would qualify |

Route changes and lists do not animate or stagger: they are seen all day, where motion reads as
delay.

**Curves.** No curve eases in: it holds back the first frame, which is the one the user watches.

| Token | Curve | Use |
|---|---|---|
| `out` | `cubic-bezier(0.23, 1, 0.32, 1)` | Anything entering, leaving, or answering a press |
| `inOut` | `cubic-bezier(0.77, 0, 0.175, 1)` | Something that moves or resizes while staying on screen |
| `drawer` | `cubic-bezier(0.32, 0.72, 0, 1)` | The navigation drawer |
| `standard` | `cubic-bezier(0.25, 0.1, 0.25, 1)` | Hover and color changes |

**Durations.** 0, 80, 120, 160 (press), 180, 240, and 320ms; nothing in the interface runs longer
than 320ms. Spatial distances stay 2, 4, 8, and 16px.

| Element | Motion |
|---|---|
| Button, card link | Scale to 0.97 (0.985 for a card) while pressed, 160ms `out` |
| Dialog | Fade and scale from 0.96, 180ms `out`, from its own center |
| Menu | Fade and scale from 0.96, 180ms `out`, from the control that opened it |
| Scrim | Fade in, 180ms `out` |
| Navigation drawer (phone) | Slide by its own width, 240ms `drawer` |
| Tabs chip | Slide and resize, 180ms `inOut` |
| Loading spinner | One turn in 600ms, linear |

**Rules.**

- Nothing enters from `scale(0)`; an entrance starts at 0.96 with opacity.
- A popover's transform origin is its trigger. A dialog is anchored to nothing and keeps its center.
- Overlays leave at once. The pinned Kobalte alpha unmounts a closed overlay immediately, so no exit
  animation is specified; leaving faster than arriving is the intended asymmetry.
- Only `transform` and `opacity` animate. Transitions name their properties; `transition: all` is
  not used. The tabs chip is the one exception: Kobalte sets its width together with its transform,
  and it is a single small layer.
- Hover styles apply only under `(hover: hover) and (pointer: fine)`, so a touch screen never leaves
  one stuck after a tap.
- Under `prefers-reduced-motion`, movement and scale are removed and fades stay; the spinner is
  hidden because the label already says "Loading".
- Motion is causal and state-driven. It MUST NOT decide whether a command, transaction,
  authorization decision, or workflow step succeeds.
- Scenes default to static or event-driven rendering; there is no permanent animation loop for
  static content.

`tests/frontend/motion.test.ts` fails if a curve eases in or a duration passes 320ms. See
[ADR-0078](../decisions/0078-adopt-ritsei-motion-system.md) for ownership and
[ADR-0112](../decisions/0112-soften-operational-clarity-and-adopt-tactile-motion.md) for these rules.

## 19. HTML, CSS, SVG, Canvas, and WebGPU

HTML owns interaction and semantics. Standard forms, tables, and record views are 100% semantic
HTML/CSS. SVG and Canvas are used for charts and relationship views; the optional `vgpu` WebGPU
adapter selected by [ADR-0070](../decisions/archive/0070-select-vgpu-and-defer-typegpu.md) is reserved for
measured high-volume visualization and stays behind the RITSEI renderer adapter.

The fallback hierarchy is mandatory: `WebGPU → Canvas/SVG → CSS → static semantic UI`. No critical
action, value, status, or relationship may exist only in pixels. WebGPU MUST NOT own semantics,
fetching, authorization, business aggregation, workflow state, or authoritative facts, and feature
code MUST NOT import `vgpu` or raw WebGPU objects.

## 20. Shadow and overlay constraints

Four shadows exist, each a small step: `control` (1px, 5%) for buttons and fields, `raised` for
surfaces and the workspace sheet, `floating` for menus, and `overlay` for dialogs and the mobile
drawer. In dark mode a hairline of light does most of the separation and shadows are deeper but
rarer. Blur, translucency, glass, and colored glows are not used.

## 21. Token and styling contract

The token hierarchy is `primitive → semantic → recipe/component → state`. Panda CSS is the styling
substrate with `strictTokens` enabled. The constrained authoring surface is:

```text
semantic tokens       canvas, content*, text, muted, boundary*, action*, accent*, link, focus*,
                      status.*, icon.*
recipes               control (kind: secondary | action | ghost | danger | input; size: md | sm)
                      surface (tone: default | subtle | flush)
layouts               ui/foundations/layout.ts named classes
text styles           Section 10
formatting            ui/foundations/format.ts
css()                 inside apps/web/src/ui only, as a reviewed escape hatch
```

Panda's stock preset is used without its color palette, blurs, aspect ratios, stock shadows, stock
keyframes, and the font, type, radius, duration, and easing scales that RITSEI defines itself; its
spacing and size scales keep only the steps in reach. Every token ships as a CSS variable whether
used or not, so this keeps the shipped stylesheet inside the 50 KB budget enforced by
`apps/web/src/ui/accessibility.test.ts`.

A DOM island that cannot use the recipes (the process designer) reads the semantic token variables
(`var(--colors-content)`, `var(--radii-control)`) instead of raw values, so it follows the theme.

Feature code MUST NOT use raw colors, primitive palette tokens, arbitrary spacing, broad styled JSX
props, unapproved recipes, or vendor-specific primitive styling. Panda only extracts styles from
`apps/web/src/ui/**`; feature files compose named layouts, recipes, and primitives. Theme, density,
high-contrast, and reduced-motion variants are expressed through semantic tokens and recipe
variants, not ad hoc feature overrides.

## 22. Frontend location and dependency boundaries

The initial implementation remains inside the single frontend application. `apps/web/src/ui/` is a
dedicated, RITSEI-owned internal library, not part of an individual feature. A library boundary does
not require a separately published package. Do not create a separate `packages/design-system`
package until measured cross-application reuse or an independent build, release, enforcement, or
compatible-consumer need justifies it.

This applies the ownership decisions in ADR-0056 and ADR-0057 without changing their engines or
activation gates. The backend taxonomy in
[`ADR-0068`](../decisions/0068-establish-foundation-modules-platform-runtime-taxonomy.md) remains
unchanged: business modules live in `erp/modules/`, not in new `packages/accounting`,
`packages/procurement`, or `packages/inventory` directories.

```text
apps/web/src/
├── ui/
│   ├── foundations/
│   ├── primitives/
│   ├── internal/               # implementation helpers, not feature contracts
│   ├── recipes/
│   ├── patterns/
│   ├── grammar/
│   ├── interaction/
│   └── renderers/
│       ├── cartography/
│       └── cartography-gpu/
├── features/
│   └── <domain>/
│       ├── projections/
│       ├── queries/
│       ├── forms/
│       └── ui/
└── app/
    ├── shell/
    ├── router/
    └── providers/
```

This is a target organization, not a requirement to scaffold every directory or component before a
consumer needs it.

### Component placement and promotion

Visual reuse alone does not make a component part of the shared UI library. Classify it by the
knowledge and behavior it owns:

| Responsibility | Location | Examples and limits |
|---|---|---|
| Design foundations | `ui/foundations/`, with styling in `ui/recipes/` | Token definitions, typography, spacing, density, and approved icon assets; not business lifecycle enums |
| Generic controls | `ui/primitives/` | `Button`, `Input`, `Dialog`, `Select`, `Tabs`, `Badge`, `FormField`; no domain lookup or command |
| Reusable compositions and Product Patterns | `ui/patterns/` | `DataTable`, bounded `RitseiVirtualList`, `FilterBar`, `EntityWorkspace`, generic approval composition; caller-supplied data, labels, slots, and intents |
| Domain presentation | `features/<domain>/{ui,forms,tables,projections}/` | `JournalEntryTable`, `InvoicePaymentStatus`, `SupplierPicker`, `PurchaseOrderApprovalDialog`; compose shared UI rather than copy its behavior or styling |
| Application composition | `app/shell/`, routes, and providers | Concrete navigation, tenant/workspace composition, and runtime wiring; generic navigation controls can remain in shared UI |

The token → primitive → composite → domain component → application sequence describes composition,
not five mandatory packages or a replacement for the semantic layers in Section 4. Product Patterns,
Interaction Grammar, and Visual Grammar still govern how components are composed.

“Domain-agnostic” means independent of a particular domain's facts, policy, and workflows; it does
not mean devoid of business vocabulary. ADR-0057's `MoneyField`, `QuantityField`, and `PartyField`
remain valid shared semantic controls when their value/formatting contracts and caller-supplied
options are reusable. A `PartyField` does not silently become a `SupplierPicker` that fetches
Procurement data or decides supplier eligibility. Likewise, a generic `Badge` renders a supplied
label and semantic state; the feature owns the mapping from an invoice's public status to that
presentation, without inventing new business truth.

Use these promotion rules:

- Reuse an existing shared control or Product Pattern before adding another one.
- Keep a new domain composition with its owning feature even if several screens use it. Another
  feature may consume an intentional public presentation export from that owner, not its private
  files; dependencies MUST remain acyclic. Cross-feature use does not make it generic UI.
- Promote a new generic composition only for demonstrated common behavior or an approved core
  Product Pattern, with the contracts and evidence in Section 23. Similar markup alone is not
  evidence; avoid a universal component with branches for each domain.
- Keep non-visual transport, routing, and application helpers in their existing frontend owners
  under `shared/`, not in UI or a catch-all `frontend-utils` library.

Feature UI imports RITSEI UI contracts through stable public leaf modules such as
`ui/foundations/*`, `ui/primitives/*`, `ui/recipes/*`, `ui/patterns/*`, `ui/grammar/*`,
`ui/interaction/*`, `ui/renderers/cartography/*`, `ui/icons/*`, and `ui/motion/*`; it must not
import private adapters or generated Panda artifacts. Named subsystem
entrypoints such as `ui/icons/index.ts` and `ui/motion/index.ts` are allowed only when they expose
that subsystem's semantic API; they are not substitutes for the root facade. The UI boundary has no
catch-all root barrel. `apps/web/src/ui/styles.ts` is the sole stylesheet bootstrap and is
imported once by `src/main.tsx` and the Storybook preview, never as a side effect of importing a
component or recipe. Only the internal UI layer imports Kobalte, Panda-generated artifacts, dnd-kit,
chart adapters, Canvas, or WebGPU renderers. Shared UI MUST NOT import features, routes, application
composition, domain API clients, or domain-specific DTOs. It may consume frontend-safe shared value
contracts, but MUST NOT own fetching, query-cache policy, or business command execution. Those
responsibilities remain at the frontend application/feature boundaries defined in
[`frontend.md`](./frontend.md). Backend implementations, Drizzle tables, repositories, and private
services remain forbidden frontend dependencies.

### Cross-application extraction gate

An additional screen, feature consumer, or component playground is not evidence of a second
application. Before extracting a shared frontend package, record:

- actual consuming applications and which stable contracts they share;
- a named owner, public exports, compatibility expectations, and consumer migration plan;
- Solid/compiler and Panda source-generation boundaries that work for every consumer; and
- import-boundary, build, interaction, accessibility, and visual-regression checks for the shared
  library and its consumers.

Extract only the proven shared surface. Tokens and icons MAY remain part of that library; separate
`tokens`, `icons`, or `<domain>-ui` packages require their own consumer and ownership justification.
Domain presentation remains domain-owned even when extracted and MUST NOT be bundled into generic UI
or a backend module's browser-unsafe entry point. Package paths and names such as `@ritsei/ui` are
not activated by this document. An extraction proposal must reconcile ADR-0056's application-local
Panda output and ADR-0049's compiler boundary through the existing ADR workflow before changing
those decisions; it must not silently move generated artifacts or introduce independent release
infrastructure.

The current Process Studio model and prototype files are exploratory application material. They do
not activate the production design-system contract and MUST NOT be treated as evidence that Panda,
Kobalte, or WebGPU is already available.

## 23. Activation, validation, and governance

A Product Pattern, shared component, Visual Grammar primitive, or renderer adapter is not complete
until it has:

- a named semantic problem;
- a `USE WHEN` and `DO NOT USE FOR` contract;
- machine-typed props, variants, slots, and events;
- keyboard and screen-reader behavior;
- empty, loading, error, and degraded behavior;
- density, responsive, zoom, and localization review;
- contrast and high-contrast evidence;
- reduced-motion behavior; and
- a component or interaction test when behavior is non-trivial.

There is no visual regression baseline. A shared visual rule that can be stated as a rule has a test
that states it (the motion rules in Section 18, contrast through the axe scans, the stylesheet
budget); a change to a token or recipe value is reviewed as its diff. See
[ADR-0113](../decisions/0113-retire-frontend-compatibility-probes-and-visual-contract-test.md).

Frontend activation gates include:

- Vite and SolidJS 2 compatibility;
- Kobalte focus, keyboard, and screen-reader behavior;
- constrained Panda token, recipe, slot, density, theme, reduced-motion, and high-contrast
  enforcement;
- dnd-kit pointer/keyboard parity where used;
- deterministic renderer output and accessible fallbacks;
- the same renderer adapter contract in browser, headless Node, and deterministic mock paths;
- `vgpu/node` headless validation and `vgpu/mock` CI coverage when the adapter is activated;
- bundle, route, frame-time, memory, and interaction performance measurements;
- no permanent GPU animation for static scenes;
- power behavior during long-lived enterprise sessions; and
- no forbidden vendor imports outside the internal UI layer.

WebGPU activation additionally requires:

- a semantic HTML fallback that remains fully usable;
- device capability detection and runtime failure recovery;
- visibility-based rendering and static-frame caching;
- bounded frame rate and reduced-quality mode;
- measured benefit over SVG, Canvas, or CSS for the target workload; and
- evidence that the scene does not expose business or authorization semantics only through pixels.

Agents and feature teams MUST compose existing Product Patterns, use semantic variants, preserve
backend authority, and propose a new pattern when repeated decisions cannot be expressed. They MUST
NOT create industry-specific dashboard families, use color alone for state, or bypass the renderer
boundary because a local visual effect is convenient.

### Design artifacts and implementation authority

The design system is the governed language and its contracts, not a Figma file, component package,
or component catalog alone:

| Artifact | Role |
|---|---|
| This specification | Canonical semantic, interaction, visual, and usage rules |
| Figma or another design tool, when used | Design exploration, specifications, and review; not executable implementation authority |
| Version-controlled token and recipe sources | Machine-readable implementation of approved design decisions; generated Panda/CSS output is derived, not a separately edited source |
| RITSEI-owned UI source and tests | Executable component contracts and behavior |
| Component documentation/playground, when introduced | Demonstrates the actual shared implementation and its states; not an alternative implementation or a second specification |

Design-system owners review shared token, recipe, and component changes; feature owners retain
responsibility for domain presentation and semantic mappings. A mismatch between design artifacts,
this specification, and code MUST be resolved with the relevant owner, not silently accepted as a
new rule. Update usage guidance and regression evidence with the implementation; document breaking
contract changes and their consumer migration.

Storybook is a development-only documentation and review tool, not a prerequisite for reuse.
The current setup under `apps/web/.storybook/` is intentionally small: it verifies the repository's
SolidJS 2, Vite, and styling integration with production UI recipes and controlled fixtures. It must
not use real tenant data or credentials, fork token sources, or become a second component
implementation. Its presence does not replace accessibility, interaction, visual-regression, or
representative workflow evidence.

## 24. Non-goals

This design system does not:

- define backend business semantics or authorization;
- define Process IR or Process Studio runtime semantics;
- select a chart, graph, map, or canvas engine for every visualization;
- adopt TypeGPU or require WebGPU, SSR, SolidStart, or a metadata-driven UI framework;
- add frontend dependencies before an implementation spike and activation gate;
- replace frontend state ownership in ADR-0048; or
- create domain-specific palettes, materials, or decorative backgrounds.

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
