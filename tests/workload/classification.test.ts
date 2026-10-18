import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import {
  classifyWorkload,
  EntryWorkloadLimits,
  WorkloadMetadata,
} from "../../runtime/workload/classification.ts"

const command = {
  workloadClass: "command" as const,
  criticality: "protected" as const,
  consistency: "authoritative" as const,
  estimatedCost: 4,
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
  consistency: "projection" as const,
  deadlineMs: 30_000,
  admissionScope: "route" as const,
}

describe("workload classification", () => {
  it.effect("accepts command, query, and async metadata", () =>
    Effect.gen(function*() {
      for (const metadata of [command, query, asyncWork]) {
        assert.deepStrictEqual(yield* classifyWorkload(metadata), metadata)
      }
    }))

  it.effect("rejects unbounded or topology-shaped metadata", () =>
    Effect.gen(function*() {
      for (
        const invalid of [
          { ...command, deadlineMs: 0 },
          { ...query, maxQueueDepth: 1_000_001 },
          { ...asyncWork, maxInFlight: 0 },
          { ...command, workloadClass: "workload-cell" },
          { ...query, pool: "command" },
        ]
      ) {
        const result = yield* Effect.result(classifyWorkload(invalid))
        assert.isTrue(result._tag === "Failure")
      }
    }))

  it("keeps selected entry limits finite and the command reserve non-zero", () => {
    assert.isAbove(EntryWorkloadLimits.commandReserve, 0)
    assert.isAtMost(EntryWorkloadLimits.maxQueueDepth, 1_000_000)
    assert.isAtMost(EntryWorkloadLimits.maxStatementMs, 1_000_000)
    assert.isAtMost(EntryWorkloadLimits.maxResultItems, 1_000_000)
    assert.isTrue(WorkloadMetadata.ast !== undefined)
  })
})
