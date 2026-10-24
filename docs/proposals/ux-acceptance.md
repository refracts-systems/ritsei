# Proposal: UX Acceptance for Key Flows and a Document Flow Pattern

> **Status:** Proposal, not yet approved. Nothing here binds a screen until the owner accepts it; the
> Document Flow pattern also needs its place in the design system, and a key-flow target needs one
> measured run before it becomes a gate.
>
> **Owns:** The measurable UX targets for the main ERP flows, the gap list found when comparing the
> design system with what a document-heavy ERP needs, and the proposed `DocumentFlow` Product Pattern.
>
> **Does not own:** The shell, Product Patterns, Interaction Grammar, content rules, and accessibility
> rules, which belong to [`design-system.md`](../architecture/design-system.md); route, state, form,
> and error rules, which belong to [`frontend.md`](../architecture/frontend.md); or the delivery
> workflow an agent follows, which belongs to the
> [`ui-delivery-gate`](../../.agents/skills/ui-delivery-gate/SKILL.md) skill.
>
> **Related documents**
>
> - Design system: [`../architecture/design-system.md`](../architecture/design-system.md)
> - Frontend architecture: [`../architecture/frontend.md`](../architecture/frontend.md)
> - ERP follow-up work: [`./erp-chains-next-steps.md`](./erp-chains-next-steps.md)

## 1. Why this exists

The design system already states the goal: the data is the interface, and a screen should let the
user orient, locate, recognize, investigate, act, and observe ([Design System §2 and
§6](../architecture/design-system.md#2-design-thesis)). It already owns empty, loading, error,
keyboard, and accessibility rules, and it names SAP Fiori as a source it learns from without copying.

What it does not yet say is how anyone would know that a screen is _better to use_ than the same task
in SAP or Odoo. This proposal adds that: a short list of flows with numbers to meet, and one pattern
the existing list lacks.

## 2. What a document-heavy ERP needs that the pattern list lacks

| Gap                                                             | Today                                                                                                                                                                                                   | Proposed                                                     |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| See where a document came from and went                         | No pattern. The backend keeps some links (an invoice stores its source type and id, a credit note the invoice it credits, a payment allocation the invoice it settles), but nothing presents the chain. | `DocumentFlow`, section 4                                    |
| Create the next document from the previous one without retyping | Per screen, if at all.                                                                                                                                                                                  | A key-flow rule, section 3: carried fields are never retyped |
| Know that a screen works                                        | Section 23 covers a pattern; frontend.md "Frontend agent entry" covers a route. Nothing requires clicking every control before delivery.                                                                | The `ui-delivery-gate` skill                                 |
| Compare against SAP and Odoo                                    | Prose only.                                                                                                                                                                                             | The flows in section 3, measured                             |

## 3. Key flows and starting targets

Each flow is run by a scripted Playwright test on the happy path with master data already present.
**Actions** counts distinct user commits: a click, a selection, or a typed field followed by moving
on. The targets are starting points chosen for the first run; after one measured run on the real
screens, each is either kept, tightened, or relaxed with a note, and only then does it gate a
release.

| #   | Flow                                                                                 | Target                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| K1  | Quotation to confirmed sales order, delivery, invoice, and receipt (Order-to-Cash)   | Each next document is one action from the previous one; lines, prices, tax, and customer are carried, with **zero retyped fields**           |
| K2  | Purchase order with approval to receipt, supplier bill, and payment (Procure-to-Pay) | Same carry rule; a three-way-match mismatch names the line and the quantity or price that differs                                            |
| K3  | Open any document and see its upstream and downstream documents and their states     | At most **2 actions** from the document to any other document in its chain                                                                   |
| K4  | Correct a mistake: credit note or return                                             | The correction starts from the original document, shows the effect on stock, open amount, and ledger before it commits, and links back to it |
| K5  | Close a period and read the trial balance                                            | Blocking items are listed with a link to each; the user does not search for what is blocking                                                 |

For every flow the test also records the number of screens visited and fails if a step leaves the
user without a visible next action or result ([Design System
§6](../architecture/design-system.md#6-product-patterns): ORIENT through OBSERVE).

Two checks sit outside the script. Before a release that changes a flow, five people who do this work
run it once without help, and the time and the first point of hesitation are written down. This is a
measurement, not a survey.

## 4. Proposed `DocumentFlow` pattern

This section is the named semantic problem and usage contract that [Design System
§23](../architecture/design-system.md#23-activation-validation-and-governance) asks for. It is a
proposal until a design-system change adds it to §6.

- **Semantic problem.** A business object is one step in a chain of documents. The user needs to see
  the chain and move along it without finding each document through a separate list.
- **USE WHEN.** The object has upstream or downstream documents in another module: quotation, order,
  delivery, invoice, credit note, receipt, payment, purchase order, receipt, bill, ledger entry.
- **DO NOT USE FOR.** Process definitions (Process Studio owns those), generic audit history (an
  `OperationalWorkspace` evidence area owns that), or decoration. It is not a navigation model.
- **Content.** Each node shows the document type, its number, its lifecycle state, its amount where
  it has one, and its date. The current document is marked by more than color. Nodes link to the
  owning workspace.
- **Accessibility.** The chain is a real list in document order with one current item; keyboard focus
  moves node to node; the same facts are reachable without the diagram.
- **Data.** No module may read another module's tables, so the chain is a query that joins references
  across modules through public contracts: the `documents` module's `chain` read port, proposed in
  [ADR-0107](../decisions/0107-read-document-chains-through-a-documents-module.md). It reads the
  source references the owners already store, and the same shape serves the credit-limit work
  ([`erp-chains-next-steps.md`](./erp-chains-next-steps.md) F4). Purchase returns are part of the payable
  chain.

## 5. Risks and assumptions

- The targets in section 3 are unmeasured. A target that is wrong becomes a gate that blocks good
  work or a number nobody believes, which is why section 3 requires a measured run first.
- "Better than SAP and Odoo" is not tested by this document. It tests that the flows RITSEI built are
  short, carry data forward, and explain their failures. A comparison with a named reference would
  need the same flow run in that product, which is a separate piece of work.
- Five users per release is small. It finds the first hesitation, not a statistic.
