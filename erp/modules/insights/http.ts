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
import { InsightsService, Kpis, Period } from "./mod.ts"

export const InsightsHttpGroup = HttpApiGroup.make("Insights").add(
  HttpApiEndpoint.get("insightsKpis", "/insights/kpis", {
    headers: TenantHeaders,
    query: { legalEntityId: Uuid, period: Period },
    success: Kpis,
    error: ApiErrors,
  }).middleware(BearerAuth),
)

const InsightsHttpApi = moduleApi(InsightsHttpGroup)

export const InsightsHttpErrors = apiErrorMapping({ ...BaseApiErrorPolicy })

export const InsightsHttpHandlers = HttpApiBuilder.group(InsightsHttpApi, "Insights", (handlers) =>
  Effect.gen(function* () {
    const insights = yield* InsightsService

    return handlers.handle(
      "insightsKpis",
      Effect.fn("Http.Insights.kpis")(function* ({ headers, query }) {
        const principal = yield* CurrentPrincipal

        return yield* InsightsHttpErrors.apiEffect(
          insights.kpis({ principal, tenantId: headers["x-tenant-id"], ...query }),
        )
      }),
    )
  }),
)
