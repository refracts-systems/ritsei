import { and, eq } from "drizzle-orm"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"

import { processOperatorControls as operatorControls } from "../../../../db/schema/process.ts"
import {
  Database,
  DatabaseFailure,
  type DrizzleTransaction,
  isDatabaseConstraint,
  uuidv7,
} from "../../../../framework/foundation/mod.ts"
import {
  ProcessOperatorConflict,
  ProcessOperatorControlInput,
  type ProcessOperatorControlInput as ProcessOperatorControlInputType,
} from "./operations.ts"

const Uuid = Schema.String.check(Schema.isUUID())
const NonEmptyString = Schema.String.check(Schema.isPattern(/\S/))

export const ProcessOperatorControl = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  instanceId: Uuid,
  action: ProcessOperatorControlInput.fields.action,
  actorPrincipalId: NonEmptyString,
  idempotencyKey: NonEmptyString,
  reason: NonEmptyString,
  createdAt: NonEmptyString,
})
export type ProcessOperatorControl = Schema.Schema.Type<typeof ProcessOperatorControl>

// ProcessOperatorStore is the durable audit boundary for authorized operator controls.
// authorized operator commands cover retry, manual recovery, and compensation.
export interface ProcessOperatorStore {
  readonly record: (
    input: Schema.Codec.Encoded<typeof ProcessOperatorControlInput>,
  ) => Effect.Effect<
    ProcessOperatorControl,
    ProcessOperatorConflict | DatabaseFailure | Schema.SchemaError
  >
}

export const ProcessOperatorStore = Context.Service<ProcessOperatorStore>(
  "RITSEI/ProcessOperatorStore",
)

const toControl = (row: {
  readonly id: string
  readonly tenantId: string
  readonly instanceId: string
  readonly action: "retry" | "compensate" | "manual_recovery"
  readonly actorPrincipalId: string
  readonly idempotencyKey: string
  readonly reason: string
  readonly createdAt: Date
}): ProcessOperatorControl => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
})

const sameControl = (
  control: ProcessOperatorControl,
  input: ProcessOperatorControlInputType,
): boolean =>
  control.tenantId === input.tenantId &&
  control.instanceId === input.instanceId &&
  control.action === input.action &&
  control.actorPrincipalId === input.actorPrincipalId &&
  control.idempotencyKey === input.idempotencyKey &&
  control.reason === input.reason

type RecordResult =
  | { readonly _tag: "Recorded"; readonly control: ProcessOperatorControl }
  | { readonly _tag: "Conflict" }

const recordRow = async (
  transaction: DrizzleTransaction,
  input: ProcessOperatorControlInputType,
): Promise<RecordResult> => {
  const existingRows = await transaction
    .select()
    .from(operatorControls)
    .where(
      and(
        eq(operatorControls.tenantId, input.tenantId),
        eq(operatorControls.idempotencyKey, input.idempotencyKey),
      ),
    )
    .for("update")
  const existing = existingRows[0]
  if (existing !== undefined) {
    const control = toControl(existing)
    return sameControl(control, input) ? { _tag: "Recorded", control } : { _tag: "Conflict" }
  }

  const rows = await transaction
    .insert(operatorControls)
    .values({
      id: uuidv7(),
      tenantId: input.tenantId,
      instanceId: input.instanceId,
      action: input.action,
      actorPrincipalId: input.actorPrincipalId,
      idempotencyKey: input.idempotencyKey,
      reason: input.reason,
    })
    .returning()
  return { _tag: "Recorded", control: toControl(rows[0]!) }
}

export const makePostgresProcessOperatorStore = Effect.gen(function* () {
  const database = yield* Database
  return {
    record: (input: Schema.Codec.Encoded<typeof ProcessOperatorControlInput>) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(ProcessOperatorControlInput)(input)
        const result = yield* database
          .transaction(
            (transaction) => recordRow(transaction, decoded),
            "process.operator_control.record",
          )
          .pipe(Effect.result)
        if (Result.isSuccess(result)) {
          return result.success._tag === "Recorded"
            ? result.success.control
            : yield* Effect.fail(
                new ProcessOperatorConflict({
                  tenantId: decoded.tenantId,
                  instanceId: decoded.instanceId,
                  idempotencyKey: decoded.idempotencyKey,
                }),
              )
        }
        if (isDatabaseConstraint(result.failure, "operator_controls_tenant_id_key")) {
          const rows = yield* database.query(
            (db) =>
              db
                .select()
                .from(operatorControls)
                .where(
                  and(
                    eq(operatorControls.tenantId, decoded.tenantId),
                    eq(operatorControls.idempotencyKey, decoded.idempotencyKey),
                  ),
                ),
            "process.operator_control.replay",
          )
          const existing = rows[0]
          if (existing !== undefined) {
            const control = toControl(existing)
            if (sameControl(control, decoded)) return control
          }
          return yield* Effect.fail(
            new ProcessOperatorConflict({
              tenantId: decoded.tenantId,
              instanceId: decoded.instanceId,
              idempotencyKey: decoded.idempotencyKey,
            }),
          )
        }
        return yield* Effect.fail(result.failure)
      }),
  } satisfies ProcessOperatorStore
})

export const makeMemoryProcessOperatorStore = (): ProcessOperatorStore => {
  const controls = new Map<string, ProcessOperatorControl>()
  return {
    record: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(ProcessOperatorControlInput)(input)
        const key = `${decoded.tenantId}:${decoded.idempotencyKey}`
        const existing = controls.get(key)
        if (existing !== undefined) {
          if (sameControl(existing, decoded)) return existing
          return yield* Effect.fail(
            new ProcessOperatorConflict({
              tenantId: decoded.tenantId,
              instanceId: decoded.instanceId,
              idempotencyKey: decoded.idempotencyKey,
            }),
          )
        }
        const control: ProcessOperatorControl = {
          id: uuidv7(),
          ...decoded,
          createdAt: new Date().toISOString(),
        }
        controls.set(key, control)
        return control
      }),
  }
}
