import { assert, it } from "@effect/vitest"
import * as Clock from "effect/Clock"
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
  makeProcessJobEnqueuer,
  makeProcessService,
  ProcessDocumentJobTypes,
  ProcessJobLeaseLost,
  ProcessJobMaxAttempts,
  ProcessJobNotFound,
} from "../mod.ts"

const databaseUrl = process.env["DATABASE_URL"]

it.effect.skipIf(databaseUrl === undefined)(
  "enqueues and claims invoice render jobs transactionally",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      TestClock.withLive(
        Effect.gen(function* () {
          yield* runMigrations(client)

          const [tenant] = yield* Effect.promise(
            () =>
              client<
                { id: string }[]
              >`insert into auth.tenants (slug) values (${uuidv7()}) returning id`,
          )

          const database = makePostgresDatabase(client)

          const enqueuer = yield* makeProcessJobEnqueuer.pipe(
            Effect.provideService(Database, database),
          )

          const process = yield* makeProcess(client).pipe(
            Effect.provide(makeAuthorizationTestLayer([])),
          )

          const jobInput = {
            tenantId: tenant!.id,
            jobType: ProcessDocumentJobTypes.invoiceRender,
            idempotencyKey: uuidv7(),
            priority: 0,
            payload: { probe: true },
            correlationId: "invoice-render-evaluation",
          }

          const rolledBack = yield* Effect.flip(
            database.withTransaction(
              Effect.gen(function* () {
                yield* enqueuer.enqueue(jobInput)

                return yield* Effect.fail("rollback")
              }),
            ),
          )

          assert.strictEqual(rolledBack, "rollback")

          const absent = yield* process.claimJob({
            tenantId: tenant!.id,
            workerId: "evaluation-worker",
            jobType: ProcessDocumentJobTypes.invoiceRender,
          })

          assert.isNull(absent)

          const queued = yield* enqueuer.enqueue(jobInput)
          const replay = yield* enqueuer.enqueue(jobInput)

          assert.strictEqual(replay.jobId, queued.jobId)

          const claimed = yield* process.claimJob({
            tenantId: tenant!.id,
            workerId: "evaluation-worker",
            jobType: ProcessDocumentJobTypes.invoiceRender,
          })

          assert.isNotNull(claimed)
          assert.strictEqual(claimed!.jobId, queued.jobId)
          assert.strictEqual(claimed!.leaseGeneration, "1")
        }),
      ),
    ),
)

// A job is due when its scheduled time is not after the service clock, so the enqueue and the claim
// must read the same clock. A job stamped by the database clock is invisible to a service whose clock
// is behind it, which made a claim right after an enqueue return null whenever the database ran
// ahead by even a millisecond. A virtual clock an hour behind the database makes that gap exact, so
// the claim needs no sleep and no retry.
it.effect.skipIf(databaseUrl === undefined)(
  "a job is claimable right after it is enqueued, whatever the database clock says",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)

        const [tenant] = yield* Effect.promise(
          () =>
            client<
              { id: string }[]
            >`insert into auth.tenants (slug) values (${uuidv7()}) returning id`,
        )

        const database = makePostgresDatabase(client)

        yield* TestClock.setTime(Date.now() - 3_600_000)

        const enqueuer = yield* makeProcessJobEnqueuer.pipe(
          Effect.provideService(Database, database),
        )

        const process = yield* makeProcess(client).pipe(
          Effect.provide(makeAuthorizationTestLayer([])),
        )

        const queued = yield* enqueuer.enqueue({
          tenantId: tenant!.id,
          jobType: ProcessDocumentJobTypes.invoiceRender,
          idempotencyKey: uuidv7(),
          priority: 0,
          payload: { probe: true },
          correlationId: "job-clock",
        })

        const claimed = yield* process.claimJob({
          tenantId: tenant!.id,
          workerId: "job-clock-worker",
          jobType: ProcessDocumentJobTypes.invoiceRender,
        })

        assert.isNotNull(claimed)
        assert.strictEqual(claimed!.jobId, queued.jobId)
      }),
    ),
  { timeout: 120_000 },
)

/** A service clock that runs ahead of (or behind) the real one, as another host's clock might. */
const skewedClock = (base: Clock.Clock, offsetMs: number): Clock.Clock => ({
  // Only the wall clock is shifted; monotonic time and sleeping stay real.
  monotonicTimeNanosUnsafe: () => base.monotonicTimeNanosUnsafe(),
  monotonicTimeNanos: base.monotonicTimeNanos,
  sleep: (duration) => base.sleep(duration),
  currentTimeMillisUnsafe: () => base.currentTimeMillisUnsafe() + offsetMs,
  currentTimeMillis: Effect.sync(() => base.currentTimeMillisUnsafe() + offsetMs),
  currentTimeNanosUnsafe: () => base.currentTimeNanosUnsafe() + BigInt(offsetMs) * 1_000_000n,
  currentTimeNanos: Effect.sync(
    () => base.currentTimeNanosUnsafe() + BigInt(offsetMs) * 1_000_000n,
  ),
})

const hostAt = (client: Sql, base: Clock.Clock, offsetMs: number) =>
  makeProcess(client).pipe(
    Effect.provideService(Clock.Clock, skewedClock(base, offsetMs)),
    Effect.provide(makeAuthorizationTestLayer([])),
  )

const tenantOf = (client: Sql) =>
  Effect.promise(
    () =>
      client<{ id: string }[]>`insert into auth.tenants (slug) values (${uuidv7()}) returning id`,
  ).pipe(Effect.map(([tenant]) => tenant!.id))

const renderJob = (tenantId: string) => ({
  tenantId,
  jobType: ProcessDocumentJobTypes.invoiceRender,
  idempotencyKey: uuidv7(),
  priority: 0,
  payload: { probe: true },
  correlationId: "clock-skew",
})

// Hosts do not share a clock, so when a job is due and when a lease has run out must be decided by
// one clock they all share: the database's. A host whose clock runs ahead must not take a lease
// another host still holds, and a host whose clock runs behind must still see a job that is due.
it.effect.skipIf(databaseUrl === undefined)(
  "a host with a fast clock cannot take a lease another host still holds",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      TestClock.withLive(
        Effect.gen(function* () {
          yield* runMigrations(client)
          const tenantId = yield* tenantOf(client)
          const base = yield* Clock.Clock

          const enqueuer = yield* makeProcessJobEnqueuer.pipe(
            Effect.provideService(Database, makePostgresDatabase(client)),
          )

          const hostA = yield* hostAt(client, base, 0)
          const hostB = yield* hostAt(client, base, 10 * 60_000)

          yield* enqueuer.enqueue(renderJob(tenantId))

          const held = yield* hostA.claimJob({ tenantId, workerId: "worker-a" })

          assert.isNotNull(held)

          // The lease is five minutes long by the database clock.
          const [remaining] = yield* Effect.promise(
            () =>
              client<{ seconds: number }[]>`
                select extract(epoch from (lease_until - now()))::float8 as seconds
                from process.jobs where id = ${held!.jobId}
              `,
          )

          assert.isTrue(remaining!.seconds > 295 && remaining!.seconds <= 300)

          // The lease lasts five minutes; host B's clock says ten minutes have passed.
          assert.isNull(yield* hostB.claimJob({ tenantId, workerId: "worker-b" }))

          const completed = yield* hostA.completeJob({
            tenantId,
            workerId: "worker-a",
            jobId: held!.jobId,
            leaseToken: held!.leaseToken!,
            leaseGeneration: held!.leaseGeneration!,
          })

          assert.strictEqual(completed.status, "completed")
        }),
      ),
    ),
  { timeout: 120_000 },
)

it.effect.skipIf(databaseUrl === undefined)(
  "a host with a slow clock still sees a job another host enqueued",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      TestClock.withLive(
        Effect.gen(function* () {
          yield* runMigrations(client)
          const tenantId = yield* tenantOf(client)
          const base = yield* Clock.Clock

          const enqueuer = yield* makeProcessJobEnqueuer.pipe(
            Effect.provideService(Database, makePostgresDatabase(client)),
          )

          const slowHost = yield* hostAt(client, base, -60 * 60_000)
          const queued = yield* enqueuer.enqueue(renderJob(tenantId))

          const claimed = yield* slowHost.claimJob({ tenantId, workerId: "worker-slow" })

          assert.isNotNull(claimed)
          assert.strictEqual(claimed!.jobId, queued.jobId)
        }),
      ),
    ),
  { timeout: 120_000 },
)

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
                retryAfterMs: null,
              }),
            ),
            ProcessJobLeaseLost,
          )

          const pending = yield* process.failJob({
            tenantId: tenant!.id,
            workerId: "worker-b",
            jobId: job!.id,
            leaseToken: second!.leaseToken!,
            leaseGeneration: second!.leaseGeneration!,
            error: "retryable worker failure",
            retryAfterMs: 3_600_000,
          })

          assert.strictEqual(pending.status, "pending")

          // The retry time is the database clock plus the delay, whatever this host thinks the time is.
          const [timing] = yield* Effect.promise(
            () =>
              client<{ offset_seconds: number }[]>`
              select extract(epoch from (scheduled_at - now()))::float8 as offset_seconds
              from process.jobs where id = ${job!.id}
            `,
          )

          assert.isAbove(timing!.offset_seconds, 3_590)
          assert.isBelow(timing!.offset_seconds, 3_601)

          assert.isNull(
            yield* process.claimJob({ tenantId: tenant!.id, workerId: "worker-c" }),
            "a job retried in an hour is not due yet",
          )

          yield* Effect.promise(
            () =>
              client`
              update process.jobs set scheduled_at = now() - interval '1 second'
              where id = ${job!.id}
            `,
          )
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
            retryAfterMs: 0,
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

          const oldJob = claimed.find((job) => job?.leaseGeneration === "1")!
          const newJob = claimed.find((job) => job?.leaseGeneration === "2")!

          const lease = (job: NonNullable<typeof oldJob>) => ({
            tenantId: tenant!.id,
            workerId: job.leaseOwner!,
            jobId: job.jobId,
            leaseToken: job.leaseToken!,
            leaseGeneration: job.leaseGeneration,
          })

          assert.instanceOf(
            yield* Effect.flip(process.completeFencedJob(lease(oldJob))),
            ProcessJobLeaseLost,
          )

          const database = makePostgresDatabase(client)

          const rolledBack = yield* Effect.flip(
            database.withTransaction(
              Effect.gen(function* () {
                yield* process.completeFencedJob(lease(newJob))

                return yield* Effect.fail("rollback")
              }),
            ),
          )

          assert.strictEqual(rolledBack, "rollback")
          assert.strictEqual((yield* process.completeFencedJob(lease(newJob))).status, "completed")
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
