# Proposal: Day Close ("Tutup Hari")

> **Status:** Proposal, 2026-11-25, with the owner's decisions recorded below. Nothing is built. It defines what "close the day" means and what data it needs (gap G-16).
>
> **Owns:** The definition of a day close and the data it needs.
>
> **Does not own:** Accounting periods, cash and bank accounts, stock valuation, or counting; those
> stay with their modules ([`documentation-boundaries.md`](../documentation-boundaries.md)).

## What the mockup asks for

An end-of-day step where the person in charge confirms the day: the cash taken is deposited and
counted against what the system says, and stock for the day is cut off. The mockup does not say which
of the two it is, or both, so this proposal separates them.

## What exists today

- **Cash.** A payment records the cash account it went through (`settlement.payments.cash_account_id`)
  and the ledger has one `cash` posting role. There is no cash drawer or session, no count, no
  over-or-short account, and no notion of a deposit to the bank.
- **Stock.** Movements and valuation entries are dated by posting date; a stock count compares
  counted to on-hand and posts the difference. Nothing stops a movement dated yesterday from being
  posted today.
- **Periods.** Accounting periods open and close by month and refuse postings outside an open period.
  There is no day-level lock.

## Definition

A **day close** is a per-legal-entity, per-date checkpoint with up to two independent parts. A day is
open until each part that applies is closed; closing one part does not close the other.

1. **Cash close (setoran kas).** The person in charge counts the cash of a cash account for the day and
   enters the counted amount. The system compares it with the ledger movement of that cash account
   for the date. A difference is posted to a cash over-and-short account, and the counted amount is
   recorded as deposited to a named bank account (a transfer between two cash-type accounts). A cash
   close with a difference needs a reason, and above a configurable amount an approval.
2. **Stock cut-off.** For the date, the person in charge confirms that no further document will be
   posted with that posting date. After the cut-off, a stock movement or a delivery dated that day or
   earlier is refused until the cut-off is reopened. Counting is a separate act: a stock count may be
   part of the cut-off but is not required by it.

A closed part is reopened only by a named capability, with a reason, and the reopening is recorded;
anything posted to the closed part before it is reopened remains as it was.

## Data it needs

| Need | Today | To add |
| --- | --- | --- |
| Which accounts are cash drawers and which are bank | One `cash` role, a cash account id on each payment | A kind on a cash account (`cash_drawer`, `bank`), and a default bank account for deposit |
| The day's expected cash | Ledger lines per account and date | A read of the ledger movement of one account for one date |
| A count and its difference | Nothing | A day-close record with expected, counted, difference, reason |
| Over-and-short | Nothing | A posting role and its account per legal entity |
| The deposit | Nothing | A transfer journal from the drawer account to the bank account |
| A day-level lock | Monthly periods only | A cut-off table, and a check in each posting owner (Inventory, Sales delivery, Settlement) that refuses a closed date |
| Who closed and reopened | Nothing | Actor, time, reason on every close and reopen |
| An approval for a large difference | Approvals with steps | A policy for the day-close subject |

## Owner decisions (2026-11-25)

1. Both parts, as two independent parts.
2. The cashier counts; the supervisor approves a difference.
3. The cut-off is a hard refusal in every posting owner.
4. One cash drawer per legal entity for now.
5. Over-and-short is its own posting role in the chart.
6. A day is the calendar date in the legal entity's time zone (the one place that is not UTC, because
   a cashier closes the day by the local clock). Legal entities have no time zone today, so this
   needs one stored on the entity before it can be built.

## What this does not decide

How the screens look, how a point-of-sale feeds cash, or foreign-currency cash. Each needs its own
decision if it is wanted.
