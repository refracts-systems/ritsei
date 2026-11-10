---
name: ui-delivery-gate
description: "Use before delivering any RITSEI web screen, route, or UI component change in apps/web: a new or changed workspace, form, table, dialog, or navigation entry, including terse requests like add the invoice screen or tambahkan layar penerimaan barang."
---

# Purpose

Make sure a screen is finished, not only compiled: every control does something, every state is
shown, the keyboard works, and a test covers the flow. This skill adds the delivery check. The
rules themselves live in the design system and frontend documents; this skill never restates them.

# Use This Skill When

- adding or changing a route, workspace, form, table, dialog, or shell entry in `apps/web/`;
- wiring a screen to a new or changed HTTP endpoint;
- changing a shared UI component's behavior.

# Do Not Use This Skill When

- the change is backend-only, with no screen or generated contract change;
- the task is only a token or recipe value; no screen flow changes, so the token or recipe diff is
  the review.

# Required Context

Before writing the screen, read `apps/web/AGENTS.md` and the nearest existing workspace of the same
Product Pattern under `apps/web/src/features/` with its test in `tests/frontend/`. That neighbor is
the template. Open a document below only for what the neighbor does not show:

- no neighbor of that pattern exists:
  [Design System §6](../../../docs/architecture/design-system.md#6-product-patterns) (Product
  Patterns);
- the screen adds a failure or permission state: the Error Model and Authorization UX sections of
  [Frontend: Frontend agent entry](../../../docs/architecture/frontend.md#frontend-agent-entry);
- the screen adds wording, number or date formats, or keyboard behavior: Design System §15 and §17;
- the screen belongs to a key flow:
  [`docs/proposals/ux-acceptance.md`](../../../docs/proposals/ux-acceptance.md).

# Steps

1. **Name the screen.** State the owning domain, the user's job, the Product Pattern, and the
   primary authorized command and where its result appears. If no pattern fits, name the unmet
   problem and stop; do not invent a page-specific shell.
2. **Build from the nearest neighbor.** Reuse the shell, the module's `*.workspace.ts` sidecar, and
   existing components. Decode route and API input with Effect Schema. No backend imports.
3. **Show every state.** Empty (what is empty and the next action), loading, and one message per
   typed failure the endpoint can return, mapped from its tagged errors to a recovery action. Never
   one generic toast.
4. **Carry data forward.** When the screen creates a document from another, pass the source's
   fields through; the user does not retype them.
5. **Run it.** Start the app with the project's preview server, sign in locally, and use the screen
   with a mouse, then with the keyboard alone, then at 200% zoom. Click every control and follow
   every link. A control with no behavior and a link to a page that does not exist are defects:
   remove them or build them.
6. **Test it.** Add or extend `tests/frontend/<module>-workflow.test.ts` with the happy path, one
   typed failure, and an axe scan, using the helpers in `tests/frontend/browser.ts`.
7. **Check it.** Run `pnpm --filter @ritsei/web run check`, the new test, and
   `pnpm run check:affected`.

# Delivery Report

Finish with a short list, each line PASS or FAIL with one clause of evidence: pattern named; empty,
loading, and failure states present; no dead control or link; keyboard path works; 200% zoom
readable; flow test and axe scan pass; checks pass. A FAIL is fixed or reported as unfinished; the
screen is not described as done while one remains.

# Never

- Fabricate data, statistics, testimonials, or placeholder business facts to fill a screen.
- Add inert UI from a concept image; the design system forbids it.
- Treat a hidden or disabled control as authorization.
- Import Kobalte, dnd-kit, Panda-generated files, or backend internals into feature code.
