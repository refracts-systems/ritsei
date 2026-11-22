import { assert, describe, it } from "@effect/vitest"
import * as Schema from "effect/Schema"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import {
  AcceptOpening,
  CorrectStock,
  CorrectionKeyReused,
  CreateTransfer,
  FulfillReservation,
  InTransitNotCarried,
  InventoryClassA,
  IssueValue,
  ItemValuation,
  LotTrackingUnsupported,
  OpeningAccepted,
  OpeningLoad,
  ReceiveStock,
  ReceiveValue,
  ReleaseReservation,
  ReservationFulfilled,
  ReservationInvalidState,
  ReservationNotFound,
  ReservationReleased,
  ReservationsNotCarried,
  ReserveStock,
  RevaluationApprovalMismatch,
  StockCorrected,
  StockItem,
  StockReceived,
  StockReserved,
  StockTransfer,
  StockUnavailable,
  StockValuationUnavailable,
  TransferAcrossLegalEntities,
  TransferCreated,
  UnitOfMeasureMismatch,
  ValueIssued,
  ValueReceived,
  WarehouseLegalEntityMismatch,
} from "../src/domain-model.ts"
import { applyBalanceMovement, BalanceMovement, hasAvailableStock } from "../src/stock-rules.ts"
import { costIssue, LineValue, valueIssue } from "../src/valuation.ts"

const { Story } = Domain

const story = Story.make(InventoryClassA)

const item = StockItem.ref("w-1/A")
const valuation = ItemValuation.ref("le-1/A")
const transfer = StockTransfer.ref("t-1")
const opening = OpeningLoad.ref("o-1")

// Story.state compares a partial state through JSON, which cannot hold a bigint, so states are
// checked field by field.
const holds =
  (expected: { readonly onHand?: bigint; readonly reserved?: bigint }) =>
  (state: { readonly onHand: bigint; readonly reserved: bigint }) => {
    if (expected.onHand !== undefined) assert.strictEqual(state.onHand, expected.onHand, "onHand")

    if (expected.reserved !== undefined) {
      assert.strictEqual(state.reserved, expected.reserved, "reserved")
    }
  }

const holdsValuation =
  (expected: { readonly quantity: bigint; readonly value: bigint }) =>
  (state: { readonly quantity: bigint; readonly value: bigint }) =>
    assert.deepStrictEqual({ quantity: state.quantity, value: state.value }, expected)

const tenOnHand = new StockReceived({ quantity: 10n })
const entity = "le-1"
const otherEntity = "le-2"

const reserve = (reservationId: string, quantity: bigint) =>
  new ReserveStock({ reservationId, quantity, warehouseLegalEntityId: entity })

const reserveFor = (reservationId: string, quantity: bigint, legalEntityId: string) =>
  new ReserveStock({ reservationId, quantity, warehouseLegalEntityId: entity, legalEntityId })

const correct = (idempotencyKey: string, adjustment: bigint, overrides: { unit?: string } = {}) =>
  new CorrectStock({
    idempotencyKey,
    adjustment,
    unitOfMeasure: overrides.unit ?? "EA",
    reason: "count",
    itemUnitOfMeasure: "EA",
  })

const corrected = (idempotencyKey: string, adjustment: bigint) =>
  new StockCorrected({ idempotencyKey, adjustment, unitOfMeasure: "EA", reason: "count" })

describe("Inventory class A on Alchemy", () => {
  it("the model is well defined", () => assert.deepStrictEqual(Domain.verify(InventoryClassA), []))

  // [INV-STOCK-1]
  it.effect("a reservation within available stock is made and one above it changes nothing", () =>
    story(
      Story.given(item, tenOnHand),
      Story.when(item, reserve("r-1", 4n)),
      Story.then(item, new StockReserved({ reservationId: "r-1", quantity: 4n })),
      Story.when(item, reserve("r-2", 7n)),
      Story.rejected(new StockUnavailable({ available: 6n, requested: 7n })),
      Story.then(item),
      Story.state(item, holds({ onHand: 10n, reserved: 4n })),
      // Exactly the available quantity is still available.
      Story.when(item, reserve("r-3", 6n)),
      Story.then(item, new StockReserved({ reservationId: "r-3", quantity: 6n })),
      Story.when(item, reserve("r-4", 1n)),
      Story.rejected(new StockUnavailable({ available: 0n, requested: 1n })),
    ),
  )

  // [INV-STOCK-1]
  it.effect("stock with no balance has nothing to reserve", () =>
    story(
      Story.when(item, reserve("r-1", 1n)),
      Story.rejected(new StockUnavailable({ available: 0n, requested: 1n })),
      Story.then(item),
    ),
  )

  // [INV-STOCK-1]
  it.effect("repeating a reservation reserves nothing more", () =>
    story(
      Story.given(item, tenOnHand),
      Story.when(item, reserve("r-1", 4n)),
      Story.then(item, new StockReserved({ reservationId: "r-1", quantity: 4n })),
      Story.when(item, reserve("r-1", 4n)),
      Story.then(item),
      Story.state(item, holds({ reserved: 4n })),
    ),
  )

  // [INV-STOCK-1]
  it.effect("a reservation is released exactly once and its stock is available again", () =>
    story(
      Story.given(item, tenOnHand, new StockReserved({ reservationId: "r-1", quantity: 10n })),
      Story.when(item, reserve("r-2", 1n)),
      Story.rejected(new StockUnavailable({ available: 0n, requested: 1n })),
      Story.when(item, new ReleaseReservation({ reservationId: "r-1" })),
      Story.then(item, new ReservationReleased({ reservationId: "r-1", quantity: 10n })),
      Story.state(item, holds({ onHand: 10n, reserved: 0n })),
      Story.when(item, new ReleaseReservation({ reservationId: "r-1" })),
      Story.then(item),
      Story.when(item, new FulfillReservation({ reservationId: "r-1" })),
      Story.rejected(new ReservationInvalidState({ reservationId: "r-1", status: "released" })),
      Story.when(item, reserve("r-2", 1n)),
      Story.then(item, new StockReserved({ reservationId: "r-2", quantity: 1n })),
    ),
  )

  // [INV-STOCK-1]
  it.effect("a reservation is fulfilled exactly once and removes its stock", () =>
    story(
      Story.given(item, tenOnHand, new StockReserved({ reservationId: "r-1", quantity: 4n })),
      Story.when(item, new FulfillReservation({ reservationId: "r-1" })),
      Story.then(item, new ReservationFulfilled({ reservationId: "r-1", quantity: 4n })),
      Story.state(item, holds({ onHand: 6n, reserved: 0n })),
      Story.when(item, new FulfillReservation({ reservationId: "r-1" })),
      Story.then(item),
      Story.state(item, holds({ onHand: 6n, reserved: 0n })),
      Story.when(item, new ReleaseReservation({ reservationId: "r-1" })),
      Story.rejected(new ReservationInvalidState({ reservationId: "r-1", status: "fulfilled" })),
      Story.when(item, new ReleaseReservation({ reservationId: "r-9" })),
      Story.rejected(new ReservationNotFound({ reservationId: "r-9" })),
    ),
  )

  // [INV-STOCK-2]
  it.effect("balances are the sum of the movements appended, and a repeat appends none", () =>
    story(
      Story.when(item, new ReceiveStock({ quantity: 10n, warehouseLegalEntityId: entity })),
      Story.then(item, tenOnHand),
      Story.when(item, new ReceiveStock({ quantity: 5n, warehouseLegalEntityId: entity })),
      Story.then(item, new StockReceived({ quantity: 5n })),
      Story.when(item, reserve("r-1", 6n)),
      Story.then(item, new StockReserved({ reservationId: "r-1", quantity: 6n })),
      Story.when(item, correct("c-1", -3n)),
      Story.then(item, corrected("c-1", -3n)),
      Story.when(item, new FulfillReservation({ reservationId: "r-1" })),
      Story.then(item, new ReservationFulfilled({ reservationId: "r-1", quantity: 6n })),
      // 10 + 5 - 3 - 6 on hand, nothing reserved.
      Story.state(item, holds({ onHand: 6n, reserved: 0n })),
      Story.when(item, correct("c-1", -3n)),
      Story.then(item),
      Story.state(item, holds({ onHand: 6n, reserved: 0n })),
    ),
  )

  // [INV-STOCK-2]
  it.prop(
    "the balance after any movements is their sum, by direction",
    {
      receipts: Schema.Array(Schema.Int),
      corrections: Schema.Array(Schema.Int),
      reserves: Schema.Array(Schema.Int),
      releases: Schema.Array(Schema.Int),
      fulfils: Schema.Array(Schema.Int),
    },
    ({ receipts, corrections, reserves, releases, fulfils }) => {
      const sum = (values: ReadonlyArray<number>) =>
        values.reduce((total, value) => total + BigInt(value), 0n)

      const movements = [
        ...receipts.map((quantity) => BalanceMovement.Receipt({ quantity: BigInt(quantity) })),
        ...corrections.map((quantity) =>
          BalanceMovement.Correction({ quantity: BigInt(quantity) }),
        ),
        ...reserves.map((quantity) => BalanceMovement.Reserve({ quantity: BigInt(quantity) })),
        ...releases.map((quantity) => BalanceMovement.Release({ quantity: BigInt(quantity) })),
        ...fulfils.map((quantity) => BalanceMovement.Fulfill({ quantity: BigInt(quantity) })),
      ]

      const balance = movements.reduce(applyBalanceMovement, { onHand: 0n, reserved: 0n })

      assert.strictEqual(balance.onHand, sum(receipts) + sum(corrections) - sum(fulfils))
      assert.strictEqual(balance.reserved, sum(reserves) - sum(releases) - sum(fulfils))
    },
  )

  // [INV-STOCK-4]
  it.effect("a correction keeps reserved stock: it may remove stock down to the reservation", () =>
    story(
      Story.given(item, tenOnHand, new StockReserved({ reservationId: "r-1", quantity: 4n })),
      Story.when(item, correct("c-1", -6n)),
      Story.then(item, corrected("c-1", -6n)),
      Story.state(item, holds({ onHand: 4n, reserved: 4n })),
      Story.when(item, correct("c-2", -1n)),
      Story.rejected(new StockUnavailable({ available: 0n, requested: 1n })),
      Story.then(item),
      // The reservation survived both corrections and can still be fulfilled.
      Story.when(item, new FulfillReservation({ reservationId: "r-1" })),
      Story.then(item, new ReservationFulfilled({ reservationId: "r-1", quantity: 4n })),
      Story.state(item, holds({ onHand: 0n, reserved: 0n })),
    ),
  )

  // [INV-STOCK-4]
  it.effect("a correction is applied once per request", () =>
    story(
      Story.given(item, tenOnHand),
      Story.when(item, correct("c-1", -2n)),
      Story.then(item, corrected("c-1", -2n)),
      Story.when(item, correct("c-1", -2n)),
      Story.then(item),
      Story.state(item, holds({ onHand: 8n })),
      // A request with the same key and other content is refused, not applied.
      Story.when(item, correct("c-1", -3n)),
      Story.rejected(new CorrectionKeyReused({ idempotencyKey: "c-1" })),
      Story.state(item, holds({ onHand: 8n })),
    ),
  )

  // [INV-STOCK-4]
  it.effect("a correction states the unit of measure of the item", () =>
    story(
      Story.given(item, tenOnHand),
      Story.when(item, correct("c-1", 1n, { unit: "BOX" })),
      Story.rejected(new UnitOfMeasureMismatch({ expected: "EA", actual: "BOX" })),
      Story.then(item),
      Story.when(item, correct("c-2", 1n)),
      Story.then(item, corrected("c-2", 1n)),
    ),
  )

  // [INV-STOCK-5]
  it.effect("a receipt for another legal entity than the warehouse's is refused", () =>
    story(
      Story.when(
        item,
        new ReceiveStock({
          quantity: 1n,
          warehouseLegalEntityId: entity,
          legalEntityId: otherEntity,
        }),
      ),
      Story.rejected(
        new WarehouseLegalEntityMismatch({
          warehouseLegalEntityId: entity,
          legalEntityId: otherEntity,
        }),
      ),
      Story.then(item),
      Story.when(
        item,
        new ReceiveStock({ quantity: 2n, warehouseLegalEntityId: entity, legalEntityId: entity }),
      ),
      Story.then(item, new StockReceived({ quantity: 2n })),
      // A receipt that names no legal entity makes no claim.
      Story.when(item, new ReceiveStock({ quantity: 3n, warehouseLegalEntityId: entity })),
      Story.then(item, new StockReceived({ quantity: 3n })),
    ),
  )

  // [INV-STOCK-5]
  it.effect("a reservation for another legal entity than the warehouse's reserves nothing", () =>
    story(
      Story.given(item, tenOnHand),
      Story.when(item, reserveFor("r-1", 1n, otherEntity)),
      Story.rejected(
        new WarehouseLegalEntityMismatch({
          warehouseLegalEntityId: entity,
          legalEntityId: otherEntity,
        }),
      ),
      Story.then(item),
      Story.when(item, reserveFor("r-1", 1n, entity)),
      Story.then(item, new StockReserved({ reservationId: "r-1", quantity: 1n })),
    ),
  )

  // [INV-STOCK-5]
  it.effect("a transfer never crosses legal entities", () =>
    story(
      Story.when(
        transfer,
        new CreateTransfer({
          sourceWarehouseId: "w-1",
          destinationWarehouseId: "w-2",
          sourceLegalEntityId: entity,
          destinationLegalEntityId: otherEntity,
          lines: [{ itemId: "A", quantity: 1n }],
        }),
      ),
      Story.rejected(
        new TransferAcrossLegalEntities({
          sourceLegalEntityId: entity,
          destinationLegalEntityId: otherEntity,
        }),
      ),
      Story.then(transfer),
      Story.when(
        transfer,
        new CreateTransfer({
          sourceWarehouseId: "w-1",
          destinationWarehouseId: "w-2",
          sourceLegalEntityId: entity,
          destinationLegalEntityId: entity,
          lines: [{ itemId: "A", quantity: 1n }],
        }),
      ),
      Story.then(
        transfer,
        new TransferCreated({
          sourceWarehouseId: "w-1",
          destinationWarehouseId: "w-2",
          lines: [{ itemId: "A", quantity: 1n }],
        }),
      ),
    ),
  )

  // [INV-VAL-3]
  it.effect(
    "an issue above the valued quantity is unvalued, never issued at an invented cost",
    () =>
      story(
        Story.given(valuation, new ValueReceived({ quantity: 4n, value: 4000n })),
        Story.when(valuation, new IssueValue({ itemId: "A", sourceId: "d-1", quantity: 5n })),
        Story.rejected(new StockValuationUnavailable({ valued: 4n, requested: 5n })),
        Story.then(valuation),
        Story.state(valuation, holdsValuation({ quantity: 4n, value: 4000n })),
        // The last valued units take the remaining value.
        Story.when(valuation, new IssueValue({ itemId: "A", sourceId: "d-2", quantity: 4n })),
        Story.then(valuation, new ValueIssued({ sourceId: "d-2", quantity: 4n, value: 4000n })),
        Story.state(valuation, holdsValuation({ quantity: 0n, value: 0n })),
        Story.when(valuation, new IssueValue({ itemId: "A", sourceId: "d-3", quantity: 1n })),
        Story.rejected(new StockValuationUnavailable({ valued: 0n, requested: 1n })),
      ),
  )

  // [INV-VAL-3]
  it.effect("stock that was never valued has no cost to issue", () =>
    story(
      Story.given(item, tenOnHand),
      Story.when(valuation, new IssueValue({ itemId: "A", sourceId: "d-1", quantity: 1n })),
      Story.rejected(new StockValuationUnavailable({ valued: 0n, requested: 1n })),
      Story.then(valuation),
      Story.when(valuation, new ReceiveValue({ itemId: "A", quantity: 3n, value: 300n })),
      Story.then(valuation, new ValueReceived({ quantity: 3n, value: 300n })),
      Story.when(valuation, new IssueValue({ itemId: "A", sourceId: "d-1", quantity: 1n })),
      Story.then(valuation, new ValueIssued({ sourceId: "d-1", quantity: 1n, value: 100n })),
    ),
  )

  // [INV-VAL-3]
  it.effect("a stated cost above the valued amount is unvalued, and an issue is idempotent", () =>
    story(
      Story.given(valuation, new ValueReceived({ quantity: 4n, value: 4000n })),
      Story.when(
        valuation,
        new IssueValue({ itemId: "A", sourceId: "d-1", quantity: 2n, issueValue: 4001n }),
      ),
      Story.rejected(new StockValuationUnavailable({ valued: 4n, requested: 2n })),
      Story.when(
        valuation,
        new IssueValue({ itemId: "A", sourceId: "d-1", quantity: 2n, issueValue: 1500n }),
      ),
      Story.then(valuation, new ValueIssued({ sourceId: "d-1", quantity: 2n, value: 1500n })),
      Story.when(
        valuation,
        new IssueValue({ itemId: "A", sourceId: "d-1", quantity: 2n, issueValue: 1500n }),
      ),
      Story.then(valuation),
    ),
  )

  // [INV-VAL-3]
  it.prop(
    "an issue is unavailable without stock, else costed by the valuation alone, as the service does",
    {
      onHand: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 50 })),
      reserved: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 50 })),
      valuedQuantity: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 50 })),
      value: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100_000 })),
      quantity: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 60 })),
    },
    ({ onHand, reserved, valuedQuantity, value, quantity }) => {
      const balance = { onHand: BigInt(onHand), reserved: BigInt(Math.min(reserved, onHand)) }

      const valued = {
        quantity: BigInt(valuedQuantity),
        value: valuedQuantity === 0 ? 0n : BigInt(value),
      }

      const line = { itemId: "A", quantity: -BigInt(quantity) }
      const result = valueIssue(line, balance, valued)

      if (!hasAvailableStock(balance, BigInt(quantity))) {
        assert.isTrue(LineValue.$is("Unavailable")(result))
      } else {
        assert.deepStrictEqual(result, costIssue(line, valued))
      }

      // No cost is ever taken from fewer valued units than the issue needs.
      if (valued.quantity < BigInt(quantity)) {
        assert.isFalse(LineValue.$is("Valued")(result))
      }
    },
  )

  const approval = "finance-owner"

  const line = (overrides: Partial<(typeof AcceptOpening.Type)["lines"][number]> = {}) => ({
    itemId: "A",
    quantity: "10",
    tracking: "none" as const,
    reservedQuantity: "0",
    inTransitQuantity: "0",
    ...overrides,
  })

  const accept = (lines: ReadonlyArray<ReturnType<typeof line>>) =>
    new AcceptOpening({ warehouseId: "w-1", cutoffDate: "2026-12-31", lines })

  const acceptApproved = (lines: ReadonlyArray<ReturnType<typeof line>>) =>
    new AcceptOpening({
      warehouseId: "w-1",
      cutoffDate: "2026-12-31",
      lines,
      revaluationApprovedBy: approval,
    })

  const accepted = (lines: ReadonlyArray<ReturnType<typeof line>>) =>
    new OpeningAccepted({ warehouseId: "w-1", cutoffDate: "2026-12-31", lines })

  // [INV-OPEN-2]
  it.effect("an opening load carries on-hand stock only", () =>
    story(Story.when(opening, accept([line()])), Story.then(opening, accepted([line()]))),
  )

  // [INV-OPEN-2]
  it.effect("lot and expiry tracked stock stays under source authority", () =>
    story(
      Story.when(opening, accept([line({ tracking: "lot" })])),
      Story.rejected(new LotTrackingUnsupported({ itemId: "A", tracking: "lot" })),
      Story.when(opening, accept([line(), line({ itemId: "B", tracking: "expiry" })])),
      Story.rejected(new LotTrackingUnsupported({ itemId: "B", tracking: "expiry" })),
      Story.then(opening),
    ),
  )

  // [INV-OPEN-2]
  it.effect("declared reservations and goods in transit are rejected, not dropped", () =>
    story(
      Story.when(opening, accept([line({ reservedQuantity: "3" })])),
      Story.rejected(new ReservationsNotCarried({ itemId: "A", reserved: "3" })),
      Story.when(opening, accept([line({ inTransitQuantity: "4" })])),
      Story.rejected(new InTransitNotCarried({ itemId: "A", inTransit: "4" })),
      Story.then(opening),
    ),
  )

  // [INV-OPEN-3]
  it.effect("a revalued line needs the approval, and only a revalued line carries it", () =>
    story(
      Story.when(opening, accept([line({ movingAverageValue: "90.00" })])),
      Story.rejected(new RevaluationApprovalMismatch()),
      Story.when(opening, acceptApproved([line()])),
      Story.rejected(new RevaluationApprovalMismatch()),
      Story.then(opening),
      Story.when(opening, acceptApproved([line({ movingAverageValue: "90.00" })])),
      Story.then(opening, accepted([line({ movingAverageValue: "90.00" })])),
    ),
  )
})
