// HTTP adapter for this module (ADR-0094). Only the composition root imports this file.
import * as Effect from "effect/Effect"
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder"
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint"
import * as HttpApiGroup from "effect/http-api/HttpApiGroup"

import {
  ApiErrors,
  BaseApiErrorPolicy,
  BearerAuth,
  CurrentPrincipal,
  TenantHeaders,
  Uuid,
  apiErrorMapping,
  moduleApi,
} from "../../../framework/modules/http/mod.ts"
import { DocumentChain, DocumentsService, FlowEntryType } from "./mod.ts"

export const DocumentsHttpGroup = HttpApiGroup.make("Documents").add(
  HttpApiEndpoint.get("documentChain", "/documents/chain", {
    headers: TenantHeaders,
    query: { documentType: FlowEntryType, documentId: Uuid },
    success: DocumentChain,
    error: ApiErrors,
  }).middleware(BearerAuth),
)

const DocumentsHttpApi = moduleApi(DocumentsHttpGroup)

export const DocumentsHttpErrors = apiErrorMapping({
  ...BaseApiErrorPolicy,
  DocumentNotFound: "not_found",
})

export const DocumentsHttpHandlers = HttpApiBuilder.group(
  DocumentsHttpApi,
  "Documents",
  (handlers) =>
    Effect.gen(function* () {
      const documents = yield* DocumentsService

      return handlers.handle(
        "documentChain",
        Effect.fn("Http.Documents.documentChain")(function* ({ headers, query }) {
          const principal = yield* CurrentPrincipal

          return yield* DocumentsHttpErrors.apiEffect(
            documents.chain({ principal, tenantId: headers["x-tenant-id"], ...query }),
          )
        }),
      )
    }),
)
