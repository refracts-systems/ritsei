import { useMutation, useQueryClient } from "@tanstack/solid-query"
import { type RequestFailure } from "../../shared/api.ts"
import { type ApiScope, runRequest } from "../../shared/runtime.ts"
import { createServerQuery, serverQueryKey } from "../../shared/server-query.ts"
import { createTaxCode, type TaxCode, listTaxCodes } from "./service.ts"

const taxCodesKey = ["tax", "tax_codes"] as const

export function createTaxCodesQuery(scope: ApiScope) {
  return createServerQuery<readonly TaxCode[], RequestFailure>({
    tenantId: scope.tenantId,
    key: taxCodesKey,
    cache: "collection",
    load: ({ signal }) => runRequest(scope, listTaxCodes(), signal),
  })
}

export function createTaxCodeMutation(scope: ApiScope, afterSuccess?: () => void) {
  const client = useQueryClient()
  return useMutation<TaxCode, RequestFailure, Parameters<typeof createTaxCode>[0]>(() => ({
    mutationFn: (input) => runRequest(scope, createTaxCode(input)),
    onSuccess: () => {
      afterSuccess?.()
      return client.invalidateQueries({ queryKey: serverQueryKey(scope.tenantId, taxCodesKey) })
    },
  }))
}
