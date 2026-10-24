import * as Effect from "effect/Effect"
import { type RequestFailure } from "../../shared/api.ts"
import type { AccountingConfiguration } from "../../shared/contracts/generated/accounting.ts"
import type { PartyDirectoryEntry } from "../../shared/contracts/generated/party.ts"
import { type ApiScope, runRequest } from "../../shared/runtime.ts"
import { createServerQuery } from "../../shared/server-query.ts"
import {
  type BillingDocument,
  getBillingDocument,
  listBillingDocuments,
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
