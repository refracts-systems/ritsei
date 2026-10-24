import { useMutation, useQueryClient } from "@tanstack/solid-query"
import * as Effect from "effect/Effect"
import { type RequestFailure } from "../../shared/api.ts"
import type { AccountingConfiguration } from "../../shared/contracts/generated/accounting.ts"
import type { PartyDirectoryEntry } from "../../shared/contracts/generated/party.ts"
import type { Customer, SalesOrder } from "../../shared/contracts/generated/sales.ts"
import { type ApiScope, runRequest } from "../../shared/runtime.ts"
import { createServerQuery, serverQueryKey } from "../../shared/server-query.ts"
import {
  type BillingDocument,
  type RecordedPayment,
  getBillingDocument,
  invoiceSalesOrder,
  listBillingDocuments,
  listConfirmedOrders,
  listCustomers,
  recordPayment,
  listLegalEntities,
  listPartyDirectory,
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

export function createPartyDirectoryQuery(scope: ApiScope) {
  return createServerQuery<readonly PartyDirectoryEntry[], RequestFailure>({
    tenantId: scope.tenantId,
    key: [...billingKey, "party_directory"],
    cache: "lookup",
    // Names are a convenience: if the directory cannot load, documents still show identifiers.
    load: ({ signal }) =>
      runRequest(scope, listPartyDirectory().pipe(Effect.catch(() => Effect.succeed([]))), signal),
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
