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
  makeApiErrorMapping,
  makeModuleApi,
  ReadLimit,
  ShortString,
  TenantHeaders,
  Uuid,
} from "../../../framework/modules/http/mod.ts"
import { ProductTaxDefault, TaxCode, TaxDirection, TaxRate, TaxService } from "./mod.ts"

export const TaxHttpGroup = HttpApiGroup.make("Tax").add(
  HttpApiEndpoint.get("listTaxCodes", "/tax/tax-codes", {
    headers: TenantHeaders,
    query: { direction: Schema.optionalKey(TaxDirection), limit: ReadLimit },
    success: Schema.Array(TaxCode),
    error: ApiErrors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("createTaxCode", "/tax/tax-codes", {
    headers: TenantHeaders,
    payload: Schema.Struct({
      code: ShortString,
      name: ShortString,
      rate: TaxRate,
      direction: TaxDirection,
    }),
    success: TaxCode.pipe(HttpApiSchema.status(201)),
    error: ApiErrors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.put("setProductTaxDefault", "/tax/products/:id/defaults/:direction", {
    params: { id: Uuid, direction: TaxDirection },
    headers: TenantHeaders,
    payload: Schema.Struct({ taxCodeId: Uuid }),
    success: ProductTaxDefault,
    error: ApiErrors,
  }).middleware(BearerAuth),
)

const TaxHttpApi = makeModuleApi(TaxHttpGroup)

export const TaxHttpErrors = makeApiErrorMapping({
  ...BaseApiErrorPolicy,
  TaxCodeAlreadyExists: "conflict",
  TaxCodeNotFound: "not_found",
  TaxProductNotFound: "not_found",
})

export const TaxHttpHandlers = HttpApiBuilder.group(TaxHttpApi, "Tax", (handlers) =>
  Effect.gen(function* () {
    const service = yield* TaxService
    return handlers
      .handle(
        "listTaxCodes",
        Effect.fn("Http.Tax.listTaxCodes")(function* ({ headers, query }) {
          const principal = yield* CurrentPrincipal
          return yield* TaxHttpErrors.apiEffect(
            service.listTaxCodes({ principal, tenantId: headers["x-tenant-id"], ...query }),
          )
        }),
      )
      .handle(
        "createTaxCode",
        Effect.fn("Http.Tax.createTaxCode")(function* ({ headers, payload }) {
          const principal = yield* CurrentPrincipal
          return yield* TaxHttpErrors.apiEffect(
            service.createTaxCode({ principal, tenantId: headers["x-tenant-id"], ...payload }),
          )
        }),
      )
      .handle(
        "setProductTaxDefault",
        Effect.fn("Http.Tax.setProductTaxDefault")(function* ({ headers, params, payload }) {
          const principal = yield* CurrentPrincipal
          return yield* TaxHttpErrors.apiEffect(
            service.setProductTaxDefault({
              principal,
              tenantId: headers["x-tenant-id"],
              productId: params.id,
              direction: params.direction,
              taxCodeId: payload.taxCodeId,
            }),
          )
        }),
      )
  }),
)
