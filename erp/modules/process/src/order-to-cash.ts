import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import {
  CalendarDate,
  Database,
  type DatabaseFailure,
  uuidv7,
} from "../../../../framework/foundation/mod.ts"
import { Principal } from "../../../../framework/modules/auth/mod.ts"
import type { AuthorizationDenied } from "../../../../framework/modules/authorization/mod.ts"
import type { PostEntryFailure } from "../../accounting/mod.ts"
import {
  type InventoryReferenceNotFound,
  StockKeepingService,
  type StockUnavailable,
  type StockValuationUnavailable,
  ValuedStockMovement,
} from "../../inventory/mod.ts"
import { ProductService, type ProductNotFound } from "../../product/mod.ts"
import {
  type CustomerLegalEntityRequired,
  Delivery,
  type DeliveryExceedsOrder,
  type OrderLineNotFound,
  SalesDocumentService,
  type SalesOrderInvalidState,
  type SalesOrderNotFound,
} from "../../sales/mod.ts"

const Uuid = Schema.String.check(Schema.isUUID())

export const DeliverOrderInput = Schema.Struct({
  principal: Principal,
  tenantId: Uuid,
  /** Client-chosen id that makes a retried delivery return the recorded one. */
  deliveryId: Schema.optionalKey(Uuid),
  orderId: Uuid,
  warehouseId: Uuid,
  deliveryDate: CalendarDate,
  lines: Schema.Array(
    Schema.Struct({
      orderLineId: Uuid,
      quantity: Schema.String.check(Schema.isPattern(/^[1-9]\d*$/)),
    }),
  ).check(Schema.isMinLength(1)),
})

export const OrderDelivery = Schema.Struct({
  delivery: Delivery,
  /** The valued stock issue for stockable products; null when only services were delivered. */
  stock: Schema.NullOr(ValuedStockMovement),
})
export type OrderDelivery = Schema.Schema.Type<typeof OrderDelivery>

export type DeliverOrderFailure =
  | SalesOrderNotFound
  | SalesOrderInvalidState
  | CustomerLegalEntityRequired
  | OrderLineNotFound
  | DeliveryExceedsOrder
  | ProductNotFound
  | InventoryReferenceNotFound
  | StockUnavailable
  | StockValuationUnavailable
  | PostEntryFailure
  | AuthorizationDenied
  | DatabaseFailure
  | Schema.SchemaError

/**
 * The Order-to-Cash composite commands (ADR-0101). Delivery records Sales' delivery evidence and
 * Inventory's valued stock issue in one transaction; each owner authorizes its own part.
 */
export interface OrderToCashService {
  readonly deliverOrder: (
    input: Schema.Codec.Encoded<typeof DeliverOrderInput>,
  ) => Effect.Effect<OrderDelivery, DeliverOrderFailure>
}

export const OrderToCashService = Context.Service<OrderToCashService>("RITSEI/OrderToCashService")

export const makeOrderToCashService = Effect.gen(function* () {
  const database = yield* Database
  const sales = yield* SalesDocumentService
  const stock = yield* StockKeepingService
  const products = yield* ProductService

  const deliverOrder = Effect.fn("OrderToCashService.deliverOrder")(function* (
    input: Schema.Codec.Encoded<typeof DeliverOrderInput>,
  ) {
    const decoded = yield* Schema.decodeUnknownEffect(DeliverOrderInput)(input)
    const scope = { principal: decoded.principal, tenantId: decoded.tenantId }
    return yield* database.withTransaction(
      Effect.gen(function* () {
        const delivery = yield* sales.recordDelivery({
          ...scope,
          deliveryId: decoded.deliveryId ?? uuidv7(),
          orderId: decoded.orderId,
          warehouseId: decoded.warehouseId,
          deliveryDate: decoded.deliveryDate,
          lines: decoded.lines,
        })
        const stockLines = []
        for (const line of delivery.lines) {
          const product = yield* products.getProduct({ ...scope, productId: line.productId })
          if (product.type === "stockable") {
            stockLines.push({ itemId: line.productId, quantity: line.quantity })
          }
        }
        // Inventory replays the recorded issue when the delivery is retried.
        const issued =
          stockLines.length === 0
            ? null
            : yield* stock.issueValued({
                ...scope,
                warehouseId: delivery.warehouseId,
                postingDate: delivery.deliveryDate,
                source: { type: "sales.delivery", id: delivery.id },
                counterRole: "cost_of_goods_sold",
                lines: stockLines,
              })
        return { delivery, stock: issued }
      }),
      "process.order_to_cash.deliver",
    )
  })

  return { deliverOrder } satisfies OrderToCashService
})

export const OrderToCashLive = Layer.effect(OrderToCashService, makeOrderToCashService)
