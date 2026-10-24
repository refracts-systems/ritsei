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
  ApprovalService,
  SelfApprovalForbidden,
  type ApprovalRequestType,
  type ApprovalServiceContract,
} from "../../../framework/modules/approvals/mod.ts"
import { ApiConflict, BearerAuth, CurrentPrincipal, RitseiApi } from "./api.ts"
import { ApprovalHandlers } from "./handlers.ts"

const tenantId = "018f5000-0000-7000-8000-000000000001"
const requestId = "018f5000-0000-7000-8000-000000000002"
const subjectId = "018f5000-0000-7000-8000-000000000003"
const principal = { userAccountId: "approver-user", sessionId: "approver-session" }

const request: ApprovalRequestType = {
  id: requestId,
  tenantId,
  subjectType: "procurement.purchase_order",
  subjectId,
  amount: "600.00",
  reason: "Purchase order above the approval limit",
  status: "pending",
  requestedBy: "buyer-user",
  decidedBy: null,
  decidedAt: null,
}

const TestHttpServices = Layer.mergeAll(Path.layer, Etag.layerWeak, HttpPlatform.layer).pipe(
  Layer.provideMerge(FileSystem.layerNoop({})),
)

it.layer(TestHttpServices)("approvals API contracts", (it) => {
  it.effect("lists requests for the caller's tenant and maps decision failures", () =>
    Effect.gen(function* () {
      const observed: unknown[] = []

      const bearer = Layer.succeed(BearerAuth, {
        bearer: (effect) => Effect.provideService(effect, CurrentPrincipal, principal),
      })

      const bearerClient = HttpApiMiddleware.layerClient(
        BearerAuth,
        ({ request: outgoing, next }) =>
          next(HttpClientRequest.bearerToken(outgoing, "approvals-token")),
      )

      const approvals = partial<ApprovalServiceContract>()({
        list: (input: Parameters<ApprovalServiceContract["list"]>[0]) =>
          Effect.sync(() => {
            observed.push(input)

            return [request]
          }),
        decide: (input: Parameters<ApprovalServiceContract["decide"]>[0]) =>
          input.decision === "approve"
            ? Effect.succeed({
                ...request,
                status: "approved" as const,
                decidedBy: "approver-user",
              })
            : Effect.fail(new SelfApprovalForbidden({ tenantId, requestId })),
      })

      const handlers = ApprovalHandlers.pipe(
        Layer.provide(bearer),
        Layer.provide(Layer.succeed(ApprovalService, approvals)),
      )

      const client = yield* HttpApiTest.groups(RitseiApi, ["Approvals"]).pipe(
        Effect.provide(Layer.mergeAll(handlers, bearerClient, bearer)),
      )

      const headers = { "x-tenant-id": tenantId }

      assert.deepStrictEqual(
        yield* client.Approvals.listApprovalRequests({ headers, query: { status: "pending" } }),
        [request],
      )
      // SAFETY: the test calls this double only with inputs of the shape it reads.
      const listed = observed.at(-1) as { tenantId: string; status: string; principal: unknown }
      assert.strictEqual(listed.tenantId, tenantId)
      assert.strictEqual(listed.status, "pending")
      assert.deepStrictEqual(listed.principal, principal)

      assert.strictEqual(
        (yield* client.Approvals.decideApprovalRequest({
          params: { id: requestId },
          headers,
          payload: { decision: "approve" },
        })).status,
        "approved",
      )

      const forbidden = yield* Effect.flip(
        client.Approvals.decideApprovalRequest({
          params: { id: requestId },
          headers,
          payload: { decision: "reject" },
        }),
      )

      assert.instanceOf(forbidden, ApiConflict)
      assert.strictEqual(forbidden.code, "SelfApprovalForbidden")
    }),
  )
})
