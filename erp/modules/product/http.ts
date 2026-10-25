// HTTP adapter for this module (ADR-0094). Only the composition root imports this file.
import * as Effect from "effect/Effect"
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder"
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint"
import * as HttpApiGroup from "effect/http-api/HttpApiGroup"
import * as HttpApiSchema from "effect/http-api/HttpApiSchema"
import * as Schema from "effect/Schema"

import {
  CustomFieldDefinition,
  CustomFieldKey,
  CustomFieldKind,
  CustomFieldValues,
} from "../../../framework/modules/custom-fields/mod.ts"
import {
  ApiErrors,
  BaseApiErrorPolicy,
  BearerAuth,
  CurrentPrincipal,
  apiErrorMapping,
  BoundedArray,
  moduleApi,
  ReadLimit,
  ShortString,
  TenantHeaders,
  Uuid,
} from "../../../framework/modules/http/mod.ts"
import { Product, ProductFields, ProductService, ProductType, UnitOfMeasure } from "./mod.ts"

const CustomFieldPayload = Schema.Struct({
  key: CustomFieldKey,
  label: ShortString,
  kind: CustomFieldKind,
  required: Schema.optionalKey(Schema.Boolean),
  choices: Schema.optionalKey(BoundedArray(ShortString).check(Schema.isMinLength(1))),
})

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
  HttpApiEndpoint.get("listProductCustomFields", "/product/custom-fields", {
    headers: TenantHeaders,
    success: Schema.Array(CustomFieldDefinition),
    error: ApiErrors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("defineProductCustomField", "/product/custom-fields", {
    headers: TenantHeaders,
    payload: CustomFieldPayload,
    success: CustomFieldDefinition.pipe(HttpApiSchema.status(201)),
    error: ApiErrors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.get("getProductCustomFields", "/product/products/:id/custom-fields", {
    params: { id: Uuid },
    headers: TenantHeaders,
    success: CustomFieldValues,
    error: ApiErrors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("setProductCustomFields", "/product/products/:id/custom-fields", {
    params: { id: Uuid },
    headers: TenantHeaders,
    payload: Schema.Struct({ values: CustomFieldValues }),
    success: CustomFieldValues,
    error: ApiErrors,
  }).middleware(BearerAuth),
)

const ProductHttpApi = moduleApi(ProductHttpGroup)

export const ProductHttpErrors = apiErrorMapping({
  ...BaseApiErrorPolicy,
  ProductAlreadyExists: "conflict",
  CustomFieldAlreadyDefined: "conflict",
  CustomFieldDocumentTypeNotReleased: "conflict",
  CustomFieldNotDefined: "conflict",
  CustomFieldRequired: "conflict",
  CustomFieldValueInvalid: "conflict",
  ProductNotFound: "not_found",
})

export const ProductHttpHandlers = HttpApiBuilder.group(ProductHttpApi, "Product", (handlers) =>
  Effect.gen(function* () {
    const service = yield* ProductService
    const fields = yield* ProductFields

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
      .handle(
        "listProductCustomFields",
        Effect.fn("Http.Product.listProductCustomFields")(function* ({ headers }) {
          const principal = yield* CurrentPrincipal

          return yield* ProductHttpErrors.apiEffect(
            fields.listFields({ principal, tenantId: headers["x-tenant-id"] }),
          )
        }),
      )
      .handle(
        "defineProductCustomField",
        Effect.fn("Http.Product.defineProductCustomField")(function* ({ headers, payload }) {
          const principal = yield* CurrentPrincipal

          return yield* ProductHttpErrors.apiEffect(
            fields.defineField({ principal, tenantId: headers["x-tenant-id"], ...payload }),
          )
        }),
      )
      .handle(
        "getProductCustomFields",
        Effect.fn("Http.Product.getProductCustomFields")(function* ({ headers, params }) {
          const principal = yield* CurrentPrincipal

          return yield* ProductHttpErrors.apiEffect(
            fields.getValues({
              principal,
              tenantId: headers["x-tenant-id"],
              documentId: params.id,
            }),
          )
        }),
      )
      .handle(
        "setProductCustomFields",
        Effect.fn("Http.Product.setProductCustomFields")(function* ({ headers, params, payload }) {
          const principal = yield* CurrentPrincipal

          return yield* ProductHttpErrors.apiEffect(
            fields.setValues({
              principal,
              tenantId: headers["x-tenant-id"],
              documentId: params.id,
              values: payload.values,
            }),
          )
        }),
      )
  }),
)
