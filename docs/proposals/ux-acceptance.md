# Proposal: UX Acceptance for Key Flows and a Document Flow Pattern

> **Status:** Proposal, not approved; compacted. A flow target needs one measured run before it gates
> anything. **Related:** [`../architecture/design-system.md`](../architecture/design-system.md) ·
> [`../architecture/frontend.md`](../architecture/frontend.md) · [`./erp-chains-next-steps.md`](./erp-chains-next-steps.md)

## Key flows and starting targets

Each flow runs as a scripted Playwright test on the happy path with master data present; targets are
kept, tightened, or relaxed after one measured run.

- **K1 Order-to-Cash** (quotation, order, delivery, invoice, receipt): each next document is one action
  from the previous, with fields carried and never retyped.
- **K2 Procure-to-Pay** (purchase order and approval, receipt, bill, payment): the same carry rule, and
  a three-way-match mismatch names the line and what differs.
- **K3** From any document, every other document in its chain is at most 2 actions away.
- **K4** A credit note or return starts from the original, shows the effect on stock, open amount, and
  ledger before commit, and links back.
- **K5** Closing a period lists its blocking items, each with a link.

Before a release that changes a flow, five people who do this work run it once without help, and the
time and first hesitation are written down.

## Proposed `DocumentFlow` pattern

A business object is one step in a chain of documents, and the user should see and follow the chain
without finding each document through a separate list. Each node shows type, number, state, amount where
it has one, and date; the current node is marked by more than color; the chain is a keyboard-reachable
list. It reads across modules through the `documents` module's `chain` port
([ADR-0107](../decisions/0107-read-document-chains-through-a-documents-module.md)). Not for process
definitions, generic audit history, or decoration.

The targets are unmeasured, and this checks that flows are short and carry data forward, not that they
beat SAP or Odoo.
