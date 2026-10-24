# ADR-0107: Read Document Chains Through a Documents Module

- Status: Proposed
- Date: 2026-10-24
- Amends: None
- Compatible with: ADR-0091, ADR-0094, ADR-0101, ADR-0102, ADR-0104
- Supersedes: None
- Superseded by: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Document Flow pattern and flow K3: [`../proposals/ux-acceptance.md`](../proposals/ux-acceptance.md)

## Context

A user who opens an invoice cannot see the order it came from, the deliveries behind it, the credit
notes against it, or the payments that settled it. The links exist, but each module stores only its
own side: an invoice keeps its source type and id, a credit note the invoice it credits, a payment
allocation the invoice it settles, an order the quotation it was created from. No module may read
another module's tables, so the chain needs a reader that joins public contracts.

## Decision

1. **A `documents` ERP module owns the chain query**, `DocumentsService.chain`. It has no schema, no
   tables, and no writes. It depends on `sales`, `procurement`, `billing`, and `settlement` and calls
   their public services only.
2. **A chain starts from a quotation, a sales order, a billing document, or a purchase order.** The
   service traces the entry document back to the first document it can find, then lists everything
   downstream of it: quotation, order, deliveries, invoices, credit notes, and payments for
   receivables; purchase order, receipts, bills, credit notes, and payments for payables. Nodes carry
   type, id, number, state, amount, and date, in document order, with the requested document marked.
3. **Authorization stays with the owners.** The module declares no capability. Each read runs through
   the owning service with the caller's principal, so a caller who may not read a kind of document
   gets that owner's authorization failure instead of a partial chain.
4. **Owners add the narrow reads the chain needs**, each with its own authorization: a billing
   listing filtered by source document or credited invoice, a settlement payment listing filtered by
   settled document, a sales order listing filtered by quotation, and a sales delivery listing for an
   order.
5. **Purchase returns are not in the chain yet.** Procurement has no read for them; they join when it
   exposes one.

## Consequences

- One request answers "what came before and after this document" without the browser calling five
  modules and joining the results.
- The query reads several tables through public services, so cost grows with the number of documents
  in one chain, which is small. Owner reads that are bounded today (billing lists at most 500
  documents) bound the chain too.
- A caller with a narrow set of read capabilities cannot see a chain that crosses modules they cannot
  read. Showing a partial chain with a notice is a later choice if users need it.
- The credit-limit work (F4) can reuse the same shape: a coordinating read port that composes owner
  contracts.

## Alternatives Considered

- **A shared document-link table** written by every module: rejected; it duplicates facts each owner
  already stores and adds a dual write.
- **The browser joins owner endpoints:** rejected; it spreads the tracing rules into the UI and
  multiplies requests.
- **Put the query in `process`:** rejected; the process module coordinates commands, and billing and
  settlement are not its dependencies.
