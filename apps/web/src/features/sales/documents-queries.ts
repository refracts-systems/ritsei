import { useMutation, useQueryClient } from "@tanstack/solid-query"
import type { RequestFailure } from "../../shared/api.ts"
import { type ApiScope, runRequest } from "../../shared/runtime.ts"
import { createServerQuery, serverQueryKey } from "../../shared/server-query.ts"
import {
  advanceQuotation,
  deliverOrder,
  draftQuotation,
  getOrderFulfillment,
  getQuotationDocument,
  type OrderFulfillment,
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
