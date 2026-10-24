import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as TestClock from "effect/testing/TestClock"
import type { Sql } from "postgres"

import { Database, uuidv7 } from "../../../../framework/foundation/mod.ts"
import { makePostgresDatabase, runMigrations } from "../../../../framework/platform/mod.ts"
import { withTemporaryDatabase } from "../../../../tests/support/postgres-database.ts"
import { AccountingService, makeAccountingService } from "../../accounting/mod.ts"
import {
  AuthorizationService,
  makeAuthorizationTestLayer,
} from "../../../../framework/modules/authorization/mod.ts"
import { InventoryService, makeInventoryService } from "../../inventory/mod.ts"
import {
  makeMessagingService,
  MessagingService,
} from "../../../../framework/modules/messaging/mod.ts"
import { makeSalesService, SalesService } from "../../sales/mod.ts"
import {
  makeProcessService,
  ProcessJobLeaseLost,
  ProcessJobMaxAttempts,
  ProcessJobNotFound,
} from "../mod.ts"

const databaseUrl = process.env["DATABASE_URL"]

const makeProcess = (client: Sql) =>
  Effect.gen(function* () {
    const database = makePostgresDatabase(client)
    const authorization = yield* AuthorizationService

    const requirements = Layer.merge(
      Layer.succeed(Database, database),
      Layer.succeed(AuthorizationService, authorization),
    )

    const messaging = yield* makeMessagingService.pipe(Effect.provideService(Database, database))

    const sales = yield* Effect.provide(
      makeSalesService,
      Layer.merge(requirements, Layer.succeed(MessagingService, messaging)),
    )

    const inventory = yield* Effect.provide(
      makeInventoryService,
      Layer.merge(requirements, Layer.succeed(MessagingService, messaging)),
    )

    const accounting = yield* Effect.provide(
      makeAccountingService,
      Layer.mergeAll(
        requirements,
        Layer.succeed(MessagingService, messaging),
        Layer.succeed(SalesService, sales),
      ),
    )

    return yield* Effect.provide(
      makeProcessService,
      Layer.mergeAll(
        Layer.succeed(Database, database),
        Layer.succeed(AuthorizationService, authorization),
        Layer.succeed(SalesService, sales),
        Layer.succeed(InventoryService, inventory),
        Layer.succeed(AccountingService, accounting),
        Layer.succeed(MessagingService, messaging),
      ),
    )
  })

it.effect.skipIf(databaseUrl === undefined)(
  "fences Process job leases and moves exhausted retries to manual recovery",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      TestClock.withLive(
        Effect.gen(function* () {
          yield* runMigrations(client)

          const [tenant] = yield* Effect.promise(
            () =>
              client<{ id: string }[]>`
            insert into auth.tenants (slug) values (${uuidv7()}) returning id
          `,
          )

          const authorizationLayer = makeAuthorizationTestLayer([])
          const process = yield* makeProcess(client).pipe(Effect.provide(authorizationLayer))

          const [job] = yield* Effect.promise(
            () =>
              client<{ id: string }[]>`
            insert into process.jobs
              (tenant_id, job_type, idempotency_key, scheduled_at, payload, correlation_id)
            values
              (${tenant!.id}, 'process.order_confirmation.post_commit', 'lease-test-1',
               now() - interval '1 second',
               ${JSON.stringify({ eventId: uuidv7() })}::jsonb, 'lease-correlation-1')
            returning id
          `,
          )

          const first = yield* process.claimJob({
            tenantId: tenant!.id,
            workerId: "worker-a",
          })

          assert.isNotNull(first)
          assert.strictEqual(first!.jobId, job!.id)
          assert.strictEqual(first!.status, "leased")
          assert.strictEqual(first!.leaseOwner, "worker-a")
          assert.isNotNull(first!.leaseToken)
          assert.strictEqual(first!.leaseGeneration, "1")

          assert.isNull(
            yield* process.claimJob({
              tenantId: tenant!.id,
              workerId: "worker-b",
            }),
          )

          yield* Effect.promise(
            () =>
              client`
            update process.jobs
            set lease_until = now() - interval '1 second'
            where id = ${job!.id}
          `,
          )
          assert.instanceOf(
            yield* Effect.flip(
              process.renewJob({
                tenantId: tenant!.id,
                workerId: "worker-a",
                jobId: job!.id,
                leaseToken: first!.leaseToken!,
                leaseGeneration: first!.leaseGeneration!,
              }),
            ),
            ProcessJobLeaseLost,
          )

          const second = yield* process.claimJob({
            tenantId: tenant!.id,
            workerId: "worker-b",
          })

          assert.isNotNull(second)
          assert.strictEqual(second!.leaseOwner, "worker-b")
          assert.notStrictEqual(second!.leaseToken, first!.leaseToken)
          assert.strictEqual(second!.attempts, 2)
          assert.strictEqual(second!.leaseGeneration, "2")

          assert.instanceOf(
            yield* Effect.flip(
              process.renewJob({
                tenantId: tenant!.id,
                workerId: "worker-a",
                jobId: job!.id,
                leaseToken: first!.leaseToken!,
                leaseGeneration: first!.leaseGeneration!,
              }),
            ),
            ProcessJobLeaseLost,
          )
          assert.instanceOf(
            yield* Effect.flip(
              process.completeJob({
                tenantId: tenant!.id,
                workerId: "worker-a",
                jobId: job!.id,
                leaseToken: first!.leaseToken!,
                leaseGeneration: first!.leaseGeneration!,
              }),
            ),
            ProcessJobLeaseLost,
          )
          assert.instanceOf(
            yield* Effect.flip(
              process.failJob({
                tenantId: tenant!.id,
                workerId: "worker-a",
                jobId: job!.id,
                leaseToken: first!.leaseToken!,
                leaseGeneration: first!.leaseGeneration!,
                error: "stale worker",
                retryAt: null,
              }),
            ),
            ProcessJobLeaseLost,
          )

          const retryAt = new Date(Date.now() - 1_000).toISOString()

          const pending = yield* process.failJob({
            tenantId: tenant!.id,
            workerId: "worker-b",
            jobId: job!.id,
            leaseToken: second!.leaseToken!,
            leaseGeneration: second!.leaseGeneration!,
            error: "retryable worker failure",
            retryAt,
          })

          assert.strictEqual(pending.status, "pending")
          assert.isNull(pending.leaseOwner)
          assert.isNull(pending.leaseToken)

          const third = yield* process.claimJob({
            tenantId: tenant!.id,
            workerId: "worker-c",
          })

          assert.isNotNull(third)
          assert.strictEqual(third!.attempts, ProcessJobMaxAttempts)
          assert.strictEqual(third!.leaseGeneration, "3")

          const recovered = yield* process.failJob({
            tenantId: tenant!.id,
            workerId: "worker-c",
            jobId: job!.id,
            leaseToken: third!.leaseToken!,
            leaseGeneration: third!.leaseGeneration!,
            error: "retry exhausted",
            retryAt,
          })

          assert.strictEqual(recovered.status, "manual_recovery")
          assert.isNull(recovered.leaseOwner)
          assert.isNull(recovered.leaseToken)

          assert.instanceOf(
            yield* Effect.flip(
              process.completeJob({
                tenantId: tenant!.id,
                workerId: "worker-c",
                jobId: job!.id,
                leaseToken: third!.leaseToken!,
                leaseGeneration: third!.leaseGeneration!,
              }),
            ),
            ProcessJobLeaseLost,
          )
          assert.instanceOf(
            yield* Effect.flip(
              process.renewJob({
                tenantId: tenant!.id,
                workerId: "worker-c",
                jobId: uuidv7(),
                leaseToken: uuidv7(),
                leaseGeneration: "1",
              }),
            ),
            ProcessJobNotFound,
          )
        }).pipe(Effect.provide(makeAuthorizationTestLayer([]))),
      ),
    ),
)

it.effect.skipIf(databaseUrl === undefined)(
  "allocates distinct generations for concurrent claims in one fence scope",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      TestClock.withLive(
        Effect.gen(function* () {
          yield* runMigrations(client)

          const [tenant] = yield* Effect.promise(
            () =>
              client<{ id: string }[]>`
            insert into auth.tenants (slug) values (${uuidv7()}) returning id
          `,
          )

          const fenceScope = `test.fence:${tenant!.id}:${uuidv7()}`
          yield* Effect.promise(
            () =>
              client`
            insert into process.jobs
              (tenant_id, fence_scope, job_type, idempotency_key, scheduled_at, payload, correlation_id)
            values
              (${tenant!.id}, ${fenceScope}, 'process.order_confirmation.post_commit', 'claim-a',
               now() - interval '1 second', '{}'::jsonb, 'claim-a'),
              (${tenant!.id}, ${fenceScope}, 'process.order_confirmation.post_commit', 'claim-b',
               now() - interval '1 second', '{}'::jsonb, 'claim-b')
          `,
          )

          const process = yield* makeProcess(client).pipe(
            Effect.provide(makeAuthorizationTestLayer([])),
          )

          const claimed = yield* Effect.all(
            [
              process.claimJob({ tenantId: tenant!.id, workerId: "worker-a" }),
              process.claimJob({ tenantId: tenant!.id, workerId: "worker-b" }),
            ],
            { concurrency: "unbounded" },
          )

          const generations = claimed
            .map((job) => job?.leaseGeneration)
            .filter((generation): generation is string => generation !== undefined)

          assert.strictEqual(generations.length, 2)
          assert.strictEqual(new Set(generations).size, 2)
          assert.deepStrictEqual(new Set(generations), new Set(["1", "2"]))
        }),
      ),
    ),
)

it.effect.skipIf(databaseUrl === undefined)(
  "reclaims an expired lease after worker termination",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      TestClock.withLive(
        Effect.gen(function* () {
          yield* runMigrations(client)

          const [tenant] = yield* Effect.promise(
            () =>
              client<{ id: string }[]>`
              insert into auth.tenants (slug) values (${uuidv7()}) returning id
            `,
          )

          const fenceScope = `test.termination:${tenant!.id}:${uuidv7()}`

          const [job] = yield* Effect.promise(
            () =>
              client<{ id: string }[]>`
              insert into process.jobs
                (tenant_id, fence_scope, job_type, idempotency_key, scheduled_at, payload, correlation_id)
              values
                (${tenant!.id}, ${fenceScope}, 'process.order_confirmation.post_commit',
                 ${uuidv7()}, now() - interval '1 second', '{}'::jsonb, ${uuidv7()})
              returning id
            `,
          )

          const workerA = yield* makeProcess(client).pipe(
            Effect.provide(makeAuthorizationTestLayer([])),
          )

          const workerB = yield* makeProcess(client).pipe(
            Effect.provide(makeAuthorizationTestLayer([])),
          )

          const first = yield* workerA.claimJob({
            tenantId: tenant!.id,
            workerId: "worker-a",
          })

          assert.isNotNull(first)
          assert.strictEqual(first!.leaseGeneration, "1")

          // Worker A terminates without completing the leased job.
          yield* Effect.promise(
            () =>
              client`
              update process.jobs
              set lease_until = now() - interval '1 second'
              where id = ${job!.id}
            `,
          )

          const second = yield* workerB.claimJob({
            tenantId: tenant!.id,
            workerId: "worker-b",
          })

          assert.isNotNull(second)
          assert.strictEqual(second!.fenceScope, first!.fenceScope)
          assert.strictEqual(second!.leaseGeneration, "2")
          assert.strictEqual(second!.leaseOwner, "worker-b")

          const staleCompletion = yield* Effect.flip(
            workerA.completeJob({
              tenantId: tenant!.id,
              workerId: "worker-a",
              jobId: first!.jobId,
              leaseToken: first!.leaseToken!,
              leaseGeneration: first!.leaseGeneration,
            }),
          )

          assert.instanceOf(staleCompletion, ProcessJobLeaseLost)

          const completed = yield* workerB.completeJob({
            tenantId: tenant!.id,
            workerId: "worker-b",
            jobId: second!.jobId,
            leaseToken: second!.leaseToken!,
            leaseGeneration: second!.leaseGeneration,
          })

          assert.strictEqual(completed.status, "completed")
          assert.strictEqual(completed.leaseGeneration, "2")
        }),
      ),
    ),
)
