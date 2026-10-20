import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

const Uuid = Schema.String.check(Schema.isUUID())
const NonEmptyString = Schema.String.check(Schema.isPattern(/\S/))
const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))
const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export const ProcessNodeKind = Schema.Literals([
  "Start",
  "DomainCommand",
  "HumanTask",
  "Decision",
  "WaitForEvent",
  "Timer",
  "ParallelBranch",
  "End",
])

export const ProcessEnvironment = Schema.Literals(["DEV", "TEST", "PROD"])
export const ProcessRuntimeStatus = Schema.Literals([
  "running",
  "waiting",
  "completed",
  "failed",
  "manual_recovery",
])
export const ProcessFailureKind = Schema.Literals([
  "business_failure",
  "technical_retry",
  "unknown_external_outcome",
  "compensation_failure",
])

export const ProcessStepStatus = Schema.Literals([
  "command_requested",
  "command_started",
  "command_succeeded",
  "command_failed",
  "retry_scheduled",
  "compensation_started",
  "compensation_succeeded",
  "manual_recovery_required",
])

export const ProcessDefinitionNode = Schema.Struct({
  id: NonEmptyString,
  kind: ProcessNodeKind,
})
export const ProcessDefinitionEdge = Schema.Struct({
  from: NonEmptyString,
  to: NonEmptyString,
})
export const ProcessDefinition = Schema.Struct({
  id: Uuid,
  version: PositiveInt,
  catalogVersion: PositiveInt,
  environment: ProcessEnvironment,
  nodes: Schema.Array(ProcessDefinitionNode),
  edges: Schema.Array(ProcessDefinitionEdge),
  checksum: NonEmptyString,
})

export const ProcessStepExecution = Schema.Struct({
  stepId: NonEmptyString,
  nodeId: NonEmptyString,
  idempotencyKey: NonEmptyString,
  status: ProcessStepStatus,
  commandId: Schema.NullOr(NonEmptyString),
  eventId: Schema.NullOr(Uuid),
})

export const ProcessCheckpoint = Schema.Struct({
  instanceId: Uuid,
  tenantId: Uuid,
  processDefinitionId: Uuid,
  processDefinitionVersion: PositiveInt,
  catalogVersion: PositiveInt,
  environment: ProcessEnvironment,
  status: ProcessRuntimeStatus,
  failureKind: Schema.NullOr(ProcessFailureKind),
  currentNodeId: NonEmptyString,
  revision: NonNegativeInt,
  completedStepIds: Schema.Array(NonEmptyString),
  stepExecutions: Schema.Array(ProcessStepExecution),
  consumedEventIds: Schema.Array(Uuid),
  scheduledTimerIds: Schema.Array(NonEmptyString),
  correlationId: NonEmptyString,
  causationId: Schema.NullOr(NonEmptyString),
  executionPrincipal: NonEmptyString,
})

export type ProcessDefinition = Schema.Schema.Type<typeof ProcessDefinition>
export type ProcessCheckpoint = Schema.Schema.Type<typeof ProcessCheckpoint>
export type ProcessStepExecution = Schema.Schema.Type<typeof ProcessStepExecution>
export type ProcessFailureKind = Schema.Schema.Type<typeof ProcessFailureKind>

export class ProcessCheckpointInvalid extends Schema.TaggedError<ProcessCheckpointInvalid>()(
  "ProcessCheckpointInvalid",
  {
    reason: NonEmptyString,
  },
) {}

export class ProcessRuntimeVersionConflict extends Schema.TaggedError<ProcessRuntimeVersionConflict>()(
  "ProcessRuntimeVersionConflict",
  {
    instanceId: Uuid,
    pinnedCatalogVersion: PositiveInt,
    requestedCatalogVersion: PositiveInt,
  },
) {}

export class ProcessStepConflict extends Schema.TaggedError<ProcessStepConflict>()(
  "ProcessStepConflict",
  {
    instanceId: Uuid,
    idempotencyKey: NonEmptyString,
  },
) {}

export type ProcessRuntime = {
  readonly pinCatalogVersion: (
    checkpoint: ProcessCheckpoint,
    catalogVersion: number,
  ) => Effect.Effect<ProcessCheckpoint, ProcessRuntimeVersionConflict>
  readonly recoverCheckpoint: (
    input: Schema.Json,
  ) => Effect.Effect<ProcessCheckpoint, ProcessCheckpointInvalid>
  readonly recordCommand: (
    checkpoint: ProcessCheckpoint,
    execution: ProcessStepExecution,
  ) => Effect.Effect<ProcessCheckpoint, ProcessStepConflict>
  readonly recordEvent: (
    checkpoint: ProcessCheckpoint,
    eventId: string,
  ) => Effect.Effect<ProcessCheckpoint, ProcessCheckpointInvalid>
  readonly scheduleTimer: (
    checkpoint: ProcessCheckpoint,
    timerId: string,
  ) => Effect.Effect<ProcessCheckpoint, ProcessCheckpointInvalid>
}

const has = (values: readonly string[], value: string): boolean => values.includes(value)
const nextRevision = (checkpoint: ProcessCheckpoint): number => checkpoint.revision + 1

/** Decodes a checkpoint as stored, so a corrupt row fails instead of resuming. */
export const recoverCheckpoint = (input: Schema.Json) =>
  Schema.decodeUnknownEffect(ProcessCheckpoint)(input).pipe(
    Effect.mapError(
      () =>
        new ProcessCheckpointInvalid({
          reason: "checkpoint does not match the durable runtime contract",
        }),
    ),
  )

export const makeProcessRuntime = (): ProcessRuntime => ({
  pinCatalogVersion: (checkpoint, catalogVersion) =>
    checkpoint.catalogVersion === catalogVersion
      ? Effect.succeed(checkpoint)
      : Effect.fail(
          new ProcessRuntimeVersionConflict({
            instanceId: checkpoint.instanceId,
            pinnedCatalogVersion: checkpoint.catalogVersion,
            requestedCatalogVersion: catalogVersion,
          }),
        ),

  recoverCheckpoint,

  recordCommand: (checkpoint, execution) => {
    const existingByStep = checkpoint.stepExecutions.find(
      (current) => current.stepId === execution.stepId,
    )
    const existingByKey = checkpoint.stepExecutions.find(
      (current) => current.idempotencyKey === execution.idempotencyKey,
    )
    if (
      existingByStep !== undefined &&
      existingByStep.idempotencyKey === execution.idempotencyKey
    ) {
      return Effect.succeed(checkpoint)
    }
    if (existingByStep !== undefined || existingByKey !== undefined) {
      return Effect.fail(
        new ProcessStepConflict({
          instanceId: checkpoint.instanceId,
          idempotencyKey: execution.idempotencyKey,
        }),
      )
    }
    return Effect.succeed({
      ...checkpoint,
      revision: nextRevision(checkpoint),
      stepExecutions: [...checkpoint.stepExecutions, execution],
      completedStepIds:
        execution.status === "command_succeeded"
          ? [...checkpoint.completedStepIds, execution.stepId]
          : checkpoint.completedStepIds,
    })
  },

  recordEvent: (checkpoint, eventId) => {
    if (!Schema.is(Uuid)(eventId)) {
      return Effect.fail(new ProcessCheckpointInvalid({ reason: "event ID is not a UUID" }))
    }
    return Effect.succeed(
      has(checkpoint.consumedEventIds, eventId)
        ? checkpoint
        : {
            ...checkpoint,
            revision: nextRevision(checkpoint),
            consumedEventIds: [...checkpoint.consumedEventIds, eventId],
          },
    )
  },

  scheduleTimer: (checkpoint, timerId) => {
    if (!/\S/.test(timerId)) {
      return Effect.fail(new ProcessCheckpointInvalid({ reason: "timer ID is blank" }))
    }
    return Effect.succeed(
      has(checkpoint.scheduledTimerIds, timerId)
        ? checkpoint
        : {
            ...checkpoint,
            revision: nextRevision(checkpoint),
            scheduledTimerIds: [...checkpoint.scheduledTimerIds, timerId],
          },
    )
  },
})
