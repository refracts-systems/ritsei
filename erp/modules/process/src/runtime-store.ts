import { and, eq } from "drizzle-orm"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { processRuntimeCheckpoints } from "../../../../db/schema/process.ts"
import {
  Database,
  DatabaseFailure,
  type DrizzleTransaction,
} from "../../../../framework/foundation/mod.ts"
import {
  type ProcessCheckpoint as ProcessCheckpointType,
  ProcessCheckpointInvalid,
  recoverCheckpoint,
} from "./runtime.ts"

const Uuid = Schema.String.check(Schema.isUUID())

export class ProcessCheckpointRevisionConflict extends Schema.TaggedError<ProcessCheckpointRevisionConflict>()(
  "ProcessCheckpointRevisionConflict",
  {
    instanceId: Uuid,
    expectedRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    actualRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  },
) {}

// ProcessCheckpointStore is the durable checkpoint boundary for restart recovery.
export interface ProcessCheckpointStore {
  readonly load: (
    tenantId: string,
    instanceId: string,
  ) => Effect.Effect<ProcessCheckpointType | undefined, DatabaseFailure | ProcessCheckpointInvalid>
  readonly save: (
    checkpoint: ProcessCheckpointType,
  ) => Effect.Effect<
    ProcessCheckpointType,
    DatabaseFailure | ProcessCheckpointInvalid | ProcessCheckpointRevisionConflict
  >
}

export const ProcessCheckpointStore = Context.Service<ProcessCheckpointStore>(
  "RITSEI/ProcessCheckpointStore",
)

const invalid = (reason: string) => new ProcessCheckpointInvalid({ reason })

const decodeRow = (row: {
  readonly id: string
  readonly tenantId: string
  readonly processDefinitionId: string
  readonly processDefinitionVersion: number
  readonly catalogVersion: number
  readonly environment: "DEV" | "TEST" | "PROD"
  readonly status: "running" | "waiting" | "completed" | "failed" | "manual_recovery"
  readonly failureKind:
    | "business_failure"
    | "technical_retry"
    | "unknown_external_outcome"
    | "compensation_failure"
    | null
  readonly currentNodeId: string
  readonly revision: number
  readonly state: unknown
  readonly correlationId: string
  readonly executionPrincipal: string
}) =>
  recoverCheckpoint(row.state).pipe(
    Effect.flatMap((checkpoint) =>
      checkpoint.instanceId === row.id &&
      checkpoint.tenantId === row.tenantId &&
      checkpoint.processDefinitionId === row.processDefinitionId &&
      checkpoint.processDefinitionVersion === row.processDefinitionVersion &&
      checkpoint.catalogVersion === row.catalogVersion &&
      checkpoint.environment === row.environment &&
      checkpoint.status === row.status &&
      checkpoint.failureKind === row.failureKind &&
      checkpoint.currentNodeId === row.currentNodeId &&
      checkpoint.revision === row.revision &&
      checkpoint.correlationId === row.correlationId &&
      checkpoint.executionPrincipal === row.executionPrincipal
        ? Effect.succeed(checkpoint)
        : Effect.fail(invalid("checkpoint metadata disagrees with its persisted state")),
    ),
  )

type SaveResult =
  | { readonly _tag: "Saved" }
  | {
      readonly _tag: "Conflict"
      readonly expectedRevision: number
      readonly actualRevision: number
    }

const saveRow = async (
  transaction: DrizzleTransaction,
  checkpoint: ProcessCheckpointType,
): Promise<SaveResult> => {
  const currentRows = await transaction
    .select({
      id: processRuntimeCheckpoints.id,
      revision: processRuntimeCheckpoints.revision,
    })
    .from(processRuntimeCheckpoints)
    .where(
      and(
        eq(processRuntimeCheckpoints.tenantId, checkpoint.tenantId),
        eq(processRuntimeCheckpoints.id, checkpoint.instanceId),
      ),
    )
    .for("update")
  const current = currentRows[0]

  if (current === undefined) {
    if (checkpoint.revision !== 0) {
      return { _tag: "Conflict", expectedRevision: 0, actualRevision: checkpoint.revision }
    }
    await transaction.insert(processRuntimeCheckpoints).values({
      id: checkpoint.instanceId,
      tenantId: checkpoint.tenantId,
      processDefinitionId: checkpoint.processDefinitionId,
      processDefinitionVersion: checkpoint.processDefinitionVersion,
      catalogVersion: checkpoint.catalogVersion,
      environment: checkpoint.environment,
      status: checkpoint.status,
      failureKind: checkpoint.failureKind,
      currentNodeId: checkpoint.currentNodeId,
      revision: checkpoint.revision,
      state: checkpoint,
      correlationId: checkpoint.correlationId,
      executionPrincipal: checkpoint.executionPrincipal,
    })
    return { _tag: "Saved" }
  }

  const expectedRevision = current.revision + 1
  if (checkpoint.revision !== expectedRevision) {
    return {
      _tag: "Conflict",
      expectedRevision,
      actualRevision: checkpoint.revision,
    }
  }

  const updated = await transaction
    .update(processRuntimeCheckpoints)
    .set({
      processDefinitionId: checkpoint.processDefinitionId,
      processDefinitionVersion: checkpoint.processDefinitionVersion,
      catalogVersion: checkpoint.catalogVersion,
      environment: checkpoint.environment,
      status: checkpoint.status,
      failureKind: checkpoint.failureKind,
      currentNodeId: checkpoint.currentNodeId,
      revision: checkpoint.revision,
      state: checkpoint,
      correlationId: checkpoint.correlationId,
      executionPrincipal: checkpoint.executionPrincipal,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(processRuntimeCheckpoints.id, checkpoint.instanceId),
        eq(processRuntimeCheckpoints.tenantId, checkpoint.tenantId),
        eq(processRuntimeCheckpoints.revision, current.revision),
      ),
    )
    .returning({ id: processRuntimeCheckpoints.id })

  return updated.length === 1
    ? { _tag: "Saved" }
    : {
        _tag: "Conflict",
        expectedRevision,
        actualRevision: checkpoint.revision,
      }
}

export const makePostgresProcessCheckpointStore = Effect.gen(function* () {
  const database = yield* Database
  return {
    load: (tenantId: string, instanceId: string) =>
      Effect.gen(function* () {
        if (!Schema.is(Uuid)(tenantId) || !Schema.is(Uuid)(instanceId)) {
          return yield* Effect.fail(invalid("checkpoint identity is not a UUID"))
        }
        const rows = yield* database.query(
          (db) =>
            db
              .select()
              .from(processRuntimeCheckpoints)
              .where(
                and(
                  eq(processRuntimeCheckpoints.tenantId, tenantId),
                  eq(processRuntimeCheckpoints.id, instanceId),
                ),
              ),
          "process.runtime.checkpoint.load",
        )
        const row = rows[0]
        return row === undefined ? undefined : yield* decodeRow(row)
      }),
    save: (checkpoint: ProcessCheckpointType) =>
      Effect.gen(function* () {
        const result = yield* database.transaction(
          (transaction) => saveRow(transaction, checkpoint),
          "process.runtime.checkpoint.save",
        )
        if (result._tag === "Conflict") {
          return yield* Effect.fail(
            new ProcessCheckpointRevisionConflict({
              instanceId: checkpoint.instanceId,
              expectedRevision: result.expectedRevision,
              actualRevision: result.actualRevision,
            }),
          )
        }
        return checkpoint
      }),
  } satisfies ProcessCheckpointStore
})

export const makeMemoryProcessCheckpointStore = (): ProcessCheckpointStore => {
  const checkpoints = new Map<string, ProcessCheckpointType>()
  const key = (tenantId: string, instanceId: string) => `${tenantId}:${instanceId}`
  return {
    load: (tenantId, instanceId) => Effect.succeed(checkpoints.get(key(tenantId, instanceId))),
    save: (checkpoint) => {
      const checkpointKey = key(checkpoint.tenantId, checkpoint.instanceId)
      const current = checkpoints.get(checkpointKey)
      if (current === undefined && checkpoint.revision !== 0) {
        return Effect.fail(
          new ProcessCheckpointRevisionConflict({
            instanceId: checkpoint.instanceId,
            expectedRevision: 0,
            actualRevision: checkpoint.revision,
          }),
        )
      }
      if (current !== undefined && checkpoint.revision !== current.revision + 1) {
        return Effect.fail(
          new ProcessCheckpointRevisionConflict({
            instanceId: checkpoint.instanceId,
            expectedRevision: current.revision + 1,
            actualRevision: checkpoint.revision,
          }),
        )
      }
      checkpoints.set(checkpointKey, checkpoint)
      return Effect.succeed(checkpoint)
    },
  }
}
