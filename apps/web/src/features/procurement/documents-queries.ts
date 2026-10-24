import { useMutation, useQueryClient } from "@tanstack/solid-query"
import type { RequestFailure } from "../../shared/api.ts"
import { type ApiScope, runRequest } from "../../shared/runtime.ts"
import { createServerQuery, serverQueryKey } from "../../shared/server-query.ts"
import {
  draftPurchaseOrder,
  getPurchaseMatching,
  listSupplierPrices,
  type PricedPurchaseOrder,
  type PurchaseMatching,
  receiveValued,
  releasePurchaseOrder,
  returnToSupplier,
  setSupplierPrice,
  type SupplierPrice,
} from "./documents.ts"

const procurementKey = ["procurement"] as const

export function createPurchaseMatchingQuery(scope: ApiScope, id: string) {
  return createServerQuery<PurchaseMatching, RequestFailure>({
    tenantId: scope.tenantId,
    key: [...procurementKey, "matching", id],
    cache: "detail",
    load: ({ signal }) => runRequest(scope, getPurchaseMatching(id), signal),
  })
}

const refresh = (client: ReturnType<typeof useQueryClient>, scope: ApiScope) =>
  client.invalidateQueries({ queryKey: serverQueryKey(scope.tenantId, procurementKey) })

export function createDraftPurchaseOrderMutation(
  scope: ApiScope,
  afterSuccess?: (order: PricedPurchaseOrder) => void,
) {
  const client = useQueryClient()

  return useMutation<PricedPurchaseOrder, RequestFailure, Parameters<typeof draftPurchaseOrder>[0]>(
    () => ({
      mutationFn: (input) => runRequest(scope, draftPurchaseOrder(input)),
      onSuccess: async (order) => {
        await refresh(client, scope)
        afterSuccess?.(order)
      },
    }),
  )
}

export function createReleaseMutation(scope: ApiScope, id: string) {
  const client = useQueryClient()

  return useMutation<PurchaseMatching, RequestFailure, void>(() => ({
    mutationFn: () => runRequest(scope, releasePurchaseOrder(id)),
    onSuccess: () => refresh(client, scope),
  }))
}

type StockInput = Parameters<typeof receiveValued>[0]

export function createStockMutation(
  scope: ApiScope,
  kind: "receipt" | "return",
  afterSuccess?: () => void,
) {
  const client = useQueryClient()

  return useMutation<unknown, RequestFailure, StockInput>(() => ({
    mutationFn: (input) =>
      runRequest(scope, kind === "receipt" ? receiveValued(input) : returnToSupplier(input)),
    onSuccess: async () => {
      await refresh(client, scope)
      afterSuccess?.()
    },
  }))
}

export function createSupplierPricesQuery(scope: ApiScope, supplierAccountId: string) {
  return createServerQuery<readonly SupplierPrice[], RequestFailure>({
    tenantId: scope.tenantId,
    key: [...procurementKey, "supplier_prices", supplierAccountId],
    cache: "collection",
    load: ({ signal }) => runRequest(scope, listSupplierPrices(supplierAccountId), signal),
  })
}

export function createSetPriceMutation(scope: ApiScope) {
  const client = useQueryClient()

  return useMutation<SupplierPrice, RequestFailure, Parameters<typeof setSupplierPrice>[0]>(() => ({
    mutationFn: (input) => runRequest(scope, setSupplierPrice(input)),
    onSuccess: () => refresh(client, scope),
  }))
}
