---
name: delete-comment
description: "Use to audit and clean up code comments in a file, directory, or module: classify each comment (tautology, stale, excuse, local rationale, decision record, required annotation), propose the smallest safe change, check ADRs and RULES.md first, and report before and after. Triggers: /delete-comment, audit comments, clean up comments, hapus komentar, komentar basi."
---

# Purpose

Keep comments that tell a reader something the code cannot, and fix the rest. A comment that
restates the code, has drifted from it, or stores a rule that another document owns costs the next
reader and misleads the next agent. The skill proposes changes; it never deletes on its own.

# Do Not Use When

- The task is to explain code or write new documentation: write the document its owner names in
  [`docs/documentation-boundaries.md`](../../../docs/documentation-boundaries.md).
- The target is generated (`*.gen.ts`, `apps/web/src/ui/generated`), vendored (`vendor/`), or a
  third-party file.
- The request is to shorten comments for fewer lines or tokens. Count is not a goal; a clearer owner
  for each fact is.

# Input

One of: a file, a directory, or a module name (`erp/modules/<module>` or `framework/modules/<module>`).
For a module, audit `src/` and leave `tests/` for a second pass unless asked.

# Workflow

1. **List the comments.** Search the target for `//`, `/*`, and `/**` comment lines with
   line numbers. Count them: this is the *before* number.
2. **Read the owners first.** Before judging any comment that states a rule, read the module's
   `RULES.md` (if present) and the ADR it links (ADR-0123: the owner document states the current
   rule, the ADR records why). Search ADRs with
   `rg -g '!docs/decisions/archive/**' <pattern> docs/decisions`.
3. **Classify each comment** by reading it against the code it sits on:

   | Category | Meaning | Default action |
   |---|---|---|
   | Tautology | Restates the name, type, or next line | Delete |
   | Stale | Contradicts or omits what the code now does | Correct, or delete if nothing is left |
   | Excuse | Apology or deferral: TODO, FIXME, HACK, workaround, "for now", "legacy" | Fix the cause now, or tag and track it |
   | Local rationale | Why this line is written this way: units, sign, lock order, an invariant | Keep |
   | Decision record | A current rule, or the history of a choice, kept in a comment | Move to the owner (`RULES.md`, the subsystem doc, or an ADR) and leave at most a pointer to its ID |
   | Required annotation | A suppression or directive a tool needs (`oxlint-disable`, `@ts-expect-error`, `fallow-ignore`, `[RULE-ID]` test tags) | Keep; confirm it still suppresses something |

   When two categories fit, take the one with the smaller change. When unsure, classify as Local
   rationale and keep it.
4. **Propose, do not apply.** Present a table: `file:line`, category, the comment, the proposed
   change, and the evidence (the code it contradicts, or the rule ID that owns the fact). Apply
   changes only after the user accepts them, and only the accepted ones. Never delete a comment
   because it is long, old, or unfamiliar.
5. **Move before you delete.** For a Decision record, put any fact that only the comment held into
   its owner first (for example a sentence in `RULES.md`), then replace the comment with a pointer.
   For an Excuse, name what would have to be true for it to go, and either do that or leave an
   issue-ready note: title, file and line, the risk, and the acceptance condition. Create the issue
   only when the user asks.
6. **Validate.** `pnpm run fmt:check`, `pnpm run lint`, and the module's tests. If `RULES.md`
   changed, run `pnpm exec vitest run tests/architecture`. A comment-only change must leave
   code diff lines at zero; check `git diff` for any non-comment line.
7. **Report before and after.** State the comment count before and after, how many fell in each
   category, what was changed, what was kept and why, and which Excuse items remain and where they
   are tracked. Do not describe a lower count as an improvement by itself.

# Rules

- `untagged-todo` (`tooling/ast-grep/rules/untagged-todo.yml`) already rejects a TODO, FIXME, HACK, or
  XXX without a tag. A tagged one such as `TODO(financial-prod)` is allowed but is still an Excuse:
  confirm it is tracked.
- Never change code in the same commit as a comment cleanup. A code defect found on the way goes in
  the report with file, line, and how it fails.
- Never edit an accepted ADR to tidy a comment. ADRs are an append-only log.
- Comments that state authorization, tenant scope, financial rounding, or idempotency are Local
  rationale or Decision record until proven stale against the code and its test.

# Stop and report when

- A comment states a rule that the code and `RULES.md` disagree about: that is a defect to report,
  not a comment to fix.
- A comment's removal would need an unresolved owner decision.
- The change would touch `*.gen.ts` or the ADR index.

# Related

- [`docs/documentation-boundaries.md`](../../../docs/documentation-boundaries.md)
- [`docs/decisions/0123-separate-the-decision-log-from-current-rules.md`](../../../docs/decisions/0123-separate-the-decision-log-from-current-rules.md)
