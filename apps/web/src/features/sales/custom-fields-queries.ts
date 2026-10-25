import { useMutation, useQueryClient } from "@tanstack/solid-query"
import type { RequestFailure } from "../../shared/api.ts"
import { type ApiScope, runRequest } from "../../shared/runtime.ts"
import { createServerQuery, serverQueryKey } from "../../shared/server-query.ts"
import {
  type CustomFieldDefinition,
  type CustomFieldValues,
  defineCustomerField,
  getCustomerFieldValues,
  listCustomerFields,
  setCustomerFieldValues,
} from "./custom-fields.ts"

const salesKey = ["sales"] as const

export function createCustomerFieldsQuery(scope: ApiScope) {
  return createServerQuery<readonly CustomFieldDefinition[], RequestFailure>({
    tenantId: scope.tenantId,
    key: [...salesKey, "customer_fields"],
    cache: "collection",
    load: ({ signal }) => runRequest(scope, listCustomerFields(), signal),
  })
}

export function createCustomerFieldValuesQuery(scope: ApiScope, customerId: string) {
  return createServerQuery<CustomFieldValues, RequestFailure>({
    tenantId: scope.tenantId,
    key: [...salesKey, "customer_field_values", customerId],
    cache: "detail",
    load: ({ signal }) => runRequest(scope, getCustomerFieldValues(customerId), signal),
  })
}

const refresh = (client: ReturnType<typeof useQueryClient>, scope: ApiScope) =>
  client.invalidateQueries({ queryKey: serverQueryKey(scope.tenantId, salesKey) })

export function createDefineFieldMutation(scope: ApiScope, afterSuccess?: () => void) {
  const client = useQueryClient()

  return useMutation<
    CustomFieldDefinition,
    RequestFailure,
    Parameters<typeof defineCustomerField>[0]
  >(() => ({
    mutationFn: (input) => runRequest(scope, defineCustomerField(input)),
    onSuccess: async () => {
      await refresh(client, scope)
      afterSuccess?.()
    },
  }))
}

export function createSetFieldValuesMutation(scope: ApiScope, afterSuccess?: () => void) {
  const client = useQueryClient()

  return useMutation<
    CustomFieldValues,
    RequestFailure,
    Parameters<typeof setCustomerFieldValues>[0]
  >(() => ({
    mutationFn: (input) => runRequest(scope, setCustomerFieldValues(input)),
    onSuccess: async () => {
      await refresh(client, scope)
      afterSuccess?.()
    },
  }))
}
