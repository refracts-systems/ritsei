# Phase 2: Class B, Rules That Commit an Event with Its State

> **Status:** Waits for phase 1 exit
>
> **Roadmap gate:** `alchemy.class-b`
>
> **Related documents**
>
> - Phase index: [`./README.md`](./README.md)
> - Roadmap track: [`../../roadmap/alchemy-domain.md`](../../roadmap/alchemy-domain.md#class-b-alchemyclass-b)
> - Rule classification: [ADR-0124](../../decisions/0124-adopt-alchemy-domain-in-phases.md#rule-by-rule-classification)

## Scope

The 3 class B rules: `SAL-ORDER-2`, `PRC-PO-3`, `INV-STOCK-3`. Each exists to commit an event
together with the state change, which RITSEI does with an outbox append in the same transaction and
Alchemy does by construction.

## Aggregates

- **May move:** none. The sales order, purchase order, and stock item each carry class E rules
  (`SAL-DLV-2`, `PRC-RET-1`, `INV-XFER-1`).
- **Modelled in memory:** all three, with `decide` built on
  `erp/modules/sales/src/order-lifecycle.ts` for sales orders.

## Deliverables

1. `decide` and `evolve` for confirmation (sales and purchase orders) and stock corrections.
2. Stories for each rule: the same key twice records one event; a different key conflicts; a
   failed commit records nothing.
3. A written retry contract per rule. Alchemy returns the stored receipt for a repeated command id
   even after later commands; `SAL-ORDER-2` returns the recorded result only while the order is
   still confirmed, and a retry after cancellation fails. The phase picks one per rule and records
   it in `RULES.md` when the aggregate moves.
4. A mapping from RITSEI's idempotency keys to Alchemy command ids that keeps existing keys valid,
   with a tenant-wide key claim so a key reused on another order (`SAL-ORDER-2`) or for different
   stock (`INV-STOCK-3`) still conflicts.

## Exit evidence

Stories for the three rules pass in memory; each rule's retry contract is written and accepted.

## Stop conditions

- A retry contract cannot be stated without breaking an existing client.

## Five views

- **Auditor.** `SAL-ORDER-2` and `PRC-PO-3` promise one confirmation event per confirmed order, and
  `INV-STOCK-3` publishes a stock correction and its event together. Today a failed append rolls
  the change back; on Alchemy an event cannot exist without its state change, which is the same
  guarantee with less plumbing. Nothing moves yet, so the production record is unchanged.
- **Accountant.** Confirmations do not post, but `SAL-CREDIT-1` counts confirmed orders not yet
  invoiced in a customer's exposure, so the `SalesOrderConfirmedEvent` must carry the total, as it
  does, and phase 5 may add the credit decision's inputs. `PRC-PO-3` confirms the order that later
  receipts value against GRNI (`PRC-VRCPT-1`). The event shapes are reviewed here.
- **Systems engineering.** Idempotency scope differs. `SAL-ORDER-2` rejects a key that another order
  in the tenant already used, and `INV-STOCK-3` rejects a key reused for different stock: both are
  tenant-wide today. Alchemy stores a receipt per command id within one aggregate instance, so a key
  reused on another order or stock item would not conflict; deliverable 4 needs a tenant-wide key
  claim to keep both rules. The outbox stays in production until these aggregates move in phase 5.
- **ERP engine development.** `SAL-ORDER-2` returns the recorded result only while the order is
  still confirmed: a retry after cancellation fails with `SalesOrderInvalidState`. Alchemy's receipt
  would return the original confirmation. `PRC-PO-3` returns the recorded result for the same key
  and fails for a different one, which Alchemy matches. Deliverable 3 settles the first case.
- **Warehouse operations.** `INV-STOCK-3` protects stock counts: a retried correction must apply
  once. Until stock items move, nothing changes on the floor.

## Open questions

- Should a retry after cancellation return the original confirmation (Alchemy's receipt) or fail
  (today)?

## Review record

| Date | Reviewer | Outcome | Notes |
| --- | --- | --- | --- |
| | | | |
