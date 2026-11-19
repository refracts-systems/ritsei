# ADR-0120: Retain Imported Documents and Record Historical Dispatch Outcomes

- Status: Proposed
- Date: 2026-11-19
- Amends: None
- Compatible with: ADR-0082, ADR-0091, ADR-0102, ADR-0110
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Document rendering: [`../architecture/document-rendering.md`](../architecture/document-rendering.md)
> - Communication: [`../architecture/communication.md`](../architecture/communication.md)
> - Migration-first comparison: [`../architecture/reference/migration-first-erp-comparison.md`](../architecture/reference/migration-first-erp-comparison.md)

## Context

ADR-0110 makes an issued invoice one immutable artifact that RITSEI renders from its own snapshot and
sends through Communication. A tenant that migrates in has invoices issued and emailed by the source
system. RITSEI cannot reproduce those documents, so it must not render them again, and a customer
must not receive them a second time because an import ran.

A rendered artifact binds a snapshot, a render fingerprint, a renderer version, and a fence
generation. Imported bytes have none of these, so they cannot be stored as a rendered artifact
without inventing the evidence.

## Decision

1. **Imported documents are retained, not rendered.** The owning domain (Billing, for invoices)
   owns an imported-artifact record: one per document, immutable, with the source system, source
   reference, SHA-256 of the bytes, and media type, read under the document's own read capability.
   Where the bytes are placed follows the artifact-bytes row of the rendering ownership table
   (storage adapter and deployment profile). It is a different record from a rendered artifact. The
   invoice's number and amounts remain the posted facts; the bytes are evidence.
2. **Communication records prior dispatch evidence as an outcome.** One historical communication
   with one attempt maps the evidence to `sent` (attempt and communication `accepted`), `failed`, or
   `unknown` (attempt `unknown`, communication `reconciling`). Ambiguous evidence is `unknown`. It is
   never recorded as `delivered`.
3. **Recording never sends.** It does not render, resolve recipients, or call the transport.
   `deliver` and `retry` reject a historical communication.
4. **Identity is `tenant + source system + source reference`.** A replay returns the stored record;
   a replay with different evidence fails.
5. **Unknown outcomes are reviewed, not resubmitted.** They stay `reconciling` until a person
   resolves them.

## Consequences

- `recordHistoricalDispatch` is authorized per tenant by the capability
  `communication.historical_dispatch.record` (deny by default); the input carries the caller's principal.
- Communication records the outcome and a reference to the bytes (artifact id and SHA-256) but does
  not verify that the bytes exist; the document owner's storage is the authority.
- The first change implements only the Communication side, which is memory-only today. Billing's
  imported-artifact record is not built: it needs a table, its invariants, and PostgreSQL
  integration tests. Until it exists, the reference in the communication record points at nothing.
- Resolving an `unknown` historical outcome has no command yet.
- Live transport failures still leave no recorded attempt; that is separate from this decision.

## Alternatives Considered

- **Store imported bytes as rendered artifacts:** rejected; it would fabricate a snapshot, render
  fingerprint, and fence generation the source never had.
- **Re-render imported invoices:** rejected; the output would differ from what the customer received.
- **Replay the source mail log through the live send path:** rejected; an import would email
  customers.
