# Alchemy Domain Phase Reviews

> **Status:** Proposals awaiting review, one phase at a time
>
> **Owns:** each adoption phase's scope, the aggregates it may move, its open questions, and the
> five-view review the owner accepts before the phase starts.
>
> **Does not own:** sequencing and gates (the [`alchemy` roadmap track](../../roadmap/alchemy-domain.md)),
> the decision ([ADR-0124](../../decisions/0124-adopt-alchemy-domain-in-phases.md)), or current
> rules (each module's `RULES.md`).
>
> **Related documents**
>
> - Decision: [`../../decisions/0124-adopt-alchemy-domain-in-phases.md`](../../decisions/0124-adopt-alchemy-domain-in-phases.md)
> - Roadmap track: [`../../roadmap/alchemy-domain.md`](../../roadmap/alchemy-domain.md)

## Review order

| Phase | Document | Rules | Status |
| --- | --- | --- | --- |
| 0 | [Foundation](./phase-0-foundation.md) | none | Accepted with conditions (2026-11-22) |
| 1 | [Class A](./phase-1-class-a.md) | 34 | Exit accepted (2026-11-22) |
| 2 | [Class B](./phase-2-class-b.md) | 3 | Exit accepted (2026-11-22) |
| 3 | [Class C](./phase-3-class-c.md) | 9 | Awaiting review |
| 4 | [Class D](./phase-4-class-d.md) | 11 | Waits for phase 3 exit |
| 5 | [Class E](./phase-5-class-e.md) | 9 | Waits for phase 4 exit |

A document is reviewed only after the previous phase's exit evidence is accepted, because each phase
can change what the next one must answer. A reviewer records the outcome in the document's review
record; the status column above changes in the same commit.

## The five views

Every document answers from the same five views, so that a phase is judged by more than its code:

- **Auditor:** whether the records still show what happened economically, and can be traced.
- **Accountant:** period cut-off, matching, and reconciliation between subledgers and the ledger.
- **Systems engineering:** failure modes, consistency, operations, and the cost of the change.
- **ERP engine development:** how the change compares with how mature ERP engines behave, and what
  it does to the framework's shape for modules and extensions.
- **Warehouse operations:** what people handling stock see and can rely on.

A view with nothing at stake in a phase says so in one line. A view that objects turns its objection
into an exit criterion or a stop condition of the phase; it is not dropped.

## Shape of a phase document

Status, scope (rule IDs), aggregates that may move and those that stay, prerequisites, deliverables,
exit evidence (named by the roadmap gate), stop conditions, the five views, open questions, and a
review record.
