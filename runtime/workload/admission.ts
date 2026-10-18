import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { type WorkloadClass, WorkloadMetadata } from "./classification.ts"

const PositiveCapacity = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000_000 }))
const NonNegativeCapacity = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1_000_000 }))

export const WorkloadAdmissionInput = Schema.Struct({
  metadata: WorkloadMetadata,
})
export type WorkloadAdmissionInput = Schema.Schema.Type<typeof WorkloadAdmissionInput>

export class WorkloadAdmissionRejected extends Schema.TaggedError<WorkloadAdmissionRejected>()(
  "WorkloadAdmissionRejected",
  {
    workloadClass: Schema.Literals(["command", "query", "async"]),
    reason: Schema.Literals([
      "command_reserve_exhausted",
      "competing_capacity_exhausted",
      "cost_above_hard_limit",
    ]),
  },
) {}

export class WorkloadAdmissionConfigurationInvalid extends Schema.TaggedError<WorkloadAdmissionConfigurationInvalid>()(
  "WorkloadAdmissionConfigurationInvalid",
  { reason: Schema.String },
) {}

export type WorkloadAdmissionConfig = {
  readonly commandReserve: number
  readonly competingHardLimit: number
  readonly competingAdaptiveLimit?: number
}

export type WorkloadLease = {
  readonly workloadClass: WorkloadClass
  readonly cost: number
  readonly release: () => void
}

export type WorkloadAdmission = {
  readonly acquire: (
    input: unknown,
  ) => Effect.Effect<WorkloadLease, WorkloadAdmissionRejected | Schema.SchemaError>
  readonly available: () => {
    readonly commandReserve: number
    readonly competingCapacity: number
  }
}

export const makeWorkloadAdmission = (config: WorkloadAdmissionConfig): WorkloadAdmission => {
  if (!Schema.is(PositiveCapacity)(config.commandReserve)) {
    throw new WorkloadAdmissionConfigurationInvalid({ reason: "command reserve must be positive" })
  }
  if (!Schema.is(NonNegativeCapacity)(config.competingHardLimit)) {
    throw new WorkloadAdmissionConfigurationInvalid({ reason: "competing hard limit is invalid" })
  }
  const competingAdaptiveLimit = config.competingAdaptiveLimit ?? config.competingHardLimit
  if (
    !Schema.is(NonNegativeCapacity)(competingAdaptiveLimit) ||
    competingAdaptiveLimit > config.competingHardLimit
  ) {
    throw new WorkloadAdmissionConfigurationInvalid({
      reason: "adaptive limit must not exceed hard limit",
    })
  }

  let commandAvailable = config.commandReserve
  let competingAvailable = competingAdaptiveLimit

  const acquire = Effect.fn("WorkloadAdmission.acquire")((input: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(WorkloadAdmissionInput)(input)
      const { workloadClass } = decoded.metadata
      const cost = decoded.metadata.estimatedCost
      if (workloadClass === "command") {
        if (cost > config.commandReserve) {
          return yield* Effect.fail(
            new WorkloadAdmissionRejected({ workloadClass, reason: "cost_above_hard_limit" }),
          )
        }
        if (cost > commandAvailable) {
          return yield* Effect.fail(
            new WorkloadAdmissionRejected({ workloadClass, reason: "command_reserve_exhausted" }),
          )
        }
        commandAvailable -= cost
        return lease(workloadClass, cost, () => (commandAvailable += cost))
      }
      if (cost > competingAdaptiveLimit) {
        return yield* Effect.fail(
          new WorkloadAdmissionRejected({ workloadClass, reason: "cost_above_hard_limit" }),
        )
      }
      if (cost > competingAvailable) {
        return yield* Effect.fail(
          new WorkloadAdmissionRejected({ workloadClass, reason: "competing_capacity_exhausted" }),
        )
      }
      competingAvailable -= cost
      return lease(workloadClass, cost, () => (competingAvailable += cost))
    }),
  )

  return {
    acquire,
    available: () => ({
      commandReserve: commandAvailable,
      competingCapacity: competingAvailable,
    }),
  }
}

const lease = (
  workloadClass: WorkloadClass,
  cost: number,
  releaseCapacity: () => void,
): WorkloadLease => {
  let released = false
  return {
    workloadClass,
    cost,
    release: () => {
      if (released) return
      released = true
      releaseCapacity()
    },
  }
}
