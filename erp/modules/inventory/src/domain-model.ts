/**
 * Alchemy model of the Inventory aggregates that hold the class A rules (ADR-0124, phase 1). It is
 * not exported from `mod.ts`: production keeps the tables and loads no Alchemy code. Every
 * `decide` calls the pure function the stores call (`stock-rules.ts`, `valuation.ts`,
 * `opening-stock-rules.ts`), so the model and the services cannot disagree about a rule.
 *
 * Authorization and tenant scope run in the service before a command is sent (phase 0): `decide`
 * checks no capability, and an instance id is built from the caller's tenant. Reference data the
 * service has already read (a warehouse's legal entity, an item's unit of measure) arrives in the
 * command.
 */
import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"

import {
  firstUncarried,
  OpeningRejection,
  requestedOpeningRows,
  revaluationApproved,
  sameOpeningBundle,
} from "./opening-stock-rules.ts"
import {
  CorrectionDecision,
  decideCorrection,
  decideReservationClose,
  hasAvailableStock,
  type ReservationStatus,
  ReservationCloseDecision,
  transferWithinLegalEntity,
  warehouseInLegalEntity,
  applyBalanceMovement,
  BalanceMovement,
} from "./stock-rules.ts"
import { costIssue, LineValue, valueReceipt } from "./valuation.ts"

// ---------------------------------------------------------------- ids and values

/** One item in one warehouse: `<warehouseId>/<itemId>`. */
export const StockItemId = Schema.String.pipe(Schema.brand("StockItemId"))

/** Moving-average valuation of one item in one legal entity: `<legalEntityId>/<itemId>`. */
export const ItemValuationId = Schema.String.pipe(Schema.brand("ItemValuationId"))

export const StockTransferId = Schema.String.pipe(Schema.brand("StockTransferId"))
export const OpeningLoadId = Schema.String.pipe(Schema.brand("OpeningLoadId"))

/** Quantities and minor-unit values are bigint, as the shared functions take them. */
const Amount = Schema.BigInt

// ---------------------------------------------------------------- StockItem

export class StockUnavailable extends Domain.Rejection("StockUnavailable", {
  available: Amount,
  requested: Amount,
}) {}

export class WarehouseLegalEntityMismatch extends Domain.Rejection("WarehouseLegalEntityMismatch", {
  warehouseLegalEntityId: Schema.String,
  legalEntityId: Schema.String,
}) {}

export class ReservationNotFound extends Domain.Rejection("ReservationNotFound", {
  reservationId: Schema.String,
}) {}

const ReservationStatusSchema = Schema.Literals(["active", "released", "fulfilled"])

export class ReservationInvalidState extends Domain.Rejection("ReservationInvalidState", {
  reservationId: Schema.String,
  status: ReservationStatusSchema,
}) {}

export class UnitOfMeasureMismatch extends Domain.Rejection("UnitOfMeasureMismatch", {
  expected: Schema.String,
  actual: Schema.String,
}) {}

export class CorrectionKeyReused extends Domain.Rejection("CorrectionKeyReused", {
  idempotencyKey: Schema.String,
}) {}

/** Stock arrives in the warehouse. The movement log of the instance is its event stream. */
export class StockReceived extends Domain.Event("StockReceived", { quantity: Amount }) {}

export class ReceiveStock extends Domain.Command("ReceiveStock", {
  target: StockItemId,
  input: {
    quantity: Amount,
    /** The legal entity of the warehouse, as the service read it. */
    warehouseLegalEntityId: Schema.String,
    /** The legal entity the caller states for the stock, when it states one. */
    legalEntityId: Schema.optionalKey(Schema.String),
  },
  events: [StockReceived],
  rejects: [WarehouseLegalEntityMismatch],
}) {}

export class StockReserved extends Domain.Event("StockReserved", {
  reservationId: Schema.String,
  quantity: Amount,
}) {}

export class ReserveStock extends Domain.Command("ReserveStock", {
  target: StockItemId,
  input: {
    /** The idempotency identity of the reservation: repeating it commits nothing. */
    reservationId: Schema.String,
    quantity: Amount,
    warehouseLegalEntityId: Schema.String,
    legalEntityId: Schema.optionalKey(Schema.String),
  },
  events: [StockReserved],
  rejects: [WarehouseLegalEntityMismatch, StockUnavailable],
}) {}

export class ReservationReleased extends Domain.Event("ReservationReleased", {
  reservationId: Schema.String,
  quantity: Amount,
}) {}

export class ReleaseReservation extends Domain.Command("ReleaseReservation", {
  target: StockItemId,
  input: { reservationId: Schema.String },
  events: [ReservationReleased],
  rejects: [ReservationNotFound, ReservationInvalidState],
}) {}

export class ReservationFulfilled extends Domain.Event("ReservationFulfilled", {
  reservationId: Schema.String,
  quantity: Amount,
}) {}

export class FulfillReservation extends Domain.Command("FulfillReservation", {
  target: StockItemId,
  input: { reservationId: Schema.String },
  events: [ReservationFulfilled],
  rejects: [ReservationNotFound, ReservationInvalidState],
}) {}

export class StockCorrected extends Domain.Event("StockCorrected", {
  idempotencyKey: Schema.String,
  adjustment: Amount,
  unitOfMeasure: Schema.String,
  reason: Schema.String,
}) {}

export class CorrectStock extends Domain.Command("CorrectStock", {
  target: StockItemId,
  input: {
    idempotencyKey: Schema.String,
    /** Signed: negative removes stock. */
    adjustment: Amount,
    /** Normalized by the service: trimmed and upper case. */
    unitOfMeasure: Schema.String,
    reason: Schema.String,
    /** The unit of measure of the item, as the service read it. */
    itemUnitOfMeasure: Schema.String,
  },
  events: [StockCorrected],
  rejects: [UnitOfMeasureMismatch, StockUnavailable, CorrectionKeyReused],
}) {}

const Reservation = Schema.Struct({ quantity: Amount, status: ReservationStatusSchema })

const Correction = Schema.Struct({
  adjustment: Amount,
  unitOfMeasure: Schema.String,
  reason: Schema.String,
})

const StockState = Schema.Struct({
  onHand: Amount,
  reserved: Amount,
  reservations: Schema.Record(Schema.String, Reservation),
  /** Corrections by idempotency key, so a repeat is a no-op. */
  corrections: Schema.Record(Schema.String, Correction),
})

type StockState = typeof StockState.Type

/** The state after a movement, the balance folded by the function the memory store uses. */
const afterMovement = (state: StockState, movement: BalanceMovement): StockState => ({
  ...state,
  ...applyBalanceMovement({ onHand: state.onHand, reserved: state.reserved }, movement),
})

const withReservation = (state: StockState, id: string, status: ReservationStatus): StockState => ({
  ...state,
  reservations: { ...state.reservations, [id]: { ...state.reservations[id]!, status } },
})

/** The decision for releasing or fulfilling a reservation, from the state of the instance. */
const closeReservation = <E>(
  state: StockState,
  reservationId: string,
  operation: "release" | "fulfill",
  applied: (quantity: bigint) => E,
) => {
  const reservation = state.reservations[reservationId]

  if (reservation === undefined) return new ReservationNotFound({ reservationId })

  return ReservationCloseDecision.$match(decideReservationClose(reservation.status, operation), {
    Apply: () => [applied(reservation.quantity)],
    Existing: () => [],
    InvalidState: ({ status }) => new ReservationInvalidState({ reservationId, status }),
  })
}

export class StockItem extends Domain.Aggregate("StockItem", {
  id: StockItemId,
  state: StockState,
  initial: { onHand: 0n, reserved: 0n, reservations: {}, corrections: {} },
  commands: [ReceiveStock, ReserveStock, ReleaseReservation, FulfillReservation, CorrectStock],
  decide: {
    ReceiveStock: (_, cmd) =>
      warehouseInLegalEntity(cmd.warehouseLegalEntityId, cmd.legalEntityId)
        ? [new StockReceived({ quantity: cmd.quantity })]
        : new WarehouseLegalEntityMismatch({
            warehouseLegalEntityId: cmd.warehouseLegalEntityId,
            legalEntityId: cmd.legalEntityId!,
          }),
    ReserveStock: (s, cmd) => {
      if (!warehouseInLegalEntity(cmd.warehouseLegalEntityId, cmd.legalEntityId)) {
        return new WarehouseLegalEntityMismatch({
          warehouseLegalEntityId: cmd.warehouseLegalEntityId,
          legalEntityId: cmd.legalEntityId!,
        })
      }

      if (s.reservations[cmd.reservationId] !== undefined) return []

      if (!hasAvailableStock(s, cmd.quantity)) {
        return new StockUnavailable({ available: s.onHand - s.reserved, requested: cmd.quantity })
      }

      return [new StockReserved({ reservationId: cmd.reservationId, quantity: cmd.quantity })]
    },
    ReleaseReservation: (s, cmd) =>
      closeReservation(
        s,
        cmd.reservationId,
        "release",
        (quantity) => new ReservationReleased({ reservationId: cmd.reservationId, quantity }),
      ),
    FulfillReservation: (s, cmd) =>
      closeReservation(
        s,
        cmd.reservationId,
        "fulfill",
        (quantity) => new ReservationFulfilled({ reservationId: cmd.reservationId, quantity }),
      ),
    CorrectStock: (s, cmd) => {
      const recorded = s.corrections[cmd.idempotencyKey]

      if (recorded !== undefined) {
        return recorded.adjustment === cmd.adjustment &&
          recorded.unitOfMeasure === cmd.unitOfMeasure &&
          recorded.reason === cmd.reason
          ? []
          : new CorrectionKeyReused({ idempotencyKey: cmd.idempotencyKey })
      }

      return CorrectionDecision.$match(
        decideCorrection(
          { unitOfMeasure: cmd.itemUnitOfMeasure },
          cmd.unitOfMeasure,
          s,
          cmd.adjustment,
        ),
        {
          Apply: () => [
            new StockCorrected({
              idempotencyKey: cmd.idempotencyKey,
              adjustment: cmd.adjustment,
              unitOfMeasure: cmd.unitOfMeasure,
              reason: cmd.reason,
            }),
          ],
          UnitOfMeasureMismatch: ({ expected, actual }) =>
            new UnitOfMeasureMismatch({ expected, actual }),
          BelowReserved: () =>
            new StockUnavailable({ available: s.onHand - s.reserved, requested: -cmd.adjustment }),
        },
      )
    },
  },
  evolve: {
    // The balance is the fold of the movements over zero.
    StockReceived: (s, e): StockState =>
      afterMovement(s, BalanceMovement.Receipt({ quantity: e.quantity })),
    StockReserved: (s, e): StockState => ({
      ...afterMovement(s, BalanceMovement.Reserve({ quantity: e.quantity })),
      reservations: {
        ...s.reservations,
        [e.reservationId]: { quantity: e.quantity, status: "active" },
      },
    }),
    ReservationReleased: (s, e): StockState =>
      afterMovement(
        withReservation(s, e.reservationId, "released"),
        BalanceMovement.Release({ quantity: e.quantity }),
      ),
    ReservationFulfilled: (s, e): StockState =>
      afterMovement(
        withReservation(s, e.reservationId, "fulfilled"),
        BalanceMovement.Fulfill({ quantity: e.quantity }),
      ),
    StockCorrected: (s, e): StockState => ({
      ...afterMovement(s, BalanceMovement.Correction({ quantity: e.adjustment })),
      corrections: {
        ...s.corrections,
        [e.idempotencyKey]: {
          adjustment: e.adjustment,
          unitOfMeasure: e.unitOfMeasure,
          reason: e.reason,
        },
      },
    }),
  },
}) {}

// ---------------------------------------------------------------- ItemValuation

export class StockValuationUnavailable extends Domain.Rejection("StockValuationUnavailable", {
  valued: Amount,
  requested: Amount,
}) {}

export class ValueReceived extends Domain.Event("ValueReceived", {
  quantity: Amount,
  value: Amount,
}) {}

export class ReceiveValue extends Domain.Command("ReceiveValue", {
  target: ItemValuationId,
  input: { itemId: Schema.String, quantity: Amount, value: Amount },
  events: [ValueReceived],
}) {}

export class ValueIssued extends Domain.Event("ValueIssued", {
  sourceId: Schema.String,
  quantity: Amount,
  /** The positive cost removed from the valuation. */
  value: Amount,
}) {}

export class IssueValue extends Domain.Command("IssueValue", {
  target: ItemValuationId,
  input: {
    itemId: Schema.String,
    /** The document that issues the stock; a document moves an item at most once. */
    sourceId: Schema.String,
    quantity: Amount,
    /** A cost the document states instead of the moving average. */
    issueValue: Schema.optionalKey(Amount),
  },
  events: [ValueIssued],
  rejects: [StockValuationUnavailable],
}) {}

const ValuationState = Schema.Struct({
  quantity: Amount,
  value: Amount,
  issues: Schema.Record(Schema.String, Schema.Boolean),
})

export class ItemValuation extends Domain.Aggregate("ItemValuation", {
  id: ItemValuationId,
  state: ValuationState,
  initial: { quantity: 0n, value: 0n, issues: {} },
  commands: [ReceiveValue, IssueValue],
  decide: {
    ReceiveValue: (s, cmd) => {
      const valued = valueReceipt(
        { itemId: cmd.itemId, quantity: cmd.quantity, receiptValue: cmd.value },
        s,
      )

      return LineValue.$is("Valued")(valued)
        ? [new ValueReceived({ quantity: cmd.quantity, value: valued.line.value })]
        : []
    },
    IssueValue: (s, cmd) => {
      if (s.issues[cmd.sourceId] !== undefined) return []

      const cost = costIssue(
        { itemId: cmd.itemId, quantity: -cmd.quantity, issueValue: cmd.issueValue },
        s,
      )

      return LineValue.$is("Valued")(cost)
        ? [
            new ValueIssued({
              sourceId: cmd.sourceId,
              quantity: cmd.quantity,
              value: -cost.line.value,
            }),
          ]
        : new StockValuationUnavailable({ valued: s.quantity, requested: cmd.quantity })
    },
  },
  evolve: {
    ValueReceived: (s, e) => ({
      ...s,
      quantity: s.quantity + e.quantity,
      value: s.value + e.value,
    }),
    ValueIssued: (s, e) => ({
      quantity: s.quantity - e.quantity,
      value: s.value - e.value,
      issues: { ...s.issues, [e.sourceId]: true },
    }),
  },
}) {}

// ---------------------------------------------------------------- StockTransfer (creation only)

export class TransferAcrossLegalEntities extends Domain.Rejection("TransferAcrossLegalEntities", {
  sourceLegalEntityId: Schema.String,
  destinationLegalEntityId: Schema.String,
}) {}

const TransferLine = Schema.Struct({ itemId: Schema.String, quantity: Amount })

export class TransferCreated extends Domain.Event("TransferCreated", {
  sourceWarehouseId: Schema.String,
  destinationWarehouseId: Schema.String,
  lines: Schema.Array(TransferLine),
}) {}

/** Confirmation and completion move stock in two warehouses, so they are not modeled here. */
export class CreateTransfer extends Domain.Command("CreateTransfer", {
  target: StockTransferId,
  input: {
    sourceWarehouseId: Schema.String,
    destinationWarehouseId: Schema.String,
    /** The legal entities of the two warehouses, as the service read them. */
    sourceLegalEntityId: Schema.String,
    destinationLegalEntityId: Schema.String,
    lines: Schema.Array(TransferLine),
  },
  events: [TransferCreated],
  rejects: [TransferAcrossLegalEntities],
}) {}

const NoTransfer = Schema.TaggedStruct("None", {})
const DraftTransfer = Schema.TaggedStruct("Draft", {})

export class StockTransfer extends Domain.Aggregate("StockTransfer", {
  id: StockTransferId,
  state: Schema.Union([NoTransfer, DraftTransfer]),
  initial: NoTransfer.make({}),
  commands: [CreateTransfer],
  decide: {
    CreateTransfer: (s, cmd) => {
      if (!Predicate.isTagged(s, "None")) return []

      return transferWithinLegalEntity(cmd.sourceLegalEntityId, cmd.destinationLegalEntityId)
        ? [
            new TransferCreated({
              sourceWarehouseId: cmd.sourceWarehouseId,
              destinationWarehouseId: cmd.destinationWarehouseId,
              lines: cmd.lines,
            }),
          ]
        : new TransferAcrossLegalEntities({
            sourceLegalEntityId: cmd.sourceLegalEntityId,
            destinationLegalEntityId: cmd.destinationLegalEntityId,
          })
    },
  },
  evolve: { TransferCreated: () => DraftTransfer.make({}) },
}) {}

// ---------------------------------------------------------------- OpeningLoad (acceptance only)

export class RevaluationApprovalMismatch extends Domain.Rejection("RevaluationApprovalMismatch") {}

/** The opening was loaded before with another warehouse, cutoff date, or lines. */
export class OpeningStockConflict extends Domain.Rejection("OpeningStockConflict") {}

export class LotTrackingUnsupported extends Domain.Rejection("LotTrackingUnsupported", {
  itemId: Schema.String,
  tracking: Schema.Literals(["lot", "expiry"]),
}) {}

export class ReservationsNotCarried extends Domain.Rejection("ReservationsNotCarried", {
  itemId: Schema.String,
  reserved: Schema.String,
}) {}

export class InTransitNotCarried extends Domain.Rejection("InTransitNotCarried", {
  itemId: Schema.String,
  inTransit: Schema.String,
}) {}

/** A line of an opening load bundle, as `AcceptOpening` takes it. */
export const OpeningLine = Schema.Struct({
  itemId: Schema.String,
  quantity: Schema.String,
  sourceValue: Schema.String,
  movingAverageValue: Schema.optionalKey(Schema.String),
  tracking: Schema.Literals(["none", "lot", "expiry"]),
  reservedQuantity: Schema.String,
  inTransitQuantity: Schema.String,
})

export class OpeningAccepted extends Domain.Event("OpeningAccepted", {
  warehouseId: Schema.String,
  cutoffDate: Schema.String,
  lines: Schema.Array(OpeningLine),
}) {}

/**
 * Whether a load bundle may be loaded. Writing the positions and posting the journal span stock
 * items and the ledger (INV-OPEN-4, INV-OPEN-5), so this aggregate only accepts or refuses the
 * bundle.
 */
export class AcceptOpening extends Domain.Command("AcceptOpening", {
  target: OpeningLoadId,
  input: {
    warehouseId: Schema.String,
    cutoffDate: Schema.String,
    /** Present when the load carries the owner's revaluation approval. */
    revaluationApprovedBy: Schema.optionalKey(Schema.String),
    lines: Schema.Array(OpeningLine),
  },
  events: [OpeningAccepted],
  rejects: [
    RevaluationApprovalMismatch,
    LotTrackingUnsupported,
    ReservationsNotCarried,
    InTransitNotCarried,
    OpeningStockConflict,
  ],
}) {}

const Unaccepted = Schema.TaggedStruct("Unaccepted", {})

const Accepted = Schema.TaggedStruct("Accepted", {
  warehouseId: Schema.String,
  cutoffDate: Schema.String,
  lines: Schema.Array(OpeningLine),
})

const OpeningState = Schema.Union([Unaccepted, Accepted])

type OpeningState = typeof OpeningState.Type

export class OpeningLoad extends Domain.Aggregate("OpeningLoad", {
  id: OpeningLoadId,
  state: OpeningState,
  initial: Unaccepted.make({}),
  commands: [AcceptOpening],
  decide: {
    AcceptOpening: (s, cmd) => {
      // The input schema checks the approval before the service looks at the lines, and both
      // come before the service looks for a recorded load.
      if (!revaluationApproved(cmd.revaluationApprovedBy !== undefined, cmd.lines)) {
        return new RevaluationApprovalMismatch()
      }

      const uncarried = firstUncarried(cmd.lines)

      if (uncarried !== undefined) {
        return OpeningRejection.$match(uncarried, {
          LotTrackingUnsupported: ({ itemId, tracking }) =>
            new LotTrackingUnsupported({ itemId, tracking }),
          ReservationsNotCarried: ({ itemId, reserved }) =>
            new ReservationsNotCarried({ itemId, reserved }),
          InTransitNotCarried: ({ itemId, inTransit }) =>
            new InTransitNotCarried({ itemId, inTransit }),
        })
      }

      // INV-OPEN-4: a repeat of the same bundle commits nothing; a changed one is a conflict.
      if (Predicate.isTagged(s, "Accepted")) {
        return sameOpeningBundle(
          {
            warehouseId: s.warehouseId,
            cutoffDate: s.cutoffDate,
            rows: requestedOpeningRows(s.lines),
          },
          {
            warehouseId: cmd.warehouseId,
            cutoffDate: cmd.cutoffDate,
            rows: requestedOpeningRows(cmd.lines),
          },
        )
          ? []
          : new OpeningStockConflict()
      }

      return [
        new OpeningAccepted({
          warehouseId: cmd.warehouseId,
          cutoffDate: cmd.cutoffDate,
          lines: cmd.lines,
        }),
      ]
    },
  },
  evolve: {
    OpeningAccepted: (_, e): OpeningState =>
      Accepted.make({ warehouseId: e.warehouseId, cutoffDate: e.cutoffDate, lines: e.lines }),
  },
}) {}

// ---------------------------------------------------------------- Model

export class InventoryClassA extends Domain.Model("InventoryClassA", {
  aggregates: [StockItem, ItemValuation, StockTransfer, OpeningLoad],
}) {}
