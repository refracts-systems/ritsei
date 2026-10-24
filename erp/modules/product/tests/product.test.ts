import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import { Etag, HttpPlatform } from "effect/http"
import * as HttpApiMiddleware from "effect/http-api/HttpApiMiddleware"
import * as HttpApiTest from "effect/http-api/HttpApiTest"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"

import {
  AuthorizationDenied,
  makeAuthorizationTestLayer,
} from "../../../../framework/modules/authorization/mod.ts"
import { BearerAuth, CurrentPrincipal, moduleApi } from "../../../../framework/modules/http/mod.ts"
import { validateModuleRegistry } from "../../../../framework/modules/module/mod.ts"
import { ProductHttpGroup, ProductHttpHandlers } from "../http.ts"
import {
  ProductAlreadyExists,
  makeProductTestLayer,
  ProductCapabilities,
  ProductModule,
  ProductService,
} from "../mod.ts"

const principal = { userAccountId: "product-user", sessionId: "product-session" }
const tenantId = "018f2000-0000-7000-8000-0000000000aa"

const grants = Object.values(ProductCapabilities).map((capability) => ({
  userAccountId: principal.userAccountId,
  tenantId,
  capability,
}))

const granted = makeProductTestLayer().pipe(Layer.provide(makeAuthorizationTestLayer(grants)))
const ungranted = makeProductTestLayer().pipe(Layer.provide(makeAuthorizationTestLayer([])))

const TestHttpServices = Layer.mergeAll(Path.layer, Etag.layerWeak, HttpPlatform.layer).pipe(
  Layer.provideMerge(FileSystem.layerNoop({})),
)

describe("product module", () => {
  it("declares a valid manifest", () => {
    assert.deepStrictEqual(validateModuleRegistry([ProductModule]), [])
  })

  it.effect("creates and lists tenant products with unique codes", () =>
    Effect.gen(function* () {
      const service = yield* ProductService

      const created = yield* service.createProduct({
        principal,
        tenantId,
        code: "sku-1",
        name: "First",
        type: "stockable",
      })

      assert.strictEqual(created.code, "SKU-1")
      assert.strictEqual(created.unitOfMeasure, "EA")
      assert.deepStrictEqual(yield* service.listProducts({ principal, tenantId }), [created])
      assert.deepStrictEqual(
        yield* service.getProduct({ principal, tenantId, productId: created.id }),
        created,
      )
      assert.deepStrictEqual(
        yield* service.listProducts({ principal, tenantId, type: "service" }),
        [],
      )

      const duplicate = yield* Effect.flip(
        service.createProduct({
          principal,
          tenantId,
          code: "sku-1",
          name: "First",
          type: "stockable",
        }),
      )

      assert.instanceOf(duplicate, ProductAlreadyExists)
    }).pipe(Effect.provide(granted)),
  )

  it.effect("denies operations without a granted capability", () =>
    Effect.gen(function* () {
      const service = yield* ProductService
      const denied = yield* Effect.flip(service.listProducts({ principal, tenantId }))
      assert.instanceOf(denied, AuthorizationDenied)
    }).pipe(Effect.provide(ungranted)),
  )
})

it.layer(TestHttpServices)("product HTTP endpoint", (it) => {
  it.effect("serves create and list through the bearer-protected routes", () =>
    Effect.gen(function* () {
      const bearer = Layer.succeed(BearerAuth, {
        bearer: (effect) => Effect.provideService(effect, CurrentPrincipal, principal),
      })

      const bearerClient = HttpApiMiddleware.layerClient(BearerAuth, ({ request, next }) =>
        next(HttpClientRequest.bearerToken(request, "product-token")),
      )

      const handlers = ProductHttpHandlers.pipe(Layer.provide(bearer), Layer.provide(granted))

      const client = yield* HttpApiTest.groups(moduleApi(ProductHttpGroup), ["Product"]).pipe(
        Effect.provide(Layer.mergeAll(handlers, bearerClient, bearer)),
      )

      const headers = { "x-tenant-id": tenantId }

      const created = yield* client.Product.createProduct({
        headers,
        payload: { code: "SVC-1", name: "Via HTTP", type: "service" },
      })

      assert.strictEqual(created.name, "Via HTTP")
      assert.deepStrictEqual(yield* client.Product.listProducts({ headers, query: {} }), [created])
    }),
  )
})
