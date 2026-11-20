# ADR-0123: Separate the Decision Log from Current Rules

- Status: Proposed
- Date: 2026-11-20
- Amends: None
- Compatible with: ADR-0015, ADR-0091, ADR-0093, ADR-0094
- Supersedes: None
- Superseded by: None
- Changes: `AGENTS.md`, `docs/documentation-boundaries.md`,
  `docs/development/documentation-workflow.md`, `docs/decisions/README.md`

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Documentation boundaries: [`../documentation-boundaries.md`](../documentation-boundaries.md)
> - Documentation workflow: [`../development/documentation-workflow.md`](../development/documentation-workflow.md)

## Context

An agent that needs a current rule reads ADRs, because `AGENTS.md` ranks accepted ADRs above every
other document. At this ADR, 100 ADRs are active; 35 amend another ADR and 11 are partly superseded.
To learn how opening stock is posted, an agent replays ADR-0100 point 4, ADR-0118, which amends it,
and ADR-0121, which amends ADR-0118 point 2. ADR-0118 and ADR-0121 were accepted on the same day.
Every ERP decision adds a link to such a chain, so the cost of finding a rule grows with the history
of decisions instead of with the size of the system, and a missed link reads as a current rule.

Three further costs compound it. Module business rules are written only as ADR prose, so nothing
ties them to the tests that enforce them. The ADR index is kept by hand and has needed corrections
(commit 34d5712). Inactive target designs (ADR-0093) sit beside the current architecture documents,
about 2,300 lines that an agent cannot tell apart from current rules without reading their headers.

Deleting ADRs would remove the reasons for each decision, and agents would reopen rejected options.

## Decision

1. **ADRs are an append-only decision log.** They keep context, alternatives, and consequences.
   They are not where an agent learns a current rule; an agent reads them to learn why a rule exists
   or before it reopens an option that was rejected.
2. **Every current rule has one owner document, and it wins.** The owner is the subsystem document
   named in `docs/documentation-boundaries.md`, or a module's `RULES.md` (point 4). When an owner
   document and an ADR disagree on a current rule, the owner document is authoritative and the
   disagreement is a defect to report. This order takes effect in `AGENTS.md` once the amendment
   chains are folded into owner documents; until then the existing order stands.
3. **An ADR names the owner documents it changes.** A new ADR carries a `Changes:` header listing
   the owner documents, and the same change updates them. An ADR without a current rule to change
   says `Changes: None`. Headers of earlier ADRs are not backfilled.
4. **A rule owned by one module lives with that module.** A rule whose invariant one module owns
   (ADR-0015), including one that calls another module's public contract, is written in
   `erp/modules/<module>/RULES.md`. Each rule has a stable identifier, and the test that enforces
   it names that identifier. A rule no test enforces is marked `unenforced`. A module with no such
   rule has no `RULES.md`. `docs/architecture/sales.md` and `docs/architecture/procurement.md` move
   into their modules' `RULES.md`. A decision that crosses module ownership, changes a source of
   truth, a trust boundary, the extension model, or a strategic dependency still needs an ADR.
5. **The ADR index is generated from ADR headers** by `pnpm run ritsei gen`, and the codegen test
   reports a stale index like any other generated file.
6. **Inactive target designs live in `docs/architecture/target/`.** Agents do not read or
   implement them without an activation ADR. Their content and ADR-0093's retention are unchanged.
7. **`AGENTS.md` keeps only what an agent would get wrong and no check or skill catches.** Rules
   that a skill already owns move to that skill; rules for one folder move to that folder's
   `AGENTS.md`.

## Alternatives Considered

- **Delete ADRs and treat code as the only source of truth:** rejected. Code shows what exists, not
  why, what was rejected, or which designs are deliberately inactive.
- **Keep ADRs as the primary source and add tooling to resolve amendment chains:** rejected. It
  keeps the cost proportional to history and adds a resolver for prose that has no fixed structure.
- **Retrieval over all documents (embeddings or a search index):** rejected. Retrieval returns
  candidates; it cannot tell a current rule from a superseded one any better than the reader.
- **Rewrite accepted ADRs into current state:** rejected. It destroys the record that ADRs exist to
  keep.

## Consequences

### Positive

- An agent reads one owner document for a current rule, however many ADRs led to it.
- A module rule is next to its code and names the test that enforces it.
- The ADR index cannot drift from ADR headers.

### Negative

- Every ADR change now also changes an owner document.
- Agents lose the always-loaded copy of rules that move into skills; a skill loads only when its
  description matches the task.

### Risks

- The rule-to-test link is a text match: it proves that a test names a rule, not that the test
  checks it. Review remains the check that the test is the right one.
- Folding amendment chains can misstate a rule. Where an ADR, an owner document, and the code
  disagree, the fold reports the disagreement instead of choosing.

## Validation

- No current rule requires reading more than one ADR to state it.
- `pnpm run ritsei gen --check` fails on an index that differs from the headers.
- Every rule identifier in a `RULES.md` is named by a test or marked `unenforced`.
- No inactive target design sits in `docs/architecture/` outside `target/`.

## Related Documents

- [`../documentation-boundaries.md`](../documentation-boundaries.md)
- [`../development/documentation-workflow.md`](../development/documentation-workflow.md)
- [ADR-0015](./0015-one-semantic-owner-per-invariant.md)
- [ADR-0093](./0093-retain-isolation-runtime-and-analytic-target-designs.md)
