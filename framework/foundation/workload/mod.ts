// Workload classification and admission for the non-interference target design
// (docs/architecture/workload-isolation.md, ADR-0093). Inactive: no runtime composition or
// production path depends on it until an activation ADR supplies measured evidence, so it is
// deliberately not re-exported from framework/foundation/mod.ts.
import * as Effect from "effect/Effect"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"

const NonNegativeInt = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1_000_000 }))
const PositiveBoundedInt = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000_000 }))

const WorkloadClass = Schema.Literals(["command", "query", "async"])
export type WorkloadClass = Schema.Schema.Type<typeof WorkloadClass>

export const WorkloadMetadata = Schema.Struct({
  workloadClass: WorkloadClass,
  criticality: Schema.Literals(["protected", "degradable", "discardable"]),
  consistency: Schema.Literals(["authoritative", "replica", "projection"]),
  estimatedCost: PositiveBoundedInt,
  deadlineMs: PositiveBoundedInt,
  maxInFlight: PositiveBoundedInt,
  maxQueueDepth: NonNegativeInt,
  maxStatementMs: PositiveBoundedInt,
  maxResultItems: PositiveBoundedInt,
  admissionScope: Schema.Literals(["tenant", "principal", "route"]),
})
export type WorkloadMetadata = Schema.Schema.Type<typeof WorkloadMetadata>

// The colocated entry profile keeps finite limits without claiming physical isolation.
export const EntryWorkloadLimits = {
  maxInFlight: 64,
  maxQueueDepth: 32,
  maxStatementMs: 5_000,
  maxResultItems: 1_000,
  commandReserve: 8,
} as const

export const classifyWorkload = Effect.fn("Workload.classify")(
  (input: Schema.Codec.Encoded<typeof WorkloadMetadata>) =>
    Schema.decodeUnknownEffect(WorkloadMetadata, { onExcessProperty: "error" })(input),
)

export class WorkloadAdmissionRejected extends Schema.TaggedError<WorkloadAdmissionRejected>()(
  "WorkloadAdmissionRejected",
  {
    workloadClass: WorkloadClass,
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

export type WorkloadCapacity = {
  readonly commandReserve: number
  readonly competingCapacity: number
}

export type WorkloadLease = {
  readonly workloadClass: WorkloadClass
  readonly cost: number
}

export type WorkloadAdmission = {
  /** Admits or rejects immediately; the capacity returns when the surrounding scope closes. */
  readonly admit: (
    input: Schema.Codec.Encoded<typeof WorkloadMetadata>,
  ) => Effect.Effect<WorkloadLease, WorkloadAdmissionRejected | Schema.SchemaError, Scope.Scope>
  readonly available: Effect.Effect<WorkloadCapacity>
}

type Pool = keyof WorkloadCapacity

const isPositiveCapacity = Schema.is(PositiveBoundedInt)
const isNonNegativeCapacity = Schema.is(NonNegativeInt)

const validateConfig = (config: WorkloadAdmissionConfig) => {
  if (!isPositiveCapacity(config.commandReserve)) {
    return Effect.fail(
      new WorkloadAdmissionConfigurationInvalid({ reason: "command reserve must be positive" }),
    )
  }
  if (!isNonNegativeCapacity(config.competingHardLimit)) {
    return Effect.fail(
      new WorkloadAdmissionConfigurationInvalid({ reason: "competing hard limit is invalid" }),
    )
  }
  const competingAdaptiveLimit = config.competingAdaptiveLimit ?? config.competingHardLimit
  if (
    !isNonNegativeCapacity(competingAdaptiveLimit) ||
    competingAdaptiveLimit > config.competingHardLimit
  ) {
    return Effect.fail(
      new WorkloadAdmissionConfigurationInvalid({
        reason: "adaptive limit must not exceed hard limit",
      }),
    )
  }
  return Effect.succeed({ commandReserve: config.commandReserve, competingAdaptiveLimit })
}

/**
 * Commands draw only from a reserve that query and async work can never consume, so saturated
 * reads and derived work cannot starve source-of-truth commands.
 */
export const makeWorkloadAdmission = Effect.fn("WorkloadAdmission.make")(function* (
  config: WorkloadAdmissionConfig,
) {
  const limits = yield* validateConfig(config)
  const capacity = yield* Ref.make<WorkloadCapacity>({
    commandReserve: limits.commandReserve,
    competingCapacity: limits.competingAdaptiveLimit,
  })

  const take = (workloadClass: WorkloadClass, cost: number) => {
    const pool: Pool = workloadClass === "command" ? "commandReserve" : "competingCapacity"
    const ceiling =
      workloadClass === "command" ? limits.commandReserve : limits.competingAdaptiveLimit
    return Ref.modify(capacity, (current) => {
      if (cost > ceiling) return ["cost_above_hard_limit" as const, current]
      if (cost > current[pool]) {
        return [
          workloadClass === "command"
            ? ("command_reserve_exhausted" as const)
            : ("competing_capacity_exhausted" as const),
          current,
        ]
      }
      return [pool, { ...current, [pool]: current[pool] - cost }]
    })
  }

  const admit = Effect.fn("WorkloadAdmission.admit")(function* (
    input: Schema.Codec.Encoded<typeof WorkloadMetadata>,
  ) {
    const { workloadClass, estimatedCost: cost } = yield* classifyWorkload(input)
    return yield* Effect.acquireRelease(
      Effect.flatMap(take(workloadClass, cost), (outcome) =>
        outcome === "commandReserve" || outcome === "competingCapacity"
          ? Effect.succeed({ pool: outcome, lease: { workloadClass, cost } })
          : Effect.fail(new WorkloadAdmissionRejected({ workloadClass, reason: outcome })),
      ),
      ({ pool }) =>
        Ref.update(capacity, (current) => ({ ...current, [pool]: current[pool] + cost })),
    ).pipe(Effect.map(({ lease }) => lease))
  })

  return { admit, available: Ref.get(capacity) } satisfies WorkloadAdmission
})
