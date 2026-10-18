import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type { Sql } from "postgres"

import { Database, uuidv7 } from "../../../foundation/mod.ts"
import { makePostgresDatabase, runMigrations } from "../../../platform/mod.ts"
import { withTemporaryDatabase } from "../../../tests/support/postgres-database.ts"
import {
  makePostgresProcessCheckpointStore,
  makeProcessRuntime,
  ProcessCheckpoint,
  ProcessCheckpointRevisionConflict,
} from "../mod.ts"

const databaseUrl = process.env["DATABASE_URL"]

const makeCheckpoint = (tenantId: string) => ({
  instanceId: uuidv7(),
  tenantId,
  processDefinitionId: uuidv7(),
  processDefinitionVersion: 1,
  catalogVersion: 1,
  environment: "TEST",
  status: "running",
  failureKind: null,
  currentNodeId: "start",
  revision: 0,
  completedStepIds: [],
  stepExecutions: [],
  consumedEventIds: [],
  scheduledTimerIds: [],
  correlationId: "runtime-correlation-1",
  causationId: null,
  executionPrincipal: "process-principal-1",
} as const)

it.effect.skipIf(databaseUrl === undefined)(
  "proves crash recovery and restart with duplicate event safety and exact catalog version",
  () =>
    withTemporaryDatabase(databaseUrl!, (client: Sql) =>
      Effect.gen(function*() {
        yield* runMigrations(client)
        const [tenant] = yield* Effect.promise(() =>
          client<{ id: string }[]>`
            insert into auth.tenants (slug) values (${uuidv7()}) returning id
          `
        )
        const database = makePostgresDatabase(client)
        const store = yield* makePostgresProcessCheckpointStore.pipe(
          Effect.provideService(Database, database),
        )
        const checkpoint = yield* Schema.decodeUnknownEffect(ProcessCheckpoint)(
          makeCheckpoint(tenant!.id),
        )
        const runtime = makeProcessRuntime()
        yield* store.save(checkpoint)
        const withEvent = yield* runtime.recordEvent(
          checkpoint,
          "018f3f77-0c5a-7cc0-8b62-6a163d214123",
        )
        const duplicateEvent = yield* runtime.recordEvent(
          withEvent,
          "018f3f77-0c5a-7cc0-8b62-6a163d214123",
        )
        const saved = yield* store.save(duplicateEvent)

        const restartedStore = yield* makePostgresProcessCheckpointStore.pipe(
          Effect.provideService(Database, database),
        )
        const recovered = yield* restartedStore.load(tenant!.id, checkpoint.instanceId)
        assert.deepStrictEqual(recovered, saved)
        assert.deepStrictEqual(recovered?.consumedEventIds, [
          "018f3f77-0c5a-7cc0-8b62-6a163d214123",
        ])
        assert.strictEqual(recovered?.catalogVersion, 1)

        const stale = yield* Effect.flip(store.save(saved))
        assert.instanceOf(stale, ProcessCheckpointRevisionConflict)
        assert.strictEqual(stale.expectedRevision, 2)
        assert.strictEqual(stale.actualRevision, 1)
      })),
)
