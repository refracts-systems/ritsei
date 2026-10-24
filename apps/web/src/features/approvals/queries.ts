import { useMutation, useQueryClient } from "@tanstack/solid-query"
import * as Effect from "effect/Effect"
import type { RequestFailure } from "../../shared/api.ts"
import type { UserAccount } from "../../shared/contracts/generated/identity.ts"
import { type ApiScope, runRequest } from "../../shared/runtime.ts"
import { createServerQuery, serverQueryKey } from "../../shared/server-query.ts"
import {
  type ApprovalRequest,
  type ApprovalStatus,
  type Decision,
  decideApproval,
  listApprovals,
  listUserAccounts,
} from "./service.ts"

const approvalsKey = ["approvals"] as const

export function createApprovalsQuery(scope: ApiScope, status: ApprovalStatus | undefined) {
  return createServerQuery<readonly ApprovalRequest[], RequestFailure>({
    tenantId: scope.tenantId,
    key: [...approvalsKey, "requests", status ?? "all"],
    cache: "collection",
    load: ({ signal }) =>
      runRequest(scope, listApprovals(status === undefined ? {} : { status }), signal),
  })
}

export function createUserAccountsQuery(scope: ApiScope) {
  return createServerQuery<readonly UserAccount[], RequestFailure>({
    tenantId: scope.tenantId,
    key: [...approvalsKey, "user_accounts"],
    cache: "lookup",
    // E-mail addresses are a convenience: without access to accounts, identifiers stay.
    load: ({ signal }) =>
      runRequest(scope, listUserAccounts().pipe(Effect.catch(() => Effect.succeed([]))), signal),
  })
}

export function createDecisionMutation(scope: ApiScope) {
  const client = useQueryClient()

  return useMutation<ApprovalRequest, RequestFailure, { id: string; decision: Decision }>(() => ({
    mutationFn: ({ id, decision }) => runRequest(scope, decideApproval(id, decision)),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: serverQueryKey(scope.tenantId, approvalsKey) }),
  }))
}
