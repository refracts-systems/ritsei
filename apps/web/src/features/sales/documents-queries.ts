import { useMutation, useQueryClient } from "@tanstack/solid-query"
import * as Effect from "effect/Effect"
import type { RequestFailure } from "../../shared/api.ts"
import type { Warehouse } from "../../shared/contracts/generated/inventory.ts"
import { type ApiScope, runRequest } from "../../shared/runtime.ts"
import { createServerQuery, serverQueryKey } from "../../shared/server-query.ts"
import {
  advanceQuotation,
  deliverOrder,
  draftQuotation,
  getOrderFulfillment,
  getQuotationDocument,
  listProducts,
  listWarehouses,
  type OrderFulfillment,
  type Product,
  type QuotationAction,
  type QuotationActionResult,
  type QuotationDocument,
} from "./documents.ts"

const salesKey = ["sales"] as const

export function createQuotationDocumentQuery(scope: ApiScope, id: string) {
  return createServerQuery<QuotationDocument, RequestFailure>({
    tenantId: scope.tenantId,
    key: [...salesKey, "quotation_document", id],
    cache: "detail",
    load: ({ signal }) => runRequest(scope, getQuotationDocument(id), signal),
  })
}

export function createOrderFulfillmentQuery(scope: ApiScope, orderId: string) {
  return createServerQuery<OrderFulfillment, RequestFailure>({
    tenantId: scope.tenantId,
    key: [...salesKey, "fulfillment", orderId],
    cache: "detail",
    load: ({ signal }) => runRequest(scope, getOrderFulfillment(orderId), signal),
  })
}

export function createProductsQuery(scope: ApiScope) {
  return createServerQuery<readonly Product[], RequestFailure>({
    tenantId: scope.tenantId,
    key: [...salesKey, "products"],
    cache: "lookup",
    // Product names are a convenience: without product access the list stays empty.
    load: ({ signal }) =>
      runRequest(scope, listProducts().pipe(Effect.catch(() => Effect.succeed([]))), signal),
  })
}

export function createWarehousesQuery(scope: ApiScope) {
  return createServerQuery<readonly Warehouse[], RequestFailure>({
    tenantId: scope.tenantId,
    key: [...salesKey, "warehouses"],
    cache: "lookup",
    load: ({ signal }) => runRequest(scope, listWarehouses(), signal),
  })
}

const refresh = (client: ReturnType<typeof useQueryClient>, scope: ApiScope) =>
  client.invalidateQueries({ queryKey: serverQueryKey(scope.tenantId, salesKey) })

export function createDraftQuotationMutation(
  scope: ApiScope,
  afterSuccess?: (quotation: QuotationDocument) => void,
) {
  const client = useQueryClient()

  return useMutation<QuotationDocument, RequestFailure, Parameters<typeof draftQuotation>[0]>(
    () => ({
      mutationFn: (input) => runRequest(scope, draftQuotation(input)),
      onSuccess: async (quotation) => {
        await refresh(client, scope)
        afterSuccess?.(quotation)
      },
    }),
  )
}

export function createQuotationActionMutation(
  scope: ApiScope,
  id: string,
  afterSuccess?: (result: QuotationActionResult) => void,
) {
  const client = useQueryClient()

  return useMutation<QuotationActionResult, RequestFailure, QuotationAction>(() => ({
    mutationFn: (action) => runRequest(scope, advanceQuotation(id, action)),
    onSuccess: async (result) => {
      await refresh(client, scope)
      afterSuccess?.(result)
    },
  }))
}

export function createDeliveryMutation(scope: ApiScope, afterSuccess?: () => void) {
  const client = useQueryClient()

  return useMutation<unknown, RequestFailure, Parameters<typeof deliverOrder>[0]>(() => ({
    mutationFn: (input) => runRequest(scope, deliverOrder(input)),
    onSuccess: async () => {
      await refresh(client, scope)
      afterSuccess?.()
    },
  }))
}
