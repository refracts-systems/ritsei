import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  CalendarDate,
  type DatabaseFailure,
  FinancialMajorAmount,
  InstantString,
  Uuid,
  PositiveQuantity,
  NonNegativeQuantity,
  DottedName,
  TrimmedText,
} from "../../../../framework/foundation/mod.ts"
import { Principal } from "../../../../framework/modules/auth/mod.ts"
import type { AuthorizationDenied } from "../../../../framework/modules/authorization/mod.ts"
import type { PostEntryFailure } from "../../accounting/mod.ts"
import type { ProductNotFound } from "../../product/mod.ts"
import type { Item } from "./contract.ts"
import type {
  InventoryReferenceNotFound,
  OpeningStockAlreadyLoaded,
  OpeningStockConflict,
  OpeningStockInTransitNotCarried,
  OpeningStockLotTrackingUnsupported,
  OpeningStockReservationsNotCarried,
  StockNotStockable,
  StockUnavailable,
  StockValuationUnavailable,
} from "./errors.ts"

const Quantity = PositiveQuantity
const SourceType = DottedName
const ScopedInput = { principal: Principal, tenantId: Uuid }

/** The business document that moved stock; one document moves an item at most once. */
export const StockSource = Schema.Struct({ type: SourceType, id: Uuid })

const uniqueItems = <T extends { readonly itemId: string }>(lines: ReadonlyArray<T>) =>
  new Set(lines.map((line) => line.itemId)).size === lines.length

const DocumentLines = <S extends Schema.Top>(line: S) =>
  Schema.Array(line)
    .check(Schema.isMinLength(1))
    .check(
      Schema.makeFilter(
        // SAFETY: every caller passes a line schema that declares itemId, which `uniqueItems` reads.
        (lines) => uniqueItems(lines as ReadonlyArray<{ readonly itemId: string }>),
        {
          expected: "each item appears once per stock document",
        },
      ),
    )

export const RegisterProductItemInput = Schema.Struct({ ...ScopedInput, productId: Uuid })

export const ReceiveValuedStockInput = Schema.Struct({
  ...ScopedInput,
  warehouseId: Uuid,
  postingDate: CalendarDate,
  source: StockSource,
  /** The account role credited for the received value. */
  counterRole: Schema.Literals(["goods_received_not_invoiced", "inventory_adjustment"]),
  lines: DocumentLines(
    Schema.Struct({ itemId: Uuid, quantity: Quantity, unitCost: FinancialMajorAmount }),
  ),
})

export const IssueValuedStockInput = Schema.Struct({
  ...ScopedInput,
  warehouseId: Uuid,
  postingDate: CalendarDate,
  source: StockSource,
  /** The account role debited for the issued cost. */
  counterRole: Schema.Literals([
    "cost_of_goods_sold",
    "inventory_adjustment",
    "goods_received_not_invoiced",
  ]),
  lines: DocumentLines(
    Schema.Struct({
      itemId: Uuid,
      quantity: Quantity,
      /** Removes value at this cost instead of the moving average, as returns to suppliers do. */
      unitCost: Schema.optionalKey(FinancialMajorAmount),
    }),
  ),
})

export const CountStockInput = Schema.Struct({
  ...ScopedInput,
  warehouseId: Uuid,
  postingDate: CalendarDate,
  /** The stock count document id. */
  countId: Uuid,
  lines: DocumentLines(
    Schema.Struct({
      itemId: Uuid,
      countedQuantity: NonNegativeQuantity,
      /** Cost for counted gains when the item has no valued stock to average. */
      unitCost: Schema.optionalKey(FinancialMajorAmount),
    }),
  ),
})

const OpeningTracking = Schema.Literals(["none", "lot", "expiry"])

/** The owner's approval of the one-time revaluation of opening stock to moving average. */
export const OpeningRevaluation = Schema.Struct({
  /** Names the adjustment, for example "FIFO to moving average at cutoff". */
  name: TrimmedText(120),
  approvedBy: TrimmedText(120),
  approvedAt: InstantString,
  reference: TrimmedText(200),
})

/**
 * The cutover position of items in one warehouse. Quantities are physical on hand. The source
 * declares what the load does not carry (tracking, reservations, goods in transit), and the load
 * rejects anything other than none, so no source position is dropped unseen (ADR-0118).
 */
export const OpeningStockInput = Schema.Struct({
  ...ScopedInput,
  warehouseId: Uuid,
  /** The opening document id; a retry of the same document returns the recorded load. */
  openingId: Uuid,
  /** The business date the source's quantities and values are as of. */
  cutoffDate: CalendarDate,
  /** Required exactly when a line states a moving-average value. */
  revaluation: Schema.optionalKey(OpeningRevaluation),
  lines: DocumentLines(
    Schema.Struct({
      itemId: Uuid,
      quantity: Quantity,
      /** The line's total value as the source reports it. */
      sourceValue: FinancialMajorAmount,
      /** The line's total value at moving average, when the source values stock another way. */
      movingAverageValue: Schema.optionalKey(FinancialMajorAmount),
      tracking: OpeningTracking,
      reservedQuantity: NonNegativeQuantity,
      inTransitQuantity: NonNegativeQuantity,
    }),
  ),
}).check(
  Schema.makeFilter(
    (input) =>
      (input.revaluation !== undefined) ===
      input.lines.some((line) => line.movingAverageValue !== undefined),
    { expected: "a revaluation approval exactly when a line states a moving-average value" },
  ),
)

export const OpeningStockLine = Schema.Struct({
  itemId: Uuid,
  movementId: Uuid,
  quantity: Quantity,
  sourceValue: FinancialMajorAmount,
  /** The value now held: the moving-average value, or the source value when not revalued. */
  value: FinancialMajorAmount,
  /** Signed: the value held less the source value. */
  adjustment: Schema.String,
})

/**
 * The loaded position. `valueToClear` is the source total the accounting owner offsets against
 * the migration clearing account; `adjustment` is the approved revaluation difference.
 */
export const OpeningStockLoad = Schema.Struct({
  legalEntityId: Uuid,
  openingId: Uuid,
  warehouseId: Uuid,
  cutoffDate: CalendarDate,
  lines: Schema.Array(OpeningStockLine),
  valueToClear: FinancialMajorAmount,
  adjustment: Schema.String,
  value: FinancialMajorAmount,
})

export type OpeningStockLoad = Schema.Schema.Type<typeof OpeningStockLoad>

export const ValuationReportInput = Schema.Struct({ ...ScopedInput, legalEntityId: Uuid })

export const ValuedStockLine = Schema.Struct({
  itemId: Uuid,
  movementId: Uuid,
  /** Signed: positive for receipts and gains, negative for issues and losses. */
  quantity: Schema.String,
  /** Signed value the movement added to or removed from stock. */
  value: Schema.String,
})

export const ValuedStockMovement = Schema.Struct({
  legalEntityId: Uuid,
  source: StockSource,
  lines: Schema.Array(ValuedStockLine),
  journalEntryId: Schema.NullOr(Uuid),
})

export type ValuedStockMovement = Schema.Schema.Type<typeof ValuedStockMovement>

export const StockValuation = Schema.Struct({
  legalEntityId: Uuid,
  rows: Schema.Array(
    Schema.Struct({ itemId: Uuid, quantity: NonNegativeQuantity, value: FinancialMajorAmount }),
  ),
  totalValue: FinancialMajorAmount,
})

export type StockValuation = Schema.Schema.Type<typeof StockValuation>

type CommonFailure = AuthorizationDenied | DatabaseFailure | Schema.SchemaError

type MovementFailure =
  | InventoryReferenceNotFound
  | StockUnavailable
  | StockValuationUnavailable
  | PostEntryFailure
  | CommonFailure

/**
 * Document-driven stock keeping with moving-average valuation (ADR-0100). Each command moves
 * stock, updates valuation, and posts the value through the general ledger in one transaction.
 */
export interface StockKeepingService {
  readonly registerProductItem: (
    input: Schema.Codec.Encoded<typeof RegisterProductItemInput>,
  ) => Effect.Effect<Item, ProductNotFound | StockNotStockable | CommonFailure>
  readonly receiveValued: (
    input: Schema.Codec.Encoded<typeof ReceiveValuedStockInput>,
  ) => Effect.Effect<ValuedStockMovement, MovementFailure>
  readonly issueValued: (
    input: Schema.Codec.Encoded<typeof IssueValuedStockInput>,
  ) => Effect.Effect<ValuedStockMovement, MovementFailure>
  readonly countStock: (
    input: Schema.Codec.Encoded<typeof CountStockInput>,
  ) => Effect.Effect<ValuedStockMovement, MovementFailure>
  /**
   * Loads the cutover position of a warehouse once (ADR-0118). It posts no journal: the accounting
   * owner offsets `valueToClear` against the migration clearing account.
   */
  readonly loadOpeningStock: (
    input: Schema.Codec.Encoded<typeof OpeningStockInput>,
  ) => Effect.Effect<
    OpeningStockLoad,
    | InventoryReferenceNotFound
    | OpeningStockAlreadyLoaded
    | OpeningStockConflict
    | OpeningStockInTransitNotCarried
    | OpeningStockLotTrackingUnsupported
    | OpeningStockReservationsNotCarried
    | CommonFailure
  >
  readonly valuation: (
    input: Schema.Codec.Encoded<typeof ValuationReportInput>,
  ) => Effect.Effect<StockValuation, CommonFailure>
}

export const StockKeepingService = Context.Service<StockKeepingService>(
  "RITSEI/StockKeepingService",
)
