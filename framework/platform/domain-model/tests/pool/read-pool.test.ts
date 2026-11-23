import { spawnSync } from "node:child_process"

import { assert, it } from "@effect/vitest"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as Predicate from "effect/Predicate"
import * as Result from "effect/Result"
import * as Schedule from "effect/Schedule"

import { SERVICE_PORT } from "./pilot-host.ts"
import { ClaimId, ReadProofApi } from "./read-proof-model.ts"

// The phase 3 read proof (ADR-0124, PRC-READ-1): a query asked `atLeast` a write waits for its
// projection and fails closed when the projection lags. It runs on the Effect Cluster host over
// PostgreSQL 19, deployed with the Alchemy CLI like the phase 0 pool test, so it runs only when asked
// (RITSEI_ALCHEMY_POOL=1) and a Docker Swarm is active; otherwise it is skipped.

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

const alchemy = (command: "deploy" | "destroy", version: "db" | "v5") =>
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

it.live.skipIf(skipReason !== undefined)(
  skipReason === undefined
    ? "a read atLeast a write waits for its projection and fails closed when it lags, on the Effect Cluster host"
    : `a read atLeast a write waits for its projection and fails closed when it lags (skipped: ${skipReason})`,
  () =>
    Effect.gen(function* () {
      yield* alchemy("deploy", "db")
      yield* Effect.sync(() => {
        if (psql("select to_regclass('domain_model.alchemy_domain_objects')") !== "") return

        for (const file of [
          "db/migrations/20261120224629_create_domain_object_store/migration.sql",
          "db/migrations/20261120224651_protect_domain_events/migration.sql",
        ]) {
          psql(spawnSync("cat", [file], { encoding: "utf8" }).stdout, [
            "-q",
            "-v",
            "ON_ERROR_STOP=1",
          ])
        }

        psql("ALTER ROLE postgres IN DATABASE cluster SET search_path = domain_model")
      })
      assert.match(yield* Effect.sync(() => psql("select version()")), /^PostgreSQL 19/)

      yield* alchemy("deploy", "v5")
      const client = yield* ReadProofApi.clientHttp(baseUrl)

      yield* client
        .ClaimKey(ClaimId.make("fast-warmup"), { holder: "warmup" })
        .pipe(Effect.retry({ schedule: Schedule.spaced(Duration.seconds(2)), times: 90 }))

      // 1. A prompt projection: the read atLeast the write is answered without a long wait.
      const fast = yield* client.ClaimKey(ClaimId.make("fast-1"), { holder: "a" })
      const fastStart = Date.now()
      const seen = yield* client.HolderOf({ claimId: "fast-1" }, { atLeast: fast })

      assert.strictEqual(seen, "answered:fast-1", "a read atLeast the write is answered")
      assert.isAtMost(Date.now() - fastStart, 8_000, "a prompt projection does not delay the read")

      // 2. A lagging projection: the read atLeast the write fails closed, after its wait, and
      //    returns no value, neither the stale one nor one from another source.
      const slow = yield* client.ClaimKey(ClaimId.make("slow-1"), { holder: "b" })
      const started = Date.now()

      const outcome = yield* client
        .HolderOf({ claimId: "slow-1" }, { atLeast: slow })
        .pipe(Effect.result)

      const waited = Date.now() - started

      assert.isTrue(Result.isFailure(outcome), "the read fails instead of answering")

      if (Result.isFailure(outcome)) {
        const failure: unknown = outcome.failure

        assert.isTrue(Predicate.hasProperty(failure, "_tag"))

        if (Predicate.hasProperty(failure, "_tag")) {
          assert.strictEqual(failure._tag, "ConsistencyTimeout")
        }
      }

      assert.isAtLeast(waited, 8_000, "it waited for the projection before it failed")
      assert.isAtMost(waited, 30_000, "it did not wait without bound")

      // 3. The same read without `atLeast` answers at once, whatever the projection has handled: the
      //    wait is what the receipt buys.
      const unwaited = Date.now()
      const stale = yield* client.HolderOf({ claimId: "slow-1" })

      assert.strictEqual(stale, "answered:slow-1", "without atLeast it answers without waiting")
      assert.isAtMost(Date.now() - unwaited, 5_000, "without atLeast it does not wait")

      // 4. Once the projection catches up the same read succeeds.
      const caught = yield* client
        .HolderOf({ claimId: "slow-1" }, { atLeast: slow })
        .pipe(Effect.retry({ schedule: Schedule.spaced(Duration.seconds(5)), times: 20 }))

      assert.strictEqual(
        caught,
        "answered:slow-1",
        "after the projection catches up the read succeeds",
      )
    }).pipe(
      Effect.ensuring(alchemy("destroy", "v5").pipe(Effect.ignore)),
      Effect.scoped,
      Effect.provide(FetchHttpClient.layer),
    ),
  { timeout: 1_800_000 },
)
