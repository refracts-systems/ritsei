import { useMutation, useQueryClient } from "@tanstack/solid-query"
import { type RequestFailure } from "../../shared/api.ts"
import type { CustomFieldDefinition, CustomFieldValues } from "../../shared/custom-field-values.ts"
import { type ApiScope, runRequest } from "../../shared/runtime.ts"
import { createServerQuery, serverQueryKey } from "../../shared/server-query.ts"
import {
  createProduct,
  getProduct,
  getProductFieldValues,
  listProductFields,
  listProducts,
  type Product,
  setProductFieldValues,
} from "./service.ts"

const productsKey = ["product", "products"] as const
const productKey = (id: string) => ["product", "detail", id] as const
const fieldValuesKey = (id: string) => ["product", "field_values", id] as const

export function createProductsQuery(scope: ApiScope) {
  return createServerQuery<readonly Product[], RequestFailure>({
    tenantId: scope.tenantId,
    key: productsKey,
    cache: "collection",
    load: ({ signal }) => runRequest(scope, listProducts(), signal),
  })
}

export function createProductMutation(scope: ApiScope, afterSuccess?: () => void) {
  const client = useQueryClient()

  return useMutation<Product, RequestFailure, Parameters<typeof createProduct>[0]>(() => ({
    mutationFn: (input) => runRequest(scope, createProduct(input)),
    onSuccess: () => {
      afterSuccess?.()

      return client.invalidateQueries({ queryKey: serverQueryKey(scope.tenantId, productsKey) })
    },
  }))
}

export function createProductQuery(scope: ApiScope, id: string) {
  return createServerQuery<Product, RequestFailure>({
    tenantId: scope.tenantId,
    key: productKey(id),
    cache: "detail",
    load: ({ signal }) => runRequest(scope, getProduct(id), signal),
  })
}

export function createProductFieldsQuery(scope: ApiScope) {
  return createServerQuery<readonly CustomFieldDefinition[], RequestFailure>({
    tenantId: scope.tenantId,
    key: ["product", "fields"],
    load: ({ signal }) => runRequest(scope, listProductFields(), signal),
  })
}

export function createProductFieldValuesQuery(scope: ApiScope, id: string) {
  return createServerQuery<CustomFieldValues, RequestFailure>({
    tenantId: scope.tenantId,
    key: fieldValuesKey(id),
    cache: "detail",
    load: ({ signal }) => runRequest(scope, getProductFieldValues(id), signal),
  })
}

export function createSetProductFieldValuesMutation(scope: ApiScope, afterSuccess: () => void) {
  const client = useQueryClient()

  return useMutation<
    CustomFieldValues,
    RequestFailure,
    Parameters<typeof setProductFieldValues>[0]
  >(() => ({
    mutationFn: (input) => runRequest(scope, setProductFieldValues(input)),
    onSuccess: async (values, input) => {
      const queryKey = serverQueryKey(scope.tenantId, fieldValuesKey(input.productId))

      await client.cancelQueries({ queryKey })
      client.setQueryData(queryKey, values)
      afterSuccess()
    },
  }))
}
