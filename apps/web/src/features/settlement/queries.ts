import * as Effect from "effect/Effect"
import type { RequestFailure } from "../../shared/api.ts"
import type { AccountingConfiguration } from "../../shared/contracts/generated/accounting.ts"
import type { PartyDirectoryEntry } from "../../shared/contracts/generated/party.ts"
import { type ApiScope, runRequest } from "../../shared/runtime.ts"
import { createServerQuery } from "../../shared/server-query.ts"
import {
  type AgingReport,
  type CustomerStatement,
  getAging,
  getStatement,
  listDocumentNumbers,
  listLegalEntities,
  listPartyDirectory,
  listPayments,
  type Payment,
} from "./service.ts"

const settlementKey = ["settlement"] as const

export function createLegalEntitiesQuery(scope: ApiScope) {
  return createServerQuery<readonly AccountingConfiguration[], RequestFailure>({
    tenantId: scope.tenantId,
    key: [...settlementKey, "legal_entities"],
    cache: "lookup",
    load: ({ signal }) => runRequest(scope, listLegalEntities(), signal),
  })
}

export function createPartyDirectoryQuery(scope: ApiScope) {
  return createServerQuery<readonly PartyDirectoryEntry[], RequestFailure>({
    tenantId: scope.tenantId,
    key: [...settlementKey, "party_directory"],
    cache: "lookup",
    // Names are a convenience: if the directory cannot load, payments still show identifiers.
    load: ({ signal }) =>
      runRequest(scope, listPartyDirectory().pipe(Effect.catch(() => Effect.succeed([]))), signal),
  })
}

export function createDocumentNumbersQuery(
  scope: ApiScope,
  input: Parameters<typeof listDocumentNumbers>[0],
) {
  return createServerQuery<
    readonly { readonly id: string; readonly number: string; readonly partyId: string }[],
    RequestFailure
  >({
    tenantId: scope.tenantId,
    key: [...settlementKey, "document_numbers", input],
    cache: "collection",
    // Numbers are a convenience: a missing billing permission leaves identifiers in place.
    load: ({ signal }) =>
      runRequest(
        scope,
        listDocumentNumbers(input).pipe(Effect.catch(() => Effect.succeed([]))),
        signal,
      ),
  })
}

export function createPaymentsQuery(scope: ApiScope, input: Parameters<typeof listPayments>[0]) {
  return createServerQuery<readonly Payment[], RequestFailure>({
    tenantId: scope.tenantId,
    key: [...settlementKey, "payments", input],
    cache: "collection",
    load: ({ signal }) => runRequest(scope, listPayments(input), signal),
  })
}

export function createAgingQuery(scope: ApiScope, input: Parameters<typeof getAging>[0]) {
  return createServerQuery<AgingReport, RequestFailure>({
    tenantId: scope.tenantId,
    key: [...settlementKey, "aging", input],
    cache: "collection",
    load: ({ signal }) => runRequest(scope, getAging(input), signal),
  })
}

export function createStatementQuery(scope: ApiScope, input: Parameters<typeof getStatement>[0]) {
  return createServerQuery<CustomerStatement, RequestFailure>({
    tenantId: scope.tenantId,
    key: [...settlementKey, "statement", input],
    cache: "collection",
    load: ({ signal }) => runRequest(scope, getStatement(input), signal),
  })
}
