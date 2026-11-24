# Phase 5 Decision Sheet: Class E Outcomes

> **Status:** Being decided one rule at a time; the decision record shows what is decided
>
> **Owner document:** [`phase-5-class-e.md`](./phase-5-class-e.md) holds the designs, stories, and
> findings. This sheet only lists what the owner must decide per rule and what each choice costs.

## How to decide

Each rule has two outcomes. **Keep** means it stays on its PostgreSQL transaction: nothing changes,
and the staged model stays as evidence. **Stage** means the rule moves to Alchemy with the price
listed, after the named people accept it in writing and the cutover gates (`alchemy.host-role`,
`alchemy.rebuild`) are met; the move itself is a later change, not this decision.

The default in [`AGENTS.md`](../../../AGENTS.md) is that PostgreSQL does everything until a named
user's measured need says otherwise. No such need is recorded for any class E rule, so the
recommendation column is **Keep** unless the owner names a need. This is a recommendation from the
stories' findings, not a decision.

Record a decision as a row in the phase 5 review record and a line in the rule's `RULES.md`, one
change per rule.

## The nine rules

| Rule | What staging changes (observed in the stories) | Who must accept if staged | Recommendation |
| --- | --- | --- | --- |
| `BIL-INV-1` invoice bills delivered, not invoiced | A just-recorded delivery is not invoiceable until the tracker catches up (too early, never too late); the journal posts a moment after the invoice | Business owner (lag) | Keep. Cheapest to stage: the lag errs safe |
| `BIL-BILL-1` supplier bill vs received, returned, billed | Same lag, plus a **return not yet tracked lets a bill take goods about to be returned**; the bill stays recorded and a credit note contradicts it | Business owner, accounting owner | Keep. The lag errs unsafe |
| `SAL-CREDIT-1`, `SAL-CREDIT-2` credit limit | Reserve, claim key, confirm saga; a refused claim leaves a reservation and its release; **a receivable that arrives late with no order behind it lets an order past the limit** | Accounting owner in writing | Keep. Needs the written lag acceptance first |
| `BIL-DOC-1` numbered, taxed, posted document | Document records first and is briefly unnumbered and unposted; the gapless series is kept by allocating only after tax | Accounting owner, fiscal reviewer | Keep. A legal document in a pending state is the hardest to accept |
| `SAL-DLV-2` delivery issues stock | A failed delivery id is spent (caller needs a new id); variant B turns every refusal into a stock issue and return | Business owner, accounting owner (reversal trail) | Keep; if staged, variant A (refusals before stock moves) |
| `PRC-RET-1` return issues stock | A return exists for a moment and is cancelled if stock was consumed; a cancelled return id is spent | Purchasing owner, accounting owner | Keep |
| `INV-XFER-1` transfer deducts then adds | A refused line leaves a deduction and its restoration; the transfer shows as confirming meanwhile; a retry is its own run | Warehouse owner | Keep |
| `SET-BANK-3` bank match capacity | Holds on line and payment, and a match saga; another match can be refused for capacity that returns a moment later; the failed match id is spent | Treasury owner | Keep |

## Questions that stay open whichever way a rule goes

1. `SAL-DLV-2`: step order (variant A or B), and whether Billing invoices only completed
   deliveries. Needed only if `SAL-DLV-2`, `BIL-INV-1`, or `BIL-DOC-1` is staged.
2. `BIL-DOC-1`: whether a legal document may be recorded briefly unnumbered and unposted, and the
   gap policy of the `DO/` and `GR/` series (ADR-0095 makes every series gapless; the models keep it).
3. Lag budget for trackers and exposure, including the return-lag window in `BIL-BILL-1`.
4. The workflow-engine ADR (conflict with `durable-execution.md`), before any saga on the cluster
   host, and whether the ledger stays table-backed.

## Decision record

| Rule | Decision (Keep or Stage) | Decided by | Date | Condition |
| --- | --- | --- | --- | --- |
| `BIL-INV-1` | Keep | Owner | 2026-11-24 | A named measured need reopens it |
| `BIL-BILL-1` | Keep | Owner | 2026-11-24 | A named measured need reopens it |
| `SAL-CREDIT-1`, `SAL-CREDIT-2` | Keep | Owner | 2026-11-24 | A named measured need reopens it |
| `BIL-DOC-1` | Keep | Owner | 2026-11-24 | A named measured need reopens it |
| `SAL-DLV-2` | Keep | Owner | 2026-11-24 | A named measured need reopens it |
| `PRC-RET-1` | Keep | Owner | 2026-11-24 | A named measured need reopens it |
| `INV-XFER-1` |  |  |  |  |
| `SET-BANK-3` |  |  |  |  |
