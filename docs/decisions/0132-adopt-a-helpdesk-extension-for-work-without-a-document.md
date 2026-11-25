# ADR-0132: Adopt a Helpdesk Extension for Work Without a Document

- Status: Proposed
- Date: 2026-11-25
- Amends: None
- Compatible with: ADR-0004, ADR-0006, ADR-0091, ADR-0094, ADR-0095, ADR-0129
- Supersedes: None
- Superseded by: None
- Changes: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Framework, ERP, and extensions: [`./0091-adopt-framework-and-flagship-erp.md`](./0091-adopt-framework-and-flagship-erp.md)
> - Module manifest: [`./0094-adopt-module-manifest-registry-and-generator.md`](./0094-adopt-module-manifest-registry-and-generator.md)
> - Numbering: [`./0095-adopt-gapless-document-numbering.md`](./0095-number-documents-per-legal-entity-and-fiscal-year.md)
> - Situations and the working calendar: [`./0129-adopt-situations-escalation-and-follow.md`](./0129-adopt-situations-escalation-and-follow.md)
> - Extensions: [`../../extensions/README.md`](../../extensions/README.md)

## Context

Work that has no document (a question from a colleague, a broken scanner, a data fix) has no place in
the system. Documents have their own owners and queues: an approval is decided in Approvals and must
never become a ticket. There is no ticket module, `extensions/` is empty by design until the first
extension exists, and the working-day calendar and its due-time arithmetic live in `situations`
(ADR-0129), which said the calendar would move out only when a second consumer arrives.

## Decision

1. **Helpdesk is the first extension**, in `extensions/helpdesk`, with the module shape of an ERP
   module and only public entry points of `framework/` and `erp/` as imports (ADR-0091). It owns its
   tables in a `helpdesk` schema.
2. **A ticket** has a number `HD/<fiscal year>/<value>` from the gapless series of its legal entity
   (ADR-0095, issued on creation), a title, a description, a category, a priority, a requester, an
   optional assignee, a status (`open`, `in_progress`, `waiting`, `resolved`, `closed`), a due instant,
   and a resolution time. Status moves forward by commands; `resolved` can reopen, `closed` cannot.
3. **The SLA is a due instant in working days by priority**, computed at creation from the legal
   entity's working calendar, which Helpdesk reads through `situations`' public contract (no copy of
   the calendar, no extraction yet). The queue is every open ticket ordered by due instant, oldest due
   first, with a breached flag; "remaining SLA" is the due instant against the database clock.
4. **An incident groups many tickets.** An incident has a title, a status, and a set of linked
   tickets; a ticket belongs to at most one incident. Resolving the incident resolves its still-open
   tickets in one command, each keeping its own resolution note. Closing a ticket never closes the
   incident.
5. **A ticket never stands for a document.** It carries no reference to an approval request, and a
   check refuses a subject whose type starts with `approvals.`. Document workflows keep their own
   owners; a ticket may name a document in its text only.
6. **Capabilities, deny by default:** `helpdesk.ticket.create`, `.read` (all tickets), `.assign`,
   `.resolve`, and `helpdesk.incident.manage`. A requester always reads their own tickets without
   `.read`, and an assignee reads theirs.
7. **First extension prerequisites** are part of this decision: the composition root and
   `modules.gen.ts` discover modules under `extensions/`, `db/ownership.toml` and the migration
   tooling accept an extension's schema, and the boundary lint zone for `extensions/` gets its first
   files.

## Alternatives Considered

- **Tickets inside `situations`.** Rejected: situations are projections of other modules' facts with
  detectors; a ticket is a record people create.
- **Approvals as tickets.** Rejected by the owner and by ADR-0128: they have their own owner, steps,
  and separation of duties.
- **Extract the working calendar now.** Rejected: `situations`' public contract already serves a
  second reader; extraction waits for a reason to move ownership.
- **SLA in hours.** Not in the first version: the calendar counts days.

## Consequences

### Positive

- A place for work without a document, with a numbered record, an owner, and a due date.
- The first extension proves the extension path before partners use it.

### Negative

- Real work outside Helpdesk: extension discovery, ownership, and migration tooling.
- Ticket SLA breaches are not situations: `situations` (ERP) cannot depend on an extension.

### Risks

- Tickets become a place to approve things. Mitigation: decision 5 and a test.

## Open questions for the owner

1. **Extension infrastructure.** Build it inside this change (proposed), or as its own earlier change?
2. **SLA unit.** Working days by priority for now (proposed); which days per priority?
3. **Calendar.** Read through `situations`' contract (proposed), or extract it into its own module now?
4. **Incident resolve.** Resolving the incident resolves its open tickets (proposed), or each ticket by hand?
5. **Visibility.** Requester and assignee see their own; `helpdesk.ticket.read` sees all (proposed). Confirm.
6. **Breach.** Show breached tickets in the queue only (proposed), or also notify the assignee's supervisor?

## Validation

- A ticket is numbered gaplessly per legal entity and year, and its due instant skips non-working days.
- The queue is ordered by due instant and flags the breached.
- An approval reference is refused; a requester cannot read another's ticket without the capability.
- Resolving an incident resolves exactly its open tickets, once.
- The module's imports are public entry points only (boundary lint).
