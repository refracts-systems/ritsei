import { useMutation, useQueryClient } from "@tanstack/solid-query"
import { type RequestFailure } from "../../shared/api.ts"
import { type ApiScope, runRequest } from "../../shared/runtime.ts"
import { createServerQuery, serverQueryKey } from "../../shared/server-query.ts"
import { createProduct, type Product, listProducts } from "./service.ts"

const productsKey = ["product", "products"] as const

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
