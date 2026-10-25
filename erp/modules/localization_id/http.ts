// HTTP adapter for this module (ADR-0094). Only the composition root imports this file.
import * as Effect from "effect/Effect"
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder"
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint"
import * as HttpApiGroup from "effect/http-api/HttpApiGroup"
import * as Schema from "effect/Schema"

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
import { LocalizationIdService, SetupResult } from "./mod.ts"

export const LocalizationIdHttpGroup = HttpApiGroup.make("LocalizationId").add(
  HttpApiEndpoint.post("setupIndonesia", "/localization-id/setup", {
    headers: TenantHeaders,
    payload: Schema.Struct({ legalEntityId: Uuid }),
    success: SetupResult,
    error: ApiErrors,
  }).middleware(BearerAuth),
)

const LocalizationIdHttpApi = moduleApi(LocalizationIdHttpGroup)

export const LocalizationIdHttpErrors = apiErrorMapping({
  ...BaseApiErrorPolicy,
  AccountingLegalEntityNotFound: "not_found",
  ChartTemplateNotFound: "not_found",
})

export const LocalizationIdHttpHandlers = HttpApiBuilder.group(
  LocalizationIdHttpApi,
  "LocalizationId",
  (handlers) =>
    Effect.gen(function* () {
      const localization = yield* LocalizationIdService

      return handlers.handle(
        "setupIndonesia",
        Effect.fn("Http.LocalizationId.setupIndonesia")(function* ({ headers, payload }) {
          const principal = yield* CurrentPrincipal

          return yield* LocalizationIdHttpErrors.apiEffect(
            localization.setup({ principal, tenantId: headers["x-tenant-id"], ...payload }),
          )
        }),
      )
    }),
)
