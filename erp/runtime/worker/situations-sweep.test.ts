import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { DatabaseFailure } from "../../../framework/foundation/mod.ts"
import { SituationsService, type SituationsServiceContract } from "../../modules/situations/mod.ts"
import { partial } from "../../../tests/support/partial.ts"
import { runSituationsSweepOnce } from "./situations-sweep.ts"

const tenantId = "018f0000-0000-7000-8000-000000000001"
const first = "018f0000-0000-7000-8000-000000000011"
const second = "018f0000-0000-7000-8000-000000000012"
const principal = { userAccountId: "sweeper", sessionId: "sweep-session" }

const situationsLayer = (calls: string[], failing: string) =>
  Layer.succeed(
    SituationsService,
    partial<SituationsServiceContract>()({
      detect: (input: { legalEntityId: string }) =>
        input.legalEntityId === failing
          ? Effect.fail(new DatabaseFailure({ operation: "situations.detect", cause: "down" }))
          : Effect.sync(() => {
              calls.push(`detect:${input.legalEntityId}`)
            }),
      advanceEscalations: (input: { legalEntityId: string }) =>
        Effect.sync(() => {
          calls.push(`advance:${input.legalEntityId}`)

          return {
            legalEntityId: input.legalEntityId,
            at: "2026-11-26T00:00:00.000Z",
            escalated: 2,
          }
        }),
    }),
  )

it.effect("detects before escalating, per legal entity, and keeps going after a failure", () => {
  const calls: string[] = []

  return Effect.gen(function* () {
    const results = yield* runSituationsSweepOnce({
      tenantId,
      principal,
      legalEntityIds: [first, second],
    })

    assert.deepStrictEqual(results, [
      { legalEntityId: first, status: "failed", escalated: 0, error: "DatabaseFailure" },
      { legalEntityId: second, status: "swept", escalated: 2, error: null },
    ])

    assert.deepStrictEqual(calls, [`detect:${second}`, `advance:${second}`])
  }).pipe(Effect.provide(situationsLayer(calls, first)))
})

it.effect("rejects a sweep with no legal entities", () =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(
      runSituationsSweepOnce({ tenantId, principal, legalEntityIds: [] }),
    )

    assert.strictEqual(error._tag, "SchemaError")
  }).pipe(Effect.provide(situationsLayer([], ""))),
)
