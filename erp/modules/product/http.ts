// HTTP adapter for this module (ADR-0094). Only the composition root imports this file.
import * as Effect from "effect/Effect"
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder"
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint"
import * as HttpApiGroup from "effect/http-api/HttpApiGroup"
import * as HttpApiSchema from "effect/http-api/HttpApiSchema"
import * as Schema from "effect/Schema"

import {
  ApiErrors,
  BaseApiErrorPolicy,
  BearerAuth,
  CurrentPrincipal,
  apiErrorMapping,
  moduleApi,
  ReadLimit,
  ShortString,
  TenantHeaders,
  Uuid,
} from "../../../framework/modules/http/mod.ts"
import { Product, ProductService, ProductType, UnitOfMeasure } from "./mod.ts"

export const ProductHttpGroup = HttpApiGroup.make("Product").add(
  HttpApiEndpoint.get("listProducts", "/product/products", {
    headers: TenantHeaders,
    query: {
      search: Schema.optionalKey(ShortString),
      type: Schema.optionalKey(ProductType),
      limit: ReadLimit,
    },
    success: Schema.Array(Product),
    error: ApiErrors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.get("getProduct", "/product/products/:id", {
    params: { id: Uuid },
    headers: TenantHeaders,
    success: Product,
    error: ApiErrors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("createProduct", "/product/products", {
    headers: TenantHeaders,
    payload: Schema.Struct({
      code: ShortString,
      name: ShortString,
      type: ProductType,
      category: Schema.optionalKey(ShortString),
      unitOfMeasure: Schema.optionalKey(UnitOfMeasure),
    }),
    success: Product.pipe(HttpApiSchema.status(201)),
    error: ApiErrors,
  }).middleware(BearerAuth),
)

const ProductHttpApi = moduleApi(ProductHttpGroup)

export const ProductHttpErrors = apiErrorMapping({
  ...BaseApiErrorPolicy,
  ProductAlreadyExists: "conflict",
  ProductNotFound: "not_found",
})

export const ProductHttpHandlers = HttpApiBuilder.group(ProductHttpApi, "Product", (handlers) =>
  Effect.gen(function* () {
    const service = yield* ProductService
    return handlers
      .handle(
        "listProducts",
        Effect.fn("Http.Product.listProducts")(function* ({ headers, query }) {
          const principal = yield* CurrentPrincipal
          return yield* ProductHttpErrors.apiEffect(
            service.listProducts({ principal, tenantId: headers["x-tenant-id"], ...query }),
          )
        }),
      )
      .handle(
        "getProduct",
        Effect.fn("Http.Product.getProduct")(function* ({ headers, params }) {
          const principal = yield* CurrentPrincipal
          return yield* ProductHttpErrors.apiEffect(
            service.getProduct({
              principal,
              tenantId: headers["x-tenant-id"],
              productId: params.id,
            }),
          )
        }),
      )
      .handle(
        "createProduct",
        Effect.fn("Http.Product.createProduct")(function* ({ headers, payload }) {
          const principal = yield* CurrentPrincipal
          return yield* ProductHttpErrors.apiEffect(
            service.createProduct({ principal, tenantId: headers["x-tenant-id"], ...payload }),
          )
        }),
      )
  }),
)
