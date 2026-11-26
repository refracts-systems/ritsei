# Helpdesk Rules

> **Status:** Current rules owned by the Helpdesk extension (ADR-0123). This file wins over ADR text
> for what the extension does now; the ADRs named under each rule record why.
>
> **Does not own:** The working calendar (`situations`), the ticket number series (Numbering), or
> approvals (Approvals).

Each rule has an identifier that the test enforcing it names as `[ID]`; `tests/architecture/modules.test.ts`
fails when a rule has no such test or a test names an unknown rule.

Why: [ADR-0132](../../docs/decisions/0132-adopt-a-helpdesk-extension-for-work-without-a-document.md),
[ADR-0136](../../docs/decisions/0136-adopt-per-extension-migration-chains.md).

### `HD-AUTH-1` Helpdesk capabilities are denied by default

Creating needs `helpdesk.ticket.create`, assigning `helpdesk.ticket.assign`, resolving
`helpdesk.ticket.resolve`, reading every ticket or the queue `helpdesk.ticket.read`, and creating,
linking, or resolving an incident `helpdesk.incident.coordinate`.

### `HD-NUM-1` A ticket is numbered per legal entity and due in working days

A ticket takes the next gapless `HD/<fiscal year>/<value>` number of its legal entity. Its due instant
is the creation instant plus 1, 2, 5, or 10 working days for critical, high, normal, or low priority,
on the legal entity's working calendar. A ticket past its due instant and not resolved is `breached`
in the queue, which orders open tickets by due instant.

### `HD-VIS-1` A person reads their own tickets

A requester and an assignee read their own tickets without `helpdesk.ticket.read`; another person's
ticket reads as `TicketNotFound`, never as denied, so its existence is not disclosed.

### `HD-STA-1` Status moves forward by commands

A ticket is `open`, `in_progress`, `waiting`, `resolved`, or `closed`. A resolved ticket can reopen,
which clears its resolution; a closed ticket cannot move (`TicketInvalidState`).

### `HD-SUB-1` A ticket never stands for a document

A ticket whose subject type starts with `approvals.` is refused (`TicketSubjectRefused`), and the
database check `tickets_subject_not_approval_check` refuses it when written directly.

### `HD-INC-1` An incident groups tickets and resolves the open ones once

A ticket belongs to at most one incident (`TicketAlreadyInIncident`). Resolving an incident resolves
exactly its still-open tickets, each keeping its own note; resolving it again, or an unknown incident,
fails (`IncidentInvalidState`, `IncidentNotFound`). Closing a ticket never closes its incident.

### `HD-MIG-1` The extension owns its migration chain

The extension's tables exist only after its own chain runs; the core chain leaves no `helpdesk`
objects, and the chain is recorded in `system.extension_migrations_helpdesk`, once per migration.
