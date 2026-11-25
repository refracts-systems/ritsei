// HTTP adapter for this module (ADR-0094). Only the composition root imports this file.
import * as Effect from "effect/Effect"
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder"
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint"
import * as HttpApiGroup from "effect/http-api/HttpApiGroup"

import * as Schema from "effect/Schema"

import { TrimmedText } from "../../../framework/foundation/mod.ts"
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
import {
  DocumentChain,
  DocumentsService,
  FlowEntryType,
  Lookup,
  Pipeline,
  SerialTrace,
} from "./mod.ts"

export const DocumentsHttpGroup = HttpApiGroup.make("Documents")
  .add(
    HttpApiEndpoint.get("documentChain", "/documents/chain", {
      headers: TenantHeaders,
      query: { documentType: FlowEntryType, documentId: Uuid },
      success: DocumentChain,
      error: ApiErrors,
    }).middleware(BearerAuth),
  )
  .add(
    HttpApiEndpoint.get("documentLookup", "/documents/lookup", {
      headers: TenantHeaders,
      query: { number: TrimmedText(64) },
      success: Lookup,
      error: ApiErrors,
    }).middleware(BearerAuth),
  )
  .add(
    HttpApiEndpoint.get("documentSerial", "/documents/serial", {
      headers: TenantHeaders,
      query: { serial: TrimmedText(64) },
      success: Schema.Array(SerialTrace),
      error: ApiErrors,
    }).middleware(BearerAuth),
  )
  .add(
    HttpApiEndpoint.get("documentPipeline", "/documents/pipeline", {
      headers: TenantHeaders,
      query: { legalEntityId: Uuid },
      success: Pipeline,
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

      return handlers
        .handle(
          "documentChain",
          Effect.fn("Http.Documents.documentChain")(function* ({ headers, query }) {
            const principal = yield* CurrentPrincipal

            return yield* DocumentsHttpErrors.apiEffect(
              documents.chain({ principal, tenantId: headers["x-tenant-id"], ...query }),
            )
          }),
        )
        .handle(
          "documentLookup",
          Effect.fn("Http.Documents.documentLookup")(function* ({ headers, query }) {
            const principal = yield* CurrentPrincipal

            return yield* DocumentsHttpErrors.apiEffect(
              documents.lookup({ principal, tenantId: headers["x-tenant-id"], ...query }),
            )
          }),
        )
        .handle(
          "documentSerial",
          Effect.fn("Http.Documents.documentSerial")(function* ({ headers, query }) {
            const principal = yield* CurrentPrincipal

            return yield* DocumentsHttpErrors.apiEffect(
              documents.serialLookup({ principal, tenantId: headers["x-tenant-id"], ...query }),
            )
          }),
        )
        .handle(
          "documentPipeline",
          Effect.fn("Http.Documents.documentPipeline")(function* ({ headers, query }) {
            const principal = yield* CurrentPrincipal

            return yield* DocumentsHttpErrors.apiEffect(
              documents.pipeline({ principal, tenantId: headers["x-tenant-id"], ...query }),
            )
          }),
        )
    }),
)
