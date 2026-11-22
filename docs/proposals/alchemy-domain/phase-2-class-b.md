# Phase 2: Class B, Rules That Commit an Event with Its State

> **Status:** Awaiting review (revised 2026-11-22 after a review; phase 1 exit accepted)
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
- **Modelled in memory:** all three, already, by phase 1: `SalesOrder` and `PurchaseOrder` call the
  shared `decideConfirmation`, and `StockItem` calls the shared `decideCorrection`. Phase 1 stories
  tag the confirmation cases `SAL-ORDER-1` and `PRC-PO-1`, and no story names `SAL-ORDER-2`,
  `PRC-PO-3`, or `INV-STOCK-3`.

## Deliverables

What is new here, on top of phase 1:

1. Stories that name `[SAL-ORDER-2]`, `[PRC-PO-3]`, and `[INV-STOCK-3]` over the aggregates phase 1
   built: the same key twice records one event; a different key conflicts; a failed commit records
   nothing. The inventory aggregate already refuses a reused key with different content
   (`CorrectionKeyReused`); phase 1 left it untagged.
2. A written retry contract per rule. Alchemy returns the stored receipt for a repeated command id
   even after later commands. `SAL-ORDER-2` and `PRC-PO-3` both return the recorded result only
   while the order is still confirmed: a retry after cancellation fails with `InvalidState`
   (`cancelled`) for any key, in the Sales and Procurement deciders and in the differential test of
   PRC-PO-3. The phase states whether that contract can be kept on Alchemy (see the open question)
   and adds the sentence to `PRC-PO-3` in `RULES.md`, which is silent today.
3. The event shapes. `SalesOrderConfirmedEvent` must carry the order total (`SAL-CREDIT-1`), and
   the phase 0 policy applies (optional fields only). The deliverable is a map from each RITSEI
   event to the Alchemy event that would replace it, and which readers depend on each while the
   outbox is still in production.
4. The tenant-wide key claim is **described, not built**. `SAL-ORDER-2` and `INV-STOCK-3` reject a key
   used on another order or for other stock anywhere in the tenant; Alchemy stores a receipt per
   command id within one aggregate instance. A claim kept outside the order needs atomicity
   across two aggregates (claim the key, then confirm), with a failure window between them. That
   is a saga, which belongs to the later phases. This phase records the gap and the options (a
   claim aggregate with compensation, or keeping the unique constraint while the aggregate stays
   on tables) and builds neither.

## Exit evidence

Stories for the three rules pass in memory and name their IDs; the retry contract of each rule is
written; the event map exists. The owner accepts the contracts. Nothing moves, so no contract enters
`RULES.md` as authoritative until its aggregate moves, except the `PRC-PO-3` sentence, which
describes today's behavior.

## Stop conditions

- A retry contract cannot be stated without breaking an existing client.
- The retry contract of today cannot be expressed on Alchemy (an order cannot refuse a replayed
  command id once it is cancelled, even through a check in the service before sending). Record it as
  a blocker for moving `SalesOrder` and `PurchaseOrder` in the roadmap and report it; do not change
  the contract to fit the engine.
- The key claim needs atomicity across two aggregates for any story: stop and move that story to a
  saga phase.

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
  would return the original confirmation. `PRC-PO-3` behaves the same way after cancellation: the decider fails for any key on a cancelled
  order. Only the same-key and different-key cases while confirmed match Alchemy. Deliverable 2 settles
  the cancelled case for both rules.
- **Warehouse operations.** `INV-STOCK-3` protects stock counts: a retried correction must apply
  once. Until stock items move, nothing changes on the floor.

## Open questions

- Should a retry after cancellation return the original confirmation (Alchemy's receipt) or fail
  (today), for both `SAL-ORDER-2` and `PRC-PO-3`?

  **Recommendation from the review:** keep today's contract (fail). It is documented and deliberate
  in `SAL-ORDER-2`, and a client that lost the first response reads the order. Changing it to fit the
  engine would change client semantics silently. The phase must show whether Alchemy can express it;
  if not, that is a blocker for moving these aggregates and is recorded before phase 5, not found
  there.

## Review record

| Date | Reviewer | Outcome | Notes |
| --- | --- | --- | --- |
| 2026-11-22 | Review before owner acceptance | Revised | Corrected the PRC-PO-3 claim and wrote its after-cancellation sentence in `RULES.md`; narrowed deliverable 4 to a description because it needs atomicity across two aggregates; stated what phase 1 already covers; added the event map; named the acceptor |
| | Owner | | Pending |
