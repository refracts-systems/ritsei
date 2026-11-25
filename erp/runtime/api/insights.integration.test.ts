import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import { Etag, HttpPlatform } from "effect/http"
import * as HttpApiMiddleware from "effect/http-api/HttpApiMiddleware"
import * as HttpApiTest from "effect/http-api/HttpApiTest"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"

import { AuthorizationDenied } from "../../../framework/modules/authorization/mod.ts"
import { partial } from "../../../tests/support/partial.ts"
import {
  InsightsService,
  type InsightsServiceContract,
  type KpisType,
} from "../../modules/insights/mod.ts"
import { InsightsHttpHandlers } from "../../modules/insights/http.ts"
import { ApiForbidden, BearerAuth, CurrentPrincipal, RitseiApi } from "./api.ts"

const tenantId = "018f5000-0000-7000-8000-000000000001"
const legalEntityId = "018f5000-0000-7000-8000-000000000002"
const deniedEntityId = "018f5000-0000-7000-8000-000000000003"
const principal = { userAccountId: "kpi-user", sessionId: "kpi-session" }

const figure = { status: "ok", value: "10.00", previous: "8.00" } as const

const kpis: KpisType = {
  legalEntityId,
  period: "2026-10",
  from: "2026-10-01",
  to: "2026-10-31",
  previousPeriod: "2026-09",
  netSales: figure,
  receivableOverdue: figure,
  payableOverdue: { status: "denied", value: null, previous: null },
  cash: figure,
  confirmedUndelivered: { ...figure, orders: 2, previousOrders: 3 },
  inventoryValue: { status: "unavailable", value: null, previous: null },
}

const TestHttpServices = Layer.mergeAll(Path.layer, Etag.layerWeak, HttpPlatform.layer).pipe(
  Layer.provideMerge(FileSystem.layerNoop({})),
)

it.layer(TestHttpServices)("insights KPI API contract", (it) => {
  it.effect("reads the figures of a legal entity and a period, and maps a denial", () =>
    Effect.gen(function* () {
      const observed: unknown[] = []

      const bearer = Layer.succeed(BearerAuth, {
        bearer: (effect) => Effect.provideService(effect, CurrentPrincipal, principal),
      })

      const bearerClient = HttpApiMiddleware.layerClient(
        BearerAuth,
        ({ request: outgoing, next }) =>
          next(HttpClientRequest.bearerToken(outgoing, "insights-token")),
      )

      const insights = partial<InsightsServiceContract>()({
        kpis: (input: Parameters<InsightsServiceContract["kpis"]>[0]) =>
          input.legalEntityId === deniedEntityId
            ? Effect.fail(
                new AuthorizationDenied({ tenantId, capability: "billing.document.read" }),
              )
            : Effect.sync(() => {
                observed.push(input)

                return kpis
              }),
      })

      const handlers = InsightsHttpHandlers.pipe(
        Layer.provide(bearer),
        Layer.provide(Layer.succeed(InsightsService, insights)),
      )

      const client = yield* HttpApiTest.groups(RitseiApi, ["Insights"]).pipe(
        Effect.provide(Layer.mergeAll(handlers, bearerClient, bearer)),
      )

      const headers = { "x-tenant-id": tenantId }

      assert.deepStrictEqual(
        yield* client.Insights.insightsKpis({
          headers,
          query: { legalEntityId, period: "2026-10" },
        }),
        kpis,
      )

      assert.deepStrictEqual(observed, [{ principal, tenantId, legalEntityId, period: "2026-10" }])

      const denied = yield* Effect.flip(
        client.Insights.insightsKpis({
          headers,
          query: { legalEntityId: deniedEntityId, period: "2026-10" },
        }),
      )

      assert.instanceOf(denied, ApiForbidden)
    }),
  )
})
