# ADR-0135: Scope Manufacturing and Projects and Set Their Release Order

- Status: Proposed
- Date: 2026-11-25
- Amends: None
- Compatible with: ADR-0091, ADR-0095, ADR-0100, ADR-0128, ADR-0131
- Supersedes: None
- Superseded by: None
- Changes: None

> **Related documents**
>
> - ADR index: [`./README.md`](./README.md)
> - Moving-average valuation: [`./0100-adopt-moving-average-inventory-valuation.md`](./0100-adopt-moving-average-inventory-valuation.md)
> - Lots and serials: [`./0131-adopt-lot-and-serial-tracking.md`](./0131-adopt-lot-and-serial-tracking.md)
> - Parity plan, decision D12: [`../proposals/erp-module-parity-plan.md`](../proposals/erp-module-parity-plan.md)

## Context

The mockup shows manufacturing (a bill of materials and work orders) and projects (projects and
timesheets). D12 says the first operational module is built only when a pilot asks for it. This
decision states what each would contain and in which order they would be released, so a pilot's
request can be answered, and **it authorizes no implementation**.

What exists to build on: Inventory with valued receipts and issues at moving average, now with lots
and serials; Sales with service products and the order-to-cash chain; Approvals with steps and
delegation; numbering per legal entity; Party and Billing. What does not exist: a work-in-process
account, any labor or overhead costing, any person-hours record, and any project or work-center
master.

## Decision

1. **Manufacturing scope (first version).** A **bill of materials** per finished product: versions,
   a validity period, and components with quantities and a scrap percentage. A **work order** per
   finished product: planned, released, completed, or cancelled, with a quantity. **Completion** is one
   step: it issues the components through Inventory (valued, by identity for tracked components) and
   receives the finished goods at the cost of the components consumed, in one transaction, so there
   is no work-in-process account and no half-finished state. The finished product's lot or serials
   are named at completion. Not included: routings, work centers, labor and overhead cost, co-products,
   by-products, subcontracting, and planning (MRP).
2. **Projects scope (first version).** A **project** has a code, a customer, a status, and an optional
   budget in hours or amount. **Timesheet entries** record a person, a project, a date, hours, and a
   note, are submitted for approval (an Approvals subject with its own policy), and become billable
   once approved. **Billing** is by time and material through the existing chain: approved hours at a
   rate become the lines of a Sales order of service products, which is invoiced as any order. Not
   included: costs of people (payroll), expenses, milestones, resource planning, and revenue
   recognition over time.
3. **Both are ERP modules** (`erp/modules/manufacturing`, `erp/modules/projects`), because they post
   through or order through flagship owners and are part of the product, not third-party additions.
4. **Release order.** (1) **Projects and timesheets**: no ledger posting of its own and it reuses
   Sales and Approvals. (2) **Bill of materials** as a master with no movement. (3) **Work orders with
   completion**, which needs the posting design of decision 1. (4) Later, separate decisions: work in
   process, routings and labor cost, project cost and revenue over time.
5. **Trigger.** Each release starts only when a pilot asks for it (D12), with its own accepted ADR
   for anything that adds a posting role or changes an existing module's contract.

## Alternatives Considered

- **Manufacturing first.** It is the larger and the more common ask, but its costing choices (work in
  process, labor) are open and would be decided too early.
- **One module for both.** Rejected: they share nothing but a customer.
- **Projects as a Helpdesk extension.** Rejected: tickets are work without a document; projects bill.
- **A work-in-process account from the start.** Rejected for the first version: it adds a state and a
  posting role for a need no pilot has shown.

## Consequences

### Positive

- A pilot's request maps to a defined first version and a known next step.
- Neither first version adds a posting role or changes an existing module's contract beyond an
  extension of the line inputs already built for identity.

### Negative

- Completion in one step cannot represent a job that takes days and consumes materials progressively.
- Time-and-material only: fixed-price projects wait.

### Risks

- A pilot needs work in process early. Mitigation: it is the first decision after release 3, and the
  single-step completion does not block it.

## Open questions for the owner

1. **Order.** Projects first (proposed), or manufacturing first?
2. **Trigger.** Is there a pilot asking now, or does this wait for D12?
3. **Completion in one step** without work in process, labor, or overhead: acceptable for a first
   version (proposed)?
4. **Billing from timesheets** by creating a Sales order of service lines (proposed), or a direct
   Billing document?
5. **Rates.** A rate per project and role, per person, or per product? One per project (proposed).
6. **Who approves timesheets**: the project manager (a capability), or the person's supervisor?

## Validation

(To be fixed when a release is accepted; this ADR authorizes no code.)

- Each release has an accepted ADR where it adds a posting role or changes a contract, and its own
  tests for every rule it adds.
