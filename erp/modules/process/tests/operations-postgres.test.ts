import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type { Sql } from "postgres"

import { Database, uuidv7 } from "../../../../framework/foundation/mod.ts"
import { makePostgresDatabase, runMigrations } from "../../../../framework/platform/mod.ts"
import { withTemporaryDatabase } from "../../../../tests/support/postgres-database.ts"
import {
  makePostgresProcessCheckpointStore,
  makePostgresProcessOperatorStore,
  ProcessCheckpoint,
  ProcessOperatorConflict,
} from "../mod.ts"

const databaseUrl = process.env["DATABASE_URL"]

it.effect.skipIf(databaseUrl === undefined)(
  "persists operator control for unknown external outcome after crash recovery",
  () =>
    withTemporaryDatabase(databaseUrl!, (client: Sql) =>
      Effect.gen(function* () {
        yield* runMigrations(client)

        const [tenant] = yield* Effect.promise(
          () =>
            client<{ id: string }[]>`
            insert into auth.tenants (slug) values (${uuidv7()}) returning id
          `,
        )

        const database = makePostgresDatabase(client)

        const checkpointStore = yield* makePostgresProcessCheckpointStore.pipe(
          Effect.provideService(Database, database),
        )

        const checkpoint = yield* Schema.decodeUnknownEffect(ProcessCheckpoint)({
          instanceId: uuidv7(),
          tenantId: tenant!.id,
          processDefinitionId: uuidv7(),
          processDefinitionVersion: 1,
          catalogVersion: 1,
          environment: "TEST",
          status: "failed",
          failureKind: "unknown_external_outcome",
          currentNodeId: "payment",
          revision: 0,
          completedStepIds: [],
          stepExecutions: [],
          consumedEventIds: [],
          scheduledTimerIds: [],
          correlationId: "operator-correlation-1",
          causationId: null,
          executionPrincipal: "process-principal-1",
        })

        yield* checkpointStore.save(checkpoint)

        const input = {
          tenantId: tenant!.id,
          instanceId: checkpoint.instanceId,
          action: "manual_recovery" as const,
          actorPrincipalId: "operator-1",
          idempotencyKey: "operator-control-1",
          reason: "provider status requires review",
        }

        const store = yield* makePostgresProcessOperatorStore.pipe(
          Effect.provideService(Database, database),
        )

        const first = yield* store.record(input)

        const restartedStore = yield* makePostgresProcessOperatorStore.pipe(
          Effect.provideService(Database, database),
        )

        const replay = yield* restartedStore.record(input)

        const conflict = yield* Effect.flip(
          restartedStore.record({
            ...input,
            action: "compensate",
          }),
        )

        assert.strictEqual(replay.id, first.id)
        assert.strictEqual(replay.action, "manual_recovery")
        assert.instanceOf(conflict, ProcessOperatorConflict)
      }),
    ),
)
