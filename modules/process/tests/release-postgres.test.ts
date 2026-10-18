import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import type { Sql } from "postgres"

import { Database, uuidv7 } from "../../../foundation/mod.ts"
import { makePostgresDatabase, runMigrations } from "../../../platform/mod.ts"
import { withTemporaryDatabase } from "../../../tests/support/postgres-database.ts"
import {
  makePostgresProcessReleaseStore,
  ProcessDeploymentConflict,
  ProcessReleaseConflict,
} from "../mod.ts"

const databaseUrl = process.env["DATABASE_URL"]

it.effect.skipIf(databaseUrl === undefined)(
  "proves release immutability, promotion audit, and environment binding",
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
        const input = {
          tenantId: tenant!.id,
          validation: {
            status: "VALIDATED" as const,
            definitionId: uuidv7(),
            definitionVersion: 1,
            catalogVersion: 1,
            references: [],
          },
          checksum: "ir-checksum-1",
          approvedBy: "approver-1",
          approvalReason: "reviewed by process owner",
          releasedBy: "publisher-1",
        }
        const store = yield* makePostgresProcessReleaseStore.pipe(
          Effect.provideService(Database, database),
        )
        const release = yield* store.release(input)
        const restartedStore = yield* makePostgresProcessReleaseStore.pipe(
          Effect.provideService(Database, database),
        )
        const replay = yield* restartedStore.release(input)
        const conflict = yield* Effect.flip(
          restartedStore.release({
            ...input,
            checksum: "different-ir-checksum",
          }),
        )
        const deploymentInput = {
          tenantId: tenant!.id,
          releaseId: release.id,
          environment: "TEST" as const,
          deployedBy: "operator-1",
          promotionReason: "promote the reviewed release to test",
        }
        const deployment = yield* restartedStore.deploy(deploymentInput)
        const deploymentReplay = yield* store.deploy(deploymentInput)
        const deploymentConflict = yield* Effect.flip(
          store.deploy({
            ...deploymentInput,
            promotionReason: "different promotion",
          }),
        )
        const mutationFailure = yield* Effect.tryPromise({
          try: () =>
            client`
              update process.releases set checksum = 'mutated' where id = ${release.id}
            `,
          catch: (cause) => cause,
        }).pipe(Effect.flip)
        const audits = yield* Effect.promise(
          () =>
            client<{ event: string; environment: string | null }[]>`
            select event, environment from process.release_audits
            where tenant_id = ${tenant!.id} and release_id = ${release.id}
            order by created_at, id
          `,
        )

        assert.strictEqual(replay.id, release.id)
        assert.instanceOf(conflict, ProcessReleaseConflict)
        assert.strictEqual(deploymentReplay.id, deployment.id)
        assert.instanceOf(deploymentConflict, ProcessDeploymentConflict)
        assert.isTrue(String(mutationFailure).includes("immutable"))
        assert.deepStrictEqual(
          [...audits].sort((left, right) => (left.event < right.event ? -1 : 1)),
          [
            { event: "approval", environment: null },
            { event: "deployment", environment: "TEST" },
            { event: "release", environment: null },
          ],
        )
      }),
    ),
)
