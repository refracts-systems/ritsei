// HTTP adapter for this module (ADR-0094). Only the composition root imports this file.
import * as Effect from "effect/Effect"
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder"
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint"
import * as HttpApiGroup from "effect/http-api/HttpApiGroup"

import { CalendarDate } from "../../../framework/foundation/mod.ts"
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
import { GroupKpis, GroupStatements, InsightsService, Kpis, Period } from "./mod.ts"

export const InsightsHttpGroup = HttpApiGroup.make("Insights")
  .add(
    HttpApiEndpoint.get("insightsKpis", "/insights/kpis", {
      headers: TenantHeaders,
      query: { legalEntityId: Uuid, period: Period },
      success: Kpis,
      error: ApiErrors,
    }).middleware(BearerAuth),
  )
  .add(
    HttpApiEndpoint.get("insightsGroupKpis", "/insights/group/kpis", {
      headers: TenantHeaders,
      query: { unitId: Uuid, period: Period },
      success: GroupKpis,
      error: ApiErrors,
    }).middleware(BearerAuth),
  )
  .add(
    HttpApiEndpoint.get("insightsGroupStatements", "/insights/group/statements", {
      headers: TenantHeaders,
      query: { unitId: Uuid, from: CalendarDate, to: CalendarDate },
      success: GroupStatements,
      error: ApiErrors,
    }).middleware(BearerAuth),
  )

const InsightsHttpApi = moduleApi(InsightsHttpGroup)

export const InsightsHttpErrors = apiErrorMapping({
  ...BaseApiErrorPolicy,
  OrgUnitNotFound: "not_found",
})

export const InsightsHttpHandlers = HttpApiBuilder.group(InsightsHttpApi, "Insights", (handlers) =>
  Effect.gen(function* () {
    const insights = yield* InsightsService

    return handlers
      .handle(
        "insightsKpis",
        Effect.fn("Http.Insights.kpis")(function* ({ headers, query }) {
          const principal = yield* CurrentPrincipal

          return yield* InsightsHttpErrors.apiEffect(
            insights.kpis({ principal, tenantId: headers["x-tenant-id"], ...query }),
          )
        }),
      )
      .handle(
        "insightsGroupKpis",
        Effect.fn("Http.Insights.groupKpis")(function* ({ headers, query }) {
          const principal = yield* CurrentPrincipal

          return yield* InsightsHttpErrors.apiEffect(
            insights.groupKpis({ principal, tenantId: headers["x-tenant-id"], ...query }),
          )
        }),
      )
      .handle(
        "insightsGroupStatements",
        Effect.fn("Http.Insights.groupStatements")(function* ({ headers, query }) {
          const principal = yield* CurrentPrincipal

          return yield* InsightsHttpErrors.apiEffect(
            insights.groupStatements({ principal, tenantId: headers["x-tenant-id"], ...query }),
          )
        }),
      )
  }),
)
