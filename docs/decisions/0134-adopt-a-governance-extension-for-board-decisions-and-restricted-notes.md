# ADR-0134: Adopt a Governance Extension for Board Decisions and Restricted Notes

- Status: Accepted
- Date: 2026-11-25
- Amends: None
- Compatible with: ADR-0006, ADR-0037, ADR-0091, ADR-0103, ADR-0128
- Supersedes: None
- Superseded by: None
- Changes: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Audit and delivery boundary: [`./0037-define-p3-audit-event-and-delivery-boundary.md`](./0037-define-p3-audit-event-and-delivery-boundary.md)
> - Approvals: [`./0103-adopt-threshold-approvals-with-separation-of-duties.md`](./0103-adopt-threshold-approvals-with-separation-of-duties.md), [`./0128-adopt-tiered-approvals-and-delegation.md`](./0128-adopt-tiered-approvals-and-delegation.md)
> - Authorization: [`../architecture/authorization.md`](../architecture/authorization.md)

## Context

The directors need a record of the decisions they are asked to take (what is requested, why, what
follows if approved and if rejected), and a place for notes that only a named few may read, with a
trail of every read. Today there is no such record. Approvals decide document amounts and are not a
place for deliberation; the audit authority is each owner's own facts (ADR-0037), and nothing records
reads. Authorization is by tenant capability, so "visible to these five people" has no home.

## Decision

1. **Governance is an extension, `extensions/governance`**, with a `governance` schema, and no write
   path into other modules.
2. **A decision record** has a number, a title, what is requested, the reason, what follows if
   approved, what follows if rejected, a status (`requested`, `approved`, `rejected`, `withdrawn`),
   and, once decided, who decided and when. The text is fixed when the decision is requested; after a
   decision, the record is append-only, and a correction is a new record that names the one it
   supersedes. A decision record is not an approval: it does not release, post, or change another
   module's fact.
3. **A restricted note** has a body and an explicit access list of users; its author is always on it.
   The list is changed only by someone on it, and each change is recorded. A note may point at a
   subject (a document, a decision record, a party) by type and id.
4. **A person not on the list learns only that a note exists.** For a subject, `noteIndicator` returns
   whether any restricted note points at it and how many, to any caller who may read the subject's
   own module; it never returns a title, author, or access list. Reading the body needs being on the
   list; being the owner of the document does not help.
5. **Every read is recorded**, in the same transaction as the read: who, which note or decision,
   when, and the outcome (`read` or `denied`). The log is append-only, enforced by the database, and
   not readable through the note's own endpoints; a separate capability `governance.audit.read`
   reads it, and reading the log is itself recorded.
6. **Capabilities, deny by default:** `governance.decision.request`, `.decide`, `.read`;
   `governance.note.write`, `.read`; `governance.audit.read`. A capability alone never opens a note:
   the access list decides.

## Alternatives Considered

- **Use approvals for board decisions.** Rejected: an approval is bound to a subject and an amount
  and decided by capability holders; a board decision is a narrative with outcomes.
- **Row-level security as the access control.** Kept only as defense in depth; the list is a business
  rule with its own history.
- **Show the author or title to those not on the list.** Rejected: it discloses what the list hides.
- **Log reads in a central audit table.** Rejected by ADR-0037 as an authority; this log is
  Governance's own facts about its own reads.

## Consequences

### Positive

- A durable record of board decisions and a controlled place for sensitive notes, with proof of who
  read what.
- Document owners know a note exists without learning more.

### Negative

- A read writes a row, so notes cost a write per read.
- An access list is only as good as who maintains it; there is no break-glass in the first version.

### Risks

- A database administrator can read bodies. Mitigation: out of the application's reach by design;
  encryption of bodies is a later decision.
- An indicator reveals that a note exists, which may itself be sensitive. Mitigation: it is shown only
  to people who may read the subject, and the owner accepts that exposure in this decision.

## Owner decisions (2026-11-25)

The owner accepted the recommendations:

1. Requesting and deciding a record are capabilities granted to named directors.
2. One decider is enough; there is no quorum.
3. There is no break-glass read.
4. The note indicator is visible to anyone who may read the subject, and the exposure is accepted.
5. Notes and the read log are kept forever.
6. Encryption of note bodies is a later decision.

## Validation

- A note is readable only by those on its list; a denied read is logged, and the log cannot be edited
  or deleted.
- The owner of a document not on the list gets existence and a count and nothing else.
- Removing someone from the list stops their reads from the next read; the change is recorded.
- A decided record cannot change; a correction is a new record naming the old.
