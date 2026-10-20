import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  CalendarDate,
  type DatabaseFailure,
  FinancialMajorAmount,
  Uuid,
  PositiveQuantity,
  NonNegativeQuantity,
  DottedName,
} from "../../../../framework/foundation/mod.ts"
import { Principal } from "../../../../framework/modules/auth/mod.ts"
import type { AuthorizationDenied } from "../../../../framework/modules/authorization/mod.ts"
import type { PostEntryFailure } from "../../accounting/mod.ts"
import type { ProductNotFound } from "../../product/mod.ts"
import type { Item } from "./contract.ts"
import type {
  InventoryReferenceNotFound,
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
    input: unknown,
  ) => Effect.Effect<Item, ProductNotFound | StockNotStockable | CommonFailure>
  readonly receiveValued: (input: unknown) => Effect.Effect<ValuedStockMovement, MovementFailure>
  readonly issueValued: (input: unknown) => Effect.Effect<ValuedStockMovement, MovementFailure>
  readonly countStock: (input: unknown) => Effect.Effect<ValuedStockMovement, MovementFailure>
  readonly valuation: (input: unknown) => Effect.Effect<StockValuation, CommonFailure>
}

export const StockKeepingService = Context.Service<StockKeepingService>(
  "RITSEI/StockKeepingService",
)
