import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import {
  makeWorkloadAdmission,
  WorkloadAdmissionConfigurationInvalid,
  WorkloadAdmissionRejected,
} from "../../runtime/workload/admission.ts"
import { EntryWorkloadLimits } from "../../runtime/workload/classification.ts"

const command = {
  workloadClass: "command" as const,
  criticality: "protected" as const,
  consistency: "authoritative" as const,
  estimatedCost: 1,
  deadlineMs: 5_000,
  maxInFlight: EntryWorkloadLimits.maxInFlight,
  maxQueueDepth: EntryWorkloadLimits.maxQueueDepth,
  maxStatementMs: EntryWorkloadLimits.maxStatementMs,
  maxResultItems: EntryWorkloadLimits.maxResultItems,
  admissionScope: "tenant" as const,
}

const query = {
  ...command,
  workloadClass: "query" as const,
  criticality: "degradable" as const,
  consistency: "projection" as const,
  admissionScope: "principal" as const,
}

const asyncWork = {
  ...query,
  workloadClass: "async" as const,
  criticality: "discardable" as const,
  admissionScope: "route" as const,
}

const isRejected = (value: unknown): value is WorkloadAdmissionRejected =>
  value instanceof WorkloadAdmissionRejected

describe("workload admission", () => {
  it.effect("keeps query and async saturation out of the command reserve", () =>
    Effect.gen(function* () {
      const admission = makeWorkloadAdmission({ commandReserve: 1, competingHardLimit: 1 })
      const commandLease = yield* admission.acquire({ metadata: command })
      const queryLease = yield* admission.acquire({ metadata: query })

      assert.deepStrictEqual(admission.available(), {
        commandReserve: 0,
        competingCapacity: 0,
      })
      assert.strictEqual(commandLease.workloadClass, "command")
      assert.strictEqual(queryLease.workloadClass, "query")

      const queryRejected = yield* Effect.flip(admission.acquire({ metadata: query }))
      const asyncRejected = yield* Effect.flip(admission.acquire({ metadata: asyncWork }))
      assert.isTrue(isRejected(queryRejected))
      assert.isTrue(isRejected(asyncRejected))
      if (!isRejected(queryRejected) || !isRejected(asyncRejected)) return
      assert.strictEqual(queryRejected.reason, "competing_capacity_exhausted")
      assert.strictEqual(asyncRejected.reason, "competing_capacity_exhausted")

      queryLease.release()
      const retriedQuery = yield* admission.acquire({ metadata: query })
      retriedQuery.release()
      assert.strictEqual(admission.available().commandReserve, 0)

      commandLease.release()
      commandLease.release()
      assert.deepStrictEqual(admission.available(), {
        commandReserve: 1,
        competingCapacity: 1,
      })
    }),
  )

  it.effect("rejects costs above each plane's hard ceiling", () =>
    Effect.gen(function* () {
      const admission = makeWorkloadAdmission({ commandReserve: 2, competingHardLimit: 2 })
      const oversizedCommand = yield* Effect.flip(
        admission.acquire({ metadata: { ...command, estimatedCost: 3 } }),
      )
      const oversizedQuery = yield* Effect.flip(
        admission.acquire({ metadata: { ...query, estimatedCost: 3 } }),
      )
      assert.isTrue(isRejected(oversizedCommand))
      assert.isTrue(isRejected(oversizedQuery))
      if (!isRejected(oversizedCommand) || !isRejected(oversizedQuery)) return
      assert.strictEqual(oversizedCommand.reason, "cost_above_hard_limit")
      assert.strictEqual(oversizedQuery.reason, "cost_above_hard_limit")
    }),
  )

  it("rejects an adaptive limit above the hard limit", () => {
    assert.throws(
      () =>
        makeWorkloadAdmission({
          commandReserve: 1,
          competingHardLimit: 2,
          competingAdaptiveLimit: 3,
        }),
      WorkloadAdmissionConfigurationInvalid,
    )
  })
})
