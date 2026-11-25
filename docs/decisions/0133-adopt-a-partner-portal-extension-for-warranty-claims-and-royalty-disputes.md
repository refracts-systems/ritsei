# ADR-0133: Adopt a Partner Portal Extension for Warranty Claims and Royalty Disputes

- Status: Accepted
- Date: 2026-11-25
- Amends: None
- Compatible with: ADR-0006, ADR-0021, ADR-0029, ADR-0058, ADR-0091, ADR-0131, ADR-0132
- Supersedes: None
- Superseded by: None
- Changes: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - External identity: [`./0058-define-provider-neutral-identity-and-authentication-boundary.md`](./0058-define-provider-neutral-identity-and-authentication-boundary.md)
> - Scope and Party representation: [`./0021-define-p0-scope-and-identity-model.md`](./0021-define-p0-scope-and-identity-model.md)
> - Lots and serials: [`./0131-adopt-lot-and-serial-tracking.md`](./0131-adopt-lot-and-serial-tracking.md)
> - Helpdesk: [`./0132-adopt-a-helpdesk-extension-for-work-without-a-document.md`](./0132-adopt-a-helpdesk-extension-for-work-without-a-document.md)
> - Authorization: [`../architecture/authorization.md`](../architecture/authorization.md)

## Context

Partners outside the company need to file warranty claims and object to royalty invoices without
being given an ERP account. The identity boundary (ADR-0058) maps an external issuer and subject to an
internal user account; a user account can be tied to a Party by a representation (ADR-0021, ADR-0029),
which grants no authority by itself. The principal already records whether authentication is local or
external. Serial tracking (ADR-0131) and the serial trace in Documents exist; a ticket extension is
proposed (ADR-0132). Authorization is by tenant capability, with no object-level rule such as "only
this party's records".

## Decision

1. **The portal is an extension, `extensions/portal`**, with its own `/portal/*` HTTP group, tables
   in a `portal` schema, and no write path into another module's tables.
2. **A portal user is an external identity** (issuer and subject) mapped to a user account with a
   tenant membership that holds only portal capabilities, tied by a Party representation to the
   partner's Party (role `partner`). The partner Party is the only data scope the portal reads or
   writes: every portal query filters on the party of the caller's active representation, and a
   missing or inactive representation is a denial, not an empty list.
3. **Portal capabilities** are `portal.claim.submit`, `portal.claim.read`, `portal.invoice.read`, and
   `portal.invoice.dispute`. An external principal never holds an ERP capability, and a portal
   endpoint calls other modules only through a read contract made for it, never with the user's
   broader rights.
4. **A warranty claim** names a serial and a description. The portal validates the serial through the
   Documents serial trace: the serial must exist, be issued by a delivery, and have gone to a customer
   whose Party is the caller's partner Party. A serial that is unknown, not delivered, or delivered to
   someone else is refused with the same answer, so a partner learns nothing about other parties'
   units. An accepted claim is stored once per serial while open.
5. **A royalty dispute** names a royalty invoice of the partner's own Party (a Billing document whose
   party is the partner) and a reason. An invoice that is not the partner's is refused as not found.
6. **Both become internal tasks**: submitting a claim or dispute creates a helpdesk ticket (category
   `warranty_claim` or `royalty_dispute`) through Helpdesk's public contract, with the external user as
   requester; the portal stores its own record with the ticket id and shows the ticket's status back
   to the partner. The outcome is decided internally, in the ticket, not in the portal.
7. **Hardening is part of the decision**: portal endpoints are rate limited per identity, a claim or
   dispute is idempotent by a client-supplied key, and every submission is audited with the external
   issuer and subject.

## Alternatives Considered

- **A separate realm or tenant per partner.** Rejected: one tenant, one ledger; the scope is the Party.
- **Give partners read access to the ERP screens with a filter.** Rejected: filters are one bug from a
  leak; the portal reads through dedicated contracts.
- **Decide claims in the portal.** Rejected: the decision is internal work and belongs in a ticket.
- **Tell the partner why a serial was refused.** Rejected for the leak it creates.

## Consequences

### Positive

- Partners self-serve without any ERP right, and every submission becomes a visible internal task.
- The data scope is one rule, applied in one place.

### Negative

- Depends on the Helpdesk extension, the serial trace, and an external identity provider adapter that
  does not exist yet in this repository.
- A new object-level rule in Authorization terms ("the caller's party") that only the portal uses.

### Risks

- A bug in the party filter exposes another partner's data. Mitigation: one shared function builds
  the scope, every portal query needs it by construction, and tests assert isolation between two
  partners.

## Owner decisions (2026-11-25)

The owner accepted the recommendations:

1. A partner is a Party with the role `partner`, and a royalty invoice is a customer invoice to that partner.
2. The portal waits for an OIDC identity adapter, which does not exist yet.
3. Portal users must use MFA.
4. A delivered serial is enough for a claim; no warranty period yet.
5. The partner sees the ticket's status as it is.
6. Attachments are out of the first version.

The decision is accepted, and building waits for the identity adapter.

## Validation

- A partner reads and submits only for their own Party; a second partner's data is never returned,
  including through errors.
- A serial delivered to another customer, an unknown serial, and an undelivered serial give one
  indistinguishable refusal.
- A submission creates exactly one ticket and one portal record, even when repeated with the same key.
- An external principal holding no portal capability is denied everywhere; none holds an ERP one.
