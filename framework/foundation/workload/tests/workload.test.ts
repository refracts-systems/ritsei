import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"

import {
  classifyWorkload,
  EntryWorkloadLimits,
  makeWorkloadAdmission,
  WorkloadAdmissionConfigurationInvalid,
  WorkloadAdmissionRejected,
} from "../mod.ts"

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
  maxInFlight: 16,
  maxQueueDepth: 8,
  maxStatementMs: 2_000,
  maxResultItems: 100,
  admissionScope: "principal" as const,
}

const asyncWork = {
  ...query,
  workloadClass: "async" as const,
  criticality: "discardable" as const,
  deadlineMs: 30_000,
  admissionScope: "route" as const,
}

const rejectionReason = (error: unknown) =>
  error instanceof WorkloadAdmissionRejected ? error.reason : undefined

describe("workload classification", () => {
  it.effect("accepts command, query, and async metadata", () =>
    Effect.gen(function* () {
      for (const metadata of [command, query, asyncWork]) {
        assert.deepStrictEqual(yield* classifyWorkload(metadata), metadata)
      }
    }),
  )

  it.effect("rejects unbounded or topology-shaped metadata", () =>
    Effect.gen(function* () {
      for (const invalid of [
        { ...command, deadlineMs: 0 },
        { ...query, maxQueueDepth: 1_000_001 },
        { ...asyncWork, maxInFlight: 0 },
        { ...command, workloadClass: "workload-cell" },
        { ...query, pool: "command" },
      ]) {
        const result = yield* Effect.result(classifyWorkload(invalid))
        assert.strictEqual(result._tag, "Failure")
      }
    }),
  )

  it("keeps the entry limits finite and the command reserve non-zero", () => {
    assert.isAbove(EntryWorkloadLimits.commandReserve, 0)
    assert.isAtMost(EntryWorkloadLimits.maxQueueDepth, 1_000_000)
    assert.isAtMost(EntryWorkloadLimits.maxStatementMs, 1_000_000)
    assert.isAtMost(EntryWorkloadLimits.maxResultItems, 1_000_000)
  })
})

describe("workload admission", () => {
  it.effect("keeps query and async saturation out of the command reserve", () =>
    Effect.gen(function* () {
      const admission = yield* makeWorkloadAdmission({ commandReserve: 1, competingHardLimit: 1 })

      yield* Effect.scoped(
        Effect.gen(function* () {
          const queryLease = yield* admission.admit(query)
          assert.strictEqual(queryLease.workloadClass, "query")

          const queryRejected = yield* Effect.flip(admission.admit(query))
          const asyncRejected = yield* Effect.flip(admission.admit(asyncWork))
          assert.strictEqual(rejectionReason(queryRejected), "competing_capacity_exhausted")
          assert.strictEqual(rejectionReason(asyncRejected), "competing_capacity_exhausted")

          const commandLease = yield* admission.admit(command)
          assert.strictEqual(commandLease.workloadClass, "command")
          assert.deepStrictEqual(yield* admission.available, {
            commandReserve: 0,
            competingCapacity: 0,
          })
        }),
      )

      assert.deepStrictEqual(yield* admission.available, {
        commandReserve: 1,
        competingCapacity: 1,
      })
    }),
  )

  it.effect("rejects costs above each pool's hard ceiling", () =>
    Effect.gen(function* () {
      const admission = yield* makeWorkloadAdmission({ commandReserve: 2, competingHardLimit: 2 })
      const oversizedCommand = yield* Effect.flip(
        Effect.scoped(admission.admit({ ...command, estimatedCost: 3 })),
      )
      const oversizedQuery = yield* Effect.flip(
        Effect.scoped(admission.admit({ ...query, estimatedCost: 3 })),
      )
      assert.strictEqual(rejectionReason(oversizedCommand), "cost_above_hard_limit")
      assert.strictEqual(rejectionReason(oversizedQuery), "cost_above_hard_limit")
      assert.deepStrictEqual(yield* admission.available, {
        commandReserve: 2,
        competingCapacity: 2,
      })
    }),
  )

  it.effect("returns capacity when the holding fiber is interrupted", () =>
    Effect.gen(function* () {
      const admission = yield* makeWorkloadAdmission({ commandReserve: 1, competingHardLimit: 1 })
      const holder = yield* Effect.forkChild(
        Effect.scoped(Effect.andThen(admission.admit(command), Effect.never)),
      )
      yield* Effect.yieldNow
      assert.strictEqual((yield* admission.available).commandReserve, 0)

      yield* Fiber.interrupt(holder)
      assert.strictEqual((yield* admission.available).commandReserve, 1)
    }),
  )

  it.effect("rejects invalid limits as a typed configuration failure", () =>
    Effect.gen(function* () {
      for (const config of [
        { commandReserve: 0, competingHardLimit: 1 },
        { commandReserve: 1, competingHardLimit: -1 },
        { commandReserve: 1, competingHardLimit: 2, competingAdaptiveLimit: 3 },
      ]) {
        const error = yield* Effect.flip(makeWorkloadAdmission(config))
        assert.isTrue(error instanceof WorkloadAdmissionConfigurationInvalid)
      }
    }),
  )
})
