import type { RequestFailure } from "../../shared/api.ts"
import { type ApiScope, runRequest } from "../../shared/runtime.ts"
import { createServerQuery } from "../../shared/server-query.ts"
import { type DocumentChain, type FlowEntryType, loadDocumentChain } from "./service.ts"

export interface ChainRequest {
  readonly documentType: FlowEntryType
  readonly documentId: string
  /** The feature whose commands change the chain, so its invalidation reads the chain again. */
  readonly feature: "billing" | "procurement" | "sales"
}

export function createDocumentChainQuery(scope: ApiScope, request: ChainRequest, attempt: number) {
  return createServerQuery<DocumentChain, RequestFailure>({
    tenantId: scope.tenantId,
    // A retry is a new attempt, so a failed read is never served from the cache again.
    key: [request.feature, "document_flow", request.documentType, request.documentId, attempt],
    cache: "detail",
    load: ({ signal }) =>
      runRequest(
        scope,
        loadDocumentChain({ documentType: request.documentType, documentId: request.documentId }),
        signal,
      ),
  })
}
