import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import { Etag, HttpPlatform } from "effect/http"
import * as HttpApiMiddleware from "effect/http-api/HttpApiMiddleware"
import * as HttpApiTest from "effect/http-api/HttpApiTest"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"

import { partial } from "../../../tests/support/partial.ts"
import {
  DocumentNotFound,
  DocumentsService,
  type DocumentChainType,
  type DocumentsServiceContract,
} from "../../modules/documents/mod.ts"
import { DocumentsHttpHandlers } from "../../modules/documents/http.ts"
import { ApiNotFound, BearerAuth, CurrentPrincipal, RitseiApi } from "./api.ts"

const tenantId = "018f5000-0000-7000-8000-000000000001"
const orderId = "018f5000-0000-7000-8000-000000000003"
const missingId = "018f5000-0000-7000-8000-000000000004"
const principal = { userAccountId: "reader-user", sessionId: "reader-session" }

const chain: DocumentChainType = {
  legalEntityId: null,
  nodes: [
    {
      type: "sales.order",
      id: orderId,
      number: null,
      state: "confirmed",
      amount: "140.00",
      date: "2026-10-20",
      current: true,
    },
  ],
}

const TestHttpServices = Layer.mergeAll(Path.layer, Etag.layerWeak, HttpPlatform.layer).pipe(
  Layer.provideMerge(FileSystem.layerNoop({})),
)

it.layer(TestHttpServices)("document chain API contract", (it) => {
  it.effect("reads a chain for the caller's tenant and maps a missing document", () =>
    Effect.gen(function* () {
      const observed: unknown[] = []

      const bearer = Layer.succeed(BearerAuth, {
        bearer: (effect) => Effect.provideService(effect, CurrentPrincipal, principal),
      })

      const bearerClient = HttpApiMiddleware.layerClient(
        BearerAuth,
        ({ request: outgoing, next }) =>
          next(HttpClientRequest.bearerToken(outgoing, "documents-token")),
      )

      const documents = partial<DocumentsServiceContract>()({
        chain: (input: Parameters<DocumentsServiceContract["chain"]>[0]) =>
          input.documentId === missingId
            ? Effect.fail(
                new DocumentNotFound({
                  tenantId,
                  documentType: input.documentType,
                  documentId: input.documentId,
                }),
              )
            : Effect.sync(() => {
                observed.push(input)

                return chain
              }),
      })

      const handlers = DocumentsHttpHandlers.pipe(
        Layer.provide(bearer),
        Layer.provide(Layer.succeed(DocumentsService, documents)),
      )

      const client = yield* HttpApiTest.groups(RitseiApi, ["Documents"]).pipe(
        Effect.provide(Layer.mergeAll(handlers, bearerClient, bearer)),
      )

      const headers = { "x-tenant-id": tenantId }

      assert.deepStrictEqual(
        yield* client.Documents.documentChain({
          headers,
          query: { documentType: "sales.order", documentId: orderId },
        }),
        chain,
      )
      assert.deepStrictEqual(observed, [
        { principal, tenantId, documentType: "sales.order", documentId: orderId },
      ])

      const absent = yield* Effect.flip(
        client.Documents.documentChain({
          headers,
          query: { documentType: "sales.order", documentId: missingId },
        }),
      )

      assert.instanceOf(absent, ApiNotFound)
    }),
  )
})
