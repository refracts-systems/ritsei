import { useMutation, useQueryClient } from "@tanstack/solid-query"
import * as Effect from "effect/Effect"
import { type RequestFailure } from "../../shared/api.ts"
import type { AccountingConfiguration } from "../../shared/contracts/generated/accounting.ts"
import type { PurchaseOrder } from "../../shared/contracts/generated/procurement.ts"
import type { Customer, SalesOrder } from "../../shared/contracts/generated/sales.ts"
import { type ApiScope, runRequest } from "../../shared/runtime.ts"
import { createServerQuery, serverQueryKey } from "../../shared/server-query.ts"
import {
  type BillingDocument,
  type OrderMatching,
  type RecordedPayment,
  billPurchaseOrder,
  getBillingDocument,
  getOrderMatching,
  invoiceSalesOrder,
  listBillingDocuments,
  listConfirmedOrders,
  listReleasedOrders,
  listCustomers,
  recordPayment,
  listLegalEntities,
} from "./service.ts"

const billingKey = ["billing"] as const

export function createLegalEntitiesQuery(scope: ApiScope) {
  return createServerQuery<readonly AccountingConfiguration[], RequestFailure>({
    tenantId: scope.tenantId,
    key: [...billingKey, "legal_entities"],
    cache: "lookup",
    load: ({ signal }) => runRequest(scope, listLegalEntities(), signal),
  })
}

export function createBillingDocumentsQuery(
  scope: ApiScope,
  input: Parameters<typeof listBillingDocuments>[0],
) {
  return createServerQuery<readonly BillingDocument[], RequestFailure>({
    tenantId: scope.tenantId,
    key: [...billingKey, "documents", input],
    cache: "collection",
    load: ({ signal }) => runRequest(scope, listBillingDocuments(input), signal),
  })
}

export function createBillingDocumentQuery(scope: ApiScope, id: string) {
  return createServerQuery<BillingDocument, RequestFailure>({
    tenantId: scope.tenantId,
    key: [...billingKey, "document", id],
    cache: "detail",
    load: ({ signal }) => runRequest(scope, getBillingDocument(id), signal),
  })
}

export function createConfirmedOrdersQuery(scope: ApiScope) {
  return createServerQuery<readonly SalesOrder[], RequestFailure>({
    tenantId: scope.tenantId,
    key: [...billingKey, "confirmed_orders"],
    cache: "collection",
    load: ({ signal }) => runRequest(scope, listConfirmedOrders(), signal),
  })
}

export function createCustomersQuery(scope: ApiScope) {
  return createServerQuery<readonly Customer[], RequestFailure>({
    tenantId: scope.tenantId,
    key: [...billingKey, "customers"],
    cache: "lookup",
    load: ({ signal }) =>
      runRequest(scope, listCustomers().pipe(Effect.catch(() => Effect.succeed([]))), signal),
  })
}

export function createInvoiceMutation(scope: ApiScope, afterSuccess?: (id: string) => void) {
  const client = useQueryClient()

  return useMutation<BillingDocument, RequestFailure, Parameters<typeof invoiceSalesOrder>[0]>(
    () => ({
      mutationFn: (input) => runRequest(scope, invoiceSalesOrder(input)),
      onSuccess: async (document) => {
        await client.invalidateQueries({ queryKey: serverQueryKey(scope.tenantId, billingKey) })
        afterSuccess?.(document.id)
      },
    }),
  )
}

export function createPaymentMutation(scope: ApiScope, afterSuccess?: () => void) {
  const client = useQueryClient()

  return useMutation<RecordedPayment, RequestFailure, Parameters<typeof recordPayment>[0]>(() => ({
    mutationFn: (input) => runRequest(scope, recordPayment(input)),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: serverQueryKey(scope.tenantId, billingKey) })
      afterSuccess?.()
    },
  }))
}

export function createReleasedOrdersQuery(scope: ApiScope) {
  return createServerQuery<readonly PurchaseOrder[], RequestFailure>({
    tenantId: scope.tenantId,
    key: [...billingKey, "released_orders"],
    cache: "collection",
    load: ({ signal }) => runRequest(scope, listReleasedOrders(), signal),
  })
}

export function createOrderMatchingQuery(scope: ApiScope, id: string) {
  return createServerQuery<OrderMatching, RequestFailure>({
    tenantId: scope.tenantId,
    key: [...billingKey, "order_matching", id],
    cache: "detail",
    load: ({ signal }) => runRequest(scope, getOrderMatching(id), signal),
  })
}

export function createBillMutation(scope: ApiScope, afterSuccess?: (id: string) => void) {
  const client = useQueryClient()

  return useMutation<BillingDocument, RequestFailure, Parameters<typeof billPurchaseOrder>[0]>(
    () => ({
      mutationFn: (input) => runRequest(scope, billPurchaseOrder(input)),
      onSuccess: async (document) => {
        await client.invalidateQueries({ queryKey: serverQueryKey(scope.tenantId, billingKey) })
        afterSuccess?.(document.id)
      },
    }),
  )
}
