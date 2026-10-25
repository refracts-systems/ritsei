# ADR-0110: Issue Invoices as Immutable Numbered Artifacts and Send Them Through Communication

- Status: Proposed
- Date: 2026-10-25
- Amends: None
- Compatible with: ADR-0082, ADR-0091, ADR-0102
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Document rendering: [`../architecture/document-rendering.md`](../architecture/document-rendering.md)
> - Communication: [`../architecture/communication.md`](../architecture/communication.md)
> - Follow-ups: [`../proposals/erp-chains-next-steps.md`](../proposals/erp-chains-next-steps.md) (F2)

## Context

A billing document prints from the browser today (a print sheet, saved as a PDF by the user's
browser). That is not an artifact RITSEI can stand behind: it is rendered on the user's machine from
live data, it has no stored copy, and it cannot be sent. Customers expect the invoice they were sent
to be the invoice on file, and an auditor expects the same bytes years later.

## Decision

1. **An issued document gets one immutable artifact.** Billing documents are already immutable once
   posted. Issuing captures a document snapshot (the existing `DocumentSnapshot`, with its checksum),
   renders it, and stores the artifact with the snapshot id, checksum, template version, renderer
   version, and the document's own number. A correction is a new document (a credit note), never a
   new rendering of the old one.
2. **Rendering is a job, behind the foundation port.** Billing enqueues a render job when it posts;
   a worker renders through `framework/foundation/document-rendering` with a native transactional
   renderer, so a slow render never holds the posting transaction. The artifact exists when the job
   completes; the document shows "preparing" until then.
3. **The renderer dependency is chosen, measured, and added in its own change.** The architecture
   gates renderer dependencies on a benchmark corpus; this ADR does not pick a library. Until then,
   the browser print sheet stays.
4. **Reading an artifact needs the document's read capability.** `GET` an artifact by document id
   returns the stored bytes with the checksum in a header; there is no regenerate-on-read.
5. **Email goes through Communication.** Posting an invoice records an `invoice.issued` fact through
   the outbox. A communication policy turns it into a `CommunicationIntent` for the customer's
   billing contact, attaches the artifact, and sends through the transport port with the idempotency
   key `artifact id + recipient`. Delivery attempts, retries, and failures are recorded by the
   Communication Platform; Billing never knows the provider. A tenant chooses automatic sending or
   a manual "send" action.
6. **The provider is an operator integration.** SMTP or a transactional email API is an adapter in
   `framework/modules/integrations`, configured per deployment, with credentials outside the
   repository.

## Consequences

- Invoices need a worker and a stored-artifact table before this works end to end; nothing here is
  active until the renderer and the provider are decided.
- A tenant that edits its template changes future artifacts only; the version stored with each
  artifact says which template produced it.
- Resending sends the stored artifact, not a new rendering.

## Alternatives Considered

- **Render on every download:** rejected; the bytes change with the template and the data.
- **Render inside the posting transaction:** rejected; renderer time and failures would block money
  movements.
- **Let Billing call an email provider:** rejected by ADR-0082.
