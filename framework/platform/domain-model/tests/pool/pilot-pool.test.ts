import { spawnSync } from "node:child_process"
import { appendFileSync } from "node:fs"

import { assert, it } from "@effect/vitest"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as Option from "effect/Option"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"

import {
  DeliveryId,
  OrderId,
  StockItemId,
} from "../../../../foundation/domain-model/tests/delivery-model.ts"
import { SERVICE_PORT } from "./pilot-host.ts"
import { PilotApi } from "./pilot-model.ts"
import { PilotApiV2 } from "./pilot-model.v2.ts"
import { PilotApiV3 } from "./pilot-model.v3.ts"
import { WarehouseId } from "./warehouse-movements.ts"
import { ProbeId as ProbeIdV1 } from "./probe.v1.ts"
import { ProbeNoted } from "./probe.v2.ts"

// The phase 0 pool step (ADR-0124): the delivery pilot on the real Effect Cluster host, a pool of one
// runner on a local Docker Swarm, against PostgreSQL 19. It deploys with the Alchemy CLI, so it runs
// only when asked (RITSEI_ALCHEMY_POOL=1) and a Docker Swarm is active; otherwise it is skipped.
// RITSEI_ALCHEMY_POOL_DELIVERIES sets how many deliveries the rebuild measurement writes.

const optedIn = process.env["RITSEI_ALCHEMY_POOL"] === "1"

const docker = (...args: ReadonlyArray<string>) =>
  spawnSync("docker", [...args], { encoding: "utf8" })

const swarmState = (() => {
  if (!optedIn) return "not requested"
  const info = docker("info", "--format", "{{.Swarm.LocalNodeState}}")

  if (info.error !== undefined || info.status !== 0) return "Docker is not available"

  return info.stdout.trim() === "active" ? "active" : "Docker Swarm is not active"
})()

const skipReason =
  swarmState === "active"
    ? undefined
    : `set RITSEI_ALCHEMY_POOL=1 with an active local Docker Swarm (${swarmState})`

const stackFile = "framework/platform/domain-model/tests/pool/stack.ts"
const stage = "pilot"
const baseUrl = `http://localhost:${SERVICE_PORT}`
const deliveries = Number(process.env["RITSEI_ALCHEMY_POOL_DELIVERIES"] ?? "100")
const warehouse = "w-9"
const items = 20
const O = OrderId.make
const D = DeliveryId.make
const S = StockItemId.make

/** Run the Alchemy CLI from the repository root under tsx (it loads Alchemy's TypeScript sources). */
const alchemy = (command: "deploy" | "destroy", version: "db" | "v1" | "v2" | "v3") =>
  Effect.sync(() => {
    const run = spawnSync(
      "pnpm",
      [
        "exec",
        "tsx",
        "node_modules/alchemy/bin/alchemy.js",
        command,
        stackFile,
        "--stage",
        stage,
        "--yes",
        "--no-input",
      ],
      { encoding: "utf8", env: { ...process.env, PILOT_STACK: version }, maxBuffer: 1 << 26 },
    )

    assert.strictEqual(run.status, 0, `alchemy ${command} ${version}: ${run.stdout.slice(-2000)}`)
  })

const serviceName = (part: string) =>
  docker("service", "ls", "--format", "{{.Name}}", "--filter", `name=${part}`)
    .stdout.trim()
    .split("\n")[0]!

/** Run SQL in the database container as the superuser, over its local socket (no password). */
const psql = (sql: string, flags: ReadonlyArray<string> = ["-Atq"]) => {
  const container = docker("ps", "-q", "--filter", "name=pilotdbpostgres")
    .stdout.trim()
    .split("\n")[0]!

  const run = spawnSync(
    "docker",
    ["exec", "-i", container, "psql", "-U", "postgres", "-d", "cluster", ...flags],
    { encoding: "utf8", input: sql },
  )

  assert.strictEqual(run.status, 0, run.stderr)

  return run.stdout.trim()
}

const count = (sql: string) => Number(psql(sql))

const table = "domain_model.alchemy_domain_objects"

/** Recorded events of the objects whose name ends with `suffix`. */
const eventsOf = (suffix: string) =>
  count(`select count(*) from ${table} where key like 'event:%' and object like '%${suffix}'`)

const eventRows = () => count(`select count(*) from ${table} where key like 'event:%'`)

const eventsWith = (tag: string) =>
  count(`select count(*) from ${table} where key like 'event:%' and value like '%"${tag}"%'`)

/** How often PostgreSQL's log shows the trigger refusing a write to a recorded event. */
const refusals = () =>
  spawnSync("docker", ["service", "logs", serviceName("pilotdbpostgres")], {
    encoding: "utf8",
    maxBuffer: 1 << 26,
  })
    .stdout.concat(
      spawnSync("docker", ["service", "logs", serviceName("pilotdbpostgres")], {
        encoding: "utf8",
        maxBuffer: 1 << 26,
      }).stderr,
    )
    .split("\n")
    .filter((text) => text.includes("recorded domain events cannot be changed")).length

// Vitest prints a test's logs when it ends; RITSEI_ALCHEMY_POOL_LOG also appends each line to a file as it happens.
/** A recorded probe event as the host stores it: the event and the envelope it was committed in. */
const StoredProbeEvent = Schema.Struct({ event: ProbeNoted })

const evidence = (name: string, value: string) =>
  Effect.sync(() => {
    const file = process.env["RITSEI_ALCHEMY_POOL_LOG"]

    if (file !== undefined)
      appendFileSync(
        file,
        `${new Date().toISOString()} ${name} ${value}
`,
      )
  }).pipe(Effect.andThen(Effect.logInfo(`EVIDENCE ${name} ${value}`)))

it.live.skipIf(skipReason !== undefined)(
  skipReason === undefined
    ? "runs the delivery pilot on the Effect Cluster host over PostgreSQL 19"
    : `runs the delivery pilot on the Effect Cluster host (skipped: ${skipReason})`,
  () =>
    Effect.gen(function* () {
      // 1. The database alone, then the repository's migration, then the host's login search_path.
      yield* alchemy("deploy", "db")
      yield* Effect.sync(() => {
        if (psql("select to_regclass('domain_model.alchemy_domain_objects')") !== "") return

        const migrations = [
          "db/migrations/20261120224629_create_domain_object_store/migration.sql",
          "db/migrations/20261120224651_protect_domain_events/migration.sql",
        ]

        for (const file of migrations) {
          psql(spawnSync("cat", [file], { encoding: "utf8" }).stdout, [
            "-q",
            "-v",
            "ON_ERROR_STOP=1",
          ])
        }

        psql("ALTER ROLE postgres IN DATABASE cluster SET search_path = domain_model")
      })
      const version = yield* Effect.sync(() => psql("select version()"))
      assert.match(version, /^PostgreSQL 19/)
      yield* evidence("postgres", version)

      // 2. The pool and the service over the same database.
      const deployStart = Date.now()
      yield* alchemy("deploy", "v1")
      yield* evidence("deploy-v1-seconds", String((Date.now() - deployStart) / 1000))
      const client = yield* PilotApi.clientHttp(baseUrl)
      const ready = Schedule.spaced(Duration.seconds(2))
      yield* client
        .ConfirmOrder(O("o-warmup"), { lines: { L1: 1 } }, { commandId: "warmup" })
        .pipe(Effect.retry({ schedule: ready, times: 90 }))

      const delivered = (id: string) =>
        client.DeliveryStatus.get(D(id)).pipe(
          Effect.repeat({
            schedule: Schedule.spaced(Duration.millis(500)),
            until: (state) =>
              state !== null && state.status !== "requested" && state.status !== "none",
            times: 120,
          }),
        )

      // An order no delivery touched has no row in the view.
      const progress = (id: string) =>
        client.OrderProgress.get(O(id)).pipe(Effect.map((state) => state?.delivered ?? {}))

      // Views catch up after the command returns; wait until the view shows what is expected.
      const settled = <A, E>(read: Effect.Effect<A, E>, expected: A) =>
        read.pipe(
          Effect.repeat({
            schedule: Schedule.spaced(Duration.millis(500)),
            until: (value) => JSON.stringify(value) === JSON.stringify(expected),
            times: 60,
          }),
        )

      const line = (orderLineId: string, itemId: string, quantity: number, stockable = true) => ({
        orderLineId,
        itemId,
        quantity,
        stockable,
      })

      // Delivery completes and issues stock; services move none.
      yield* client.ConfirmOrder(O("o-1"), { lines: { L1: 5, L2: 2 } }, { commandId: "c-o-1" })
      yield* client.ReceiveStock(S("w-1/A"), { quantity: 10, cost: 1000 }, { commandId: "c-s-1" })

      const d1 = {
        orderId: "o-1",
        warehouseId: "w-1",
        lines: [line("L1", "A", 3), line("L2", "S", 1, false)],
      }

      yield* client.RequestDelivery(D("d-1"), d1, { commandId: "c-d-1" })
      assert.deepStrictEqual(yield* delivered("d-1"), { status: "completed" })
      assert.deepStrictEqual(
        yield* settled(client.StockLevel.get(S("w-1/A")), { onHand: 7, value: 700 }),
        { onHand: 7, value: 700 },
      )
      assert.deepStrictEqual(yield* settled(progress("o-1"), { L1: 3, L2: 1 }), { L1: 3, L2: 1 })
      assert.strictEqual(yield* Effect.sync(() => eventsOf("w-1/A")), 2) // received, issued

      // Over-delivery is refused; variant B issued the stock first and returned it.
      yield* client.ConfirmOrder(O("o-2"), { lines: { L1: 5 } }, { commandId: "c-o-2" })
      yield* client.ReceiveStock(S("w-2/A"), { quantity: 10, cost: 1000 }, { commandId: "c-s-2" })
      yield* client.RequestDelivery(
        D("d-2"),
        { orderId: "o-2", warehouseId: "w-2", lines: [line("L1", "A", 6)] },
        { commandId: "c-d-2" },
      )
      assert.deepStrictEqual(yield* delivered("d-2"), { status: "failed", reason: "rejected" })
      assert.deepStrictEqual(yield* settled(progress("o-2"), {}), {})
      assert.deepStrictEqual(
        yield* settled(client.StockLevel.get(S("w-2/A")), { onHand: 10, value: 1000 }),
        { onHand: 10, value: 1000 },
      )
      assert.strictEqual(yield* Effect.sync(() => eventsOf("w-2/A")), 3) // received, issued, returned
      assert.strictEqual(yield* Effect.sync(() => eventsOf("o-2")), 1) // confirmed only

      // A failed second line returns the first line's stock and fails the delivery.
      yield* client.ConfirmOrder(O("o-3"), { lines: { L1: 5, L3: 4 } }, { commandId: "c-o-3" })
      yield* client.ReceiveStock(S("w-3/A"), { quantity: 10, cost: 1000 }, { commandId: "c-s-3a" })
      yield* client.ReceiveStock(S("w-3/B"), { quantity: 1, cost: 70 }, { commandId: "c-s-3b" })
      yield* client.RequestDelivery(
        D("d-3"),
        { orderId: "o-3", warehouseId: "w-3", lines: [line("L1", "A", 3), line("L3", "B", 2)] },
        { commandId: "c-d-3" },
      )
      assert.deepStrictEqual(yield* delivered("d-3"), { status: "failed", reason: "rejected" })
      assert.deepStrictEqual(
        yield* settled(client.StockLevel.get(S("w-3/A")), { onHand: 10, value: 1000 }),
        { onHand: 10, value: 1000 },
      )
      assert.deepStrictEqual(
        yield* settled(client.StockLevel.get(S("w-3/B")), { onHand: 1, value: 70 }),
        { onHand: 1, value: 70 },
      )
      assert.deepStrictEqual(yield* settled(progress("o-3"), {}), {})
      assert.strictEqual(yield* Effect.sync(() => eventsOf("w-3/A")), 3) // received, issued, returned
      assert.strictEqual(yield* Effect.sync(() => eventsOf("w-3/B")), 1) // received only
      assert.strictEqual(yield* Effect.sync(() => eventsOf("o-3")), 1)

      // A retried request records nothing new: a new command id, then the first command's id again.
      const before = yield* Effect.sync(eventRows)
      assert.isAbove(before, 0)
      assert.strictEqual(
        yield* Effect.sync(() => psql("select to_regclass('public.alchemy_domain_objects')")),
        "",
      )
      yield* client.RequestDelivery(D("d-1"), d1, { commandId: "c-d-1-retry" })
      yield* client.RequestDelivery(D("d-1"), d1, { commandId: "c-d-1" })
      yield* Effect.sleep(Duration.seconds(5))
      assert.strictEqual(yield* Effect.sync(eventRows), before)
      assert.deepStrictEqual(
        yield* settled(client.StockLevel.get(S("w-1/A")), { onHand: 7, value: 700 }),
        { onHand: 7, value: 700 },
      )

      // The first schema of the probe event, before the second model exists.
      for (const text of ["a", "b", "c"]) {
        yield* client.NoteProbe(ProbeIdV1.make("p-1"), { text }, { commandId: `probe-${text}` })
      }

      yield* evidence(
        "sample-event",
        yield* Effect.sync(() =>
          psql(
            `select value from ${table} where key like 'event:%' and value like '%ProbeNoted%' limit 1`,
          ),
        ),
      )
      yield* evidence("refusals-after-scenarios", String(yield* Effect.sync(refusals)))

      // 3. A tenant's history: deliveries across a runner restart.
      yield* Effect.forEach(
        Array.from({ length: items }, (_, item) => item),
        (item) =>
          client.ReceiveStock(
            S(`${warehouse}/I${item}`),
            { quantity: deliveries, cost: deliveries * 10 },
            { commandId: `recv-${item}` },
          ),
        { concurrency: 8, discard: true },
      )
      const bulkStart = Date.now()
      yield* Effect.forEach(
        Array.from({ length: deliveries }, (_, index) => index),
        (index) =>
          Effect.gen(function* () {
            if (index === Math.floor(deliveries / 2)) {
              // Restart the runner while sagas are in flight.
              yield* Effect.sync(() =>
                docker(
                  "service",
                  "update",
                  "--force",
                  "--quiet",
                  serviceName("ritseipilot-pilot-pilot"),
                ),
              )
            }

            yield* client
              .ConfirmOrder(O(`o-b${index}`), { lines: { L1: 1 } }, { commandId: `c-o-b${index}` })
              .pipe(
                Effect.timeout(Duration.seconds(30)),
                Effect.retry({ schedule: ready, times: 60 }),
              )
            yield* client
              .RequestDelivery(
                D(`d-b${index}`),
                {
                  orderId: `o-b${index}`,
                  warehouseId: warehouse,
                  lines: [line("L1", `I${index % items}`, 1)],
                },
                { commandId: `c-d-b${index}` },
              )
              .pipe(
                Effect.timeout(Duration.seconds(30)),
                Effect.retry({ schedule: ready, times: 60 }),
              )
          }),
        { concurrency: 8, discard: true },
      )
      yield* evidence("bulk-requests-sent", String((Date.now() - bulkStart) / 1000))
      yield* Effect.repeat(Effect.sleep(Duration.seconds(2)), {
        until: () => eventsWith("DeliveryCompleted") >= deliveries + 1,
        times: 1800,
      })
      const bulkSeconds = (Date.now() - bulkStart) / 1000
      yield* evidence("bulk-completed", String(bulkSeconds))
      yield* evidence(
        "bulk",
        JSON.stringify({ deliveries, seconds: bulkSeconds, perSecond: deliveries / bulkSeconds }),
      )
      assert.strictEqual(yield* Effect.sync(() => eventsWith("DeliveryFailed")), 2)
      yield* evidence(
        "memory",
        yield* Effect.sync(() =>
          docker("stats", "--no-stream", "--format", "{{.Name}} {{.MemUsage}}").stdout.trim(),
        ),
      )
      yield* evidence("event-rows", String(yield* Effect.sync(eventRows)))
      yield* evidence("refusals-after-restart", String(yield* Effect.sync(refusals)))
      yield* evidence(
        "tables",
        yield* Effect.sync(() =>
          psql(
            "select schemaname||'.'||tablename from pg_tables where schemaname not in ('pg_catalog','information_schema') order by 1",
          ),
        ),
      )
      yield* evidence(
        "database-size",
        yield* Effect.sync(() => psql("select pg_size_pretty(pg_database_size('cluster'))")),
      )

      // 4. The second model: an optional field on the probe event, and two views added over events
      // recorded before they existed. Does the host rebuild them from the stored history?
      yield* alchemy("deploy", "v2")

      const second = yield* PilotApiV2.clientHttp(baseUrl)
      const warehouseKey = WarehouseId.make(warehouse)
      const probeKey = ProbeIdV1.make("p-1")

      // Rebuilt means the view shows what a fold of every recorded event gives.
      const watch = <A, E>(
        label: string,
        read: Effect.Effect<A | null, E>,
        done: (state: A) => boolean,
        limit: Duration.Duration,
      ) =>
        Effect.gen(function* () {
          const startedAt = Date.now()

          const reached = yield* read.pipe(
            Effect.repeat({
              schedule: Schedule.spaced(Duration.millis(500)),
              until: (state) => state !== null && done(state),
            }),
            Effect.timeout(limit),
            Effect.option,
          )

          const last = yield* read.pipe(Effect.option)

          yield* evidence(
            label,
            JSON.stringify({
              events: deliveries,
              seconds: (Date.now() - startedAt) / 1000,
              rebuilt: Option.isSome(reached),
              state: Option.getOrNull(last),
            }),
          )

          return Option.isSome(reached)
        })

      yield* second.WarehouseMovements.get(warehouseKey).pipe(
        Effect.retry({ schedule: ready, times: 90 }),
      )
      yield* watch(
        "view-rebuild-after-add",
        second.WarehouseMovements.get(warehouseKey),
        (state) => state.issued >= deliveries,
        Duration.minutes(2),
      )
      yield* watch(
        "probe-view-rebuild-after-add",
        second.ProbeNotes.get(probeKey),
        (state) => state.notes >= 3,
        Duration.seconds(30),
      )

      // A new event with the new field reaches the new view as it happens.
      yield* second.NoteProbe(probeKey, { text: "d", tag: "new" }, { commandId: "probe-d" })
      yield* watch(
        "probe-view-after-new-event",
        second.ProbeNotes.get(probeKey),
        (state) => state.tagged >= 1,
        Duration.seconds(30),
      )

      // Touching a source (one more receipt on each item) is what brings its history into the view.
      yield* Effect.forEach(
        Array.from({ length: items }, (_, item) => item),
        (item) =>
          second.ReceiveStock(
            S(`${warehouse}/I${item}`),
            { quantity: 1, cost: 10 },
            { commandId: `touch-${item}` },
          ),
        { concurrency: 8, discard: true },
      )
      yield* watch(
        "view-rebuild-after-touching-sources",
        second.WarehouseMovements.get(warehouseKey),
        (state) => state.issued >= deliveries,
        Duration.minutes(10),
      )

      // Every probe event recorded under the first schema decodes with the second.
      const stored = yield* Effect.sync(() =>
        psql(
          `select value from ${table} where key like 'event:%' and value like '%ProbeNoted%' order by key`,
        )
          .split(String.fromCharCode(10))
          .map((row) => Schema.decodeUnknownSync(Schema.fromJsonString(StoredProbeEvent))(row)),
      )

      assert.deepStrictEqual(
        stored.map(({ event }) => ({ text: event.text, tag: event.tag })),
        [
          { text: "a", tag: undefined },
          { text: "b", tag: undefined },
          { text: "c", tag: undefined },
          { text: "d", tag: "new" },
        ],
      )
      yield* evidence("probe-events-decoded-with-second-schema", String(stored.length))
      yield* evidence("refusals-after-v2", String(yield* Effect.sync(refusals)))

      // 5. The third model bumps the warehouse view's version, which asks for a rebuild.
      yield* alchemy("deploy", "v3")

      const third = yield* PilotApiV3.clientHttp(baseUrl)

      const rebuilt = yield* third.WarehouseMovements.get(warehouseKey).pipe(
        Effect.retry({ schedule: ready, times: 90 }),
        Effect.andThen(
          watch(
            "view-rebuild-after-version-bump",
            third.WarehouseMovements.get(warehouseKey),
            (state) => state.issued >= deliveries,
            Duration.minutes(3),
          ),
        ),
      )

      if (rebuilt) {
        assert.deepStrictEqual(yield* third.WarehouseMovements.get(warehouseKey), {
          issued: deliveries,
          returned: 0,
        })
      }

      yield* evidence("refusals-after-v3", String(yield* Effect.sync(refusals)))
      yield* evidence(
        "tables-after-v3",
        yield* Effect.sync(() =>
          psql(
            "select schemaname||'.'||tablename from pg_tables where schemaname not in ('pg_catalog','information_schema') order by 1",
          ),
        ),
      )
      yield* evidence(
        "backfill-progress",
        yield* Effect.sync(() =>
          psql(`select left(value, 220) from ${table} where key like 'prog:%' order by object`),
        ),
      )
      assert.strictEqual(yield* Effect.sync(refusals), 0)
    }).pipe(
      Effect.ensuring(alchemy("destroy", "v3").pipe(Effect.ignore)),
      Effect.scoped,
      Effect.provide(FetchHttpClient.layer),
    ),
  { timeout: 3_600_000 },
)
