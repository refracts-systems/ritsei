import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import {
  BrowserConnection,
  decodeInput,
  decodeResponse,
  definedFields,
  mutationRequest,
  querySuffix,
  RequestFailure,
  requestJson,
  responseListMatches,
  responseMatches,
  routeWithId,
} from "../../shared/api.ts"
import {
  CreateSupplierAccountInput,
  GoodsReceipt,
  ListPurchaseOrdersInput,
  ListPurchaseReceiptsInput,
  ListSupplierAccountsInput,
  procurementRoutes,
  PurchaseOrder,
  SupplierAccount,
} from "../../shared/contracts/generated/procurement.ts"

const Uuid = Schema.String.check(Schema.isUUID())
const SupplierAccountList = Schema.Array(SupplierAccount).check(Schema.isMaxLength(200))
const PurchaseOrderList = Schema.Array(PurchaseOrder).check(Schema.isMaxLength(200))
const GoodsReceiptList = Schema.Array(GoodsReceipt).check(Schema.isMaxLength(200))

export const listSupplierAccounts = Effect.fn("Frontend.Procurement.listSupplierAccounts")(
  function* (input: Schema.Codec.Encoded<typeof ListSupplierAccountsInput> = {}) {
    const decoded = yield* decodeInput(ListSupplierAccountsInput, input)

    const body = yield* requestJson(
      `${procurementRoutes.listSupplierAccounts}${querySuffix(decoded)}`,
    )

    const accounts = yield* decodeResponse(SupplierAccountList, body, "invalid-response")
    const connection = yield* BrowserConnection

    if (!responseListMatches(accounts, { tenantId: connection.tenantId })) {
      return yield* Effect.fail(new RequestFailure({ kind: "invalid-response" }))
    }

    return accounts
  },
)

export const createSupplierAccount = Effect.fn("Frontend.Procurement.createSupplierAccount")(
  function* (input: Schema.Codec.Encoded<typeof CreateSupplierAccountInput>) {
    const decoded = yield* decodeInput(CreateSupplierAccountInput, input)
    const connection = yield* BrowserConnection
    const body = yield* mutationRequest(procurementRoutes.createSupplierAccount, "POST", decoded)
    const account = yield* decodeResponse(SupplierAccount, body, "unknown-outcome")

    if (
      !responseMatches(account, {
        tenantId: connection.tenantId,
        supplierRelationshipId: decoded.supplierRelationshipId,
      })
    ) {
      return yield* Effect.fail(new RequestFailure({ kind: "unknown-outcome" }))
    }

    return account
  },
)

export const listPurchaseOrders = Effect.fn("Frontend.Procurement.listPurchaseOrders")(function* (
  input: Schema.Codec.Encoded<typeof ListPurchaseOrdersInput> = {},
) {
  const decoded = yield* decodeInput(ListPurchaseOrdersInput, input)
  const body = yield* requestJson(`${procurementRoutes.listPurchaseOrders}${querySuffix(decoded)}`)
  const orders = yield* decodeResponse(PurchaseOrderList, body, "invalid-response")
  const connection = yield* BrowserConnection

  if (
    !responseListMatches(orders, {
      tenantId: connection.tenantId,
      ...definedFields({
        supplierAccountId: decoded.supplierAccountId,
        status: decoded.status,
      }),
    })
  ) {
    return yield* Effect.fail(new RequestFailure({ kind: "invalid-response" }))
  }

  return orders
})

export const getPurchaseOrder = Effect.fn("Frontend.Procurement.getPurchaseOrder")(function* (
  id: Schema.Codec.Encoded<typeof Uuid>,
) {
  const decodedId = yield* decodeInput(Uuid, id)
  const connection = yield* BrowserConnection
  const body = yield* requestJson(routeWithId(procurementRoutes.getPurchaseOrder, decodedId))
  const order = yield* decodeResponse(PurchaseOrder, body, "invalid-response")

  if (
    !responseMatches(order, {
      id: decodedId,
      tenantId: connection.tenantId,
    })
  ) {
    return yield* Effect.fail(new RequestFailure({ kind: "invalid-response" }))
  }

  return order
})

// Fallow: confirm and cancel are paired lifecycle adapters with the same verified mutation shape.
// fallow-ignore-next-line code-duplication
export const cancelPurchaseOrder = Effect.fn("Frontend.Procurement.cancelPurchaseOrder")(function* (
  id: Schema.Codec.Encoded<typeof Uuid>,
) {
  const decodedId = yield* decodeInput(Uuid, id)
  const connection = yield* BrowserConnection

  const body = yield* mutationRequest(
    routeWithId(procurementRoutes.cancelPurchaseOrder, decodedId),
    "POST",
  )

  const order = yield* decodeResponse(PurchaseOrder, body, "unknown-outcome")

  if (
    !responseMatches(order, {
      id: decodedId,
      tenantId: connection.tenantId,
      status: "cancelled",
    })
  ) {
    return yield* Effect.fail(new RequestFailure({ kind: "unknown-outcome" }))
  }

  return order
})

export const listPurchaseReceipts = Effect.fn("Frontend.Procurement.listPurchaseReceipts")(
  function* (
    id: Schema.Codec.Encoded<typeof Uuid>,
    input: Schema.Codec.Encoded<typeof ListPurchaseReceiptsInput> = {},
  ) {
    const decodedId = yield* decodeInput(Uuid, id)
    const decoded = yield* decodeInput(ListPurchaseReceiptsInput, input)

    const body = yield* requestJson(
      `${routeWithId(procurementRoutes.listPurchaseReceipts, decodedId)}${querySuffix(decoded)}`,
    )

    const receipts = yield* decodeResponse(GoodsReceiptList, body, "invalid-response")
    const connection = yield* BrowserConnection

    if (
      !responseListMatches(receipts, {
        tenantId: connection.tenantId,
        purchaseOrderId: decodedId,
      })
    ) {
      return yield* Effect.fail(new RequestFailure({ kind: "invalid-response" }))
    }

    return receipts
  },
)
