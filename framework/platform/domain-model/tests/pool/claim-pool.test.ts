import { spawnSync } from "node:child_process"

import { assert, it } from "@effect/vitest"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as Predicate from "effect/Predicate"
import * as Result from "effect/Result"
import * as Schedule from "effect/Schedule"

import { ClaimId, ClaimProofApi } from "./claim-proof-model.ts"
import { SERVICE_PORT } from "./pilot-host.ts"

// The phase 3 claim proof (ADR-0124): concurrent claims on one key, on the real Effect Cluster host
// over PostgreSQL 19. It deploys with the Alchemy CLI like the phase 0 pool test, so it runs only when
// asked (RITSEI_ALCHEMY_POOL=1) and a Docker Swarm is active; otherwise it is skipped.

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
const keys = Number(process.env["RITSEI_ALCHEMY_CLAIM_KEYS"] ?? "20")
const holders = Number(process.env["RITSEI_ALCHEMY_CLAIM_HOLDERS"] ?? "25")

const alchemy = (command: "deploy" | "destroy", version: "db" | "v4") =>
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

const table = "domain_model.alchemy_domain_objects"

/** Recorded events with this tag whose object name ends with `suffix`. */
const events = (tag: string, suffix: string) =>
  Number(
    psql(
      `select count(*) from ${table} where key like 'event:%' and object like '%${suffix}' and value like '%"${tag}"%'`,
    ),
  )

it.live.skipIf(skipReason !== undefined)(
  skipReason === undefined
    ? "exactly one of many concurrent claims on a key wins, on the Effect Cluster host"
    : `exactly one of many concurrent claims on a key wins (skipped: ${skipReason})`,
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

      yield* alchemy("deploy", "v4")
      const client = yield* ClaimProofApi.clientHttp(baseUrl)

      // Wait until the service answers.
      yield* client
        .ClaimKey(ClaimId.make("warmup"), { holder: "warmup" })
        .pipe(Effect.retry({ schedule: Schedule.spaced(Duration.seconds(2)), times: 90 }))

      // Every holder claims every key at once: `keys` x `holders` overlapping commands.
      const attempts = Array.from({ length: keys }, (_, k) =>
        Array.from({ length: holders }, (_, h) => ({ key: `k-${k}`, holder: `h-${h}` })),
      ).flat()

      const outcomes = yield* Effect.forEach(
        attempts,
        ({ key, holder }) =>
          client.ClaimKey(ClaimId.make(key), { holder }).pipe(
            Effect.result,
            Effect.map((result) => ({ key, holder, result })),
          ),
        { concurrency: "unbounded" },
      )

      for (let k = 0; k < keys; k++) {
        const key = `k-${k}`
        const forKey = outcomes.filter((outcome) => outcome.key === key)
        const accepted = forKey.filter((outcome) => Result.isSuccess(outcome.result))
        const refused = forKey.filter((outcome) => Result.isFailure(outcome.result))

        assert.strictEqual(accepted.length, 1, `${key}: exactly one claim is accepted`)
        assert.strictEqual(refused.length, holders - 1, `${key}: every other holder is refused`)

        const winner = accepted[0]!.holder

        for (const outcome of refused) {
          assert.isTrue(Result.isFailure(outcome.result))

          if (Result.isFailure(outcome.result)) {
            const failure: unknown = outcome.result.failure

            assert.isTrue(Predicate.hasProperty(failure, "_tag"), "the refusal is typed")
            assert.isTrue(Predicate.hasProperty(failure, "holder"), "the refusal names a holder")

            if (
              Predicate.hasProperty(failure, "_tag") &&
              Predicate.hasProperty(failure, "holder")
            ) {
              assert.strictEqual(failure._tag, "ClaimHeld")
              assert.strictEqual(failure.holder, winner, `${key}: the refusal names the winner`)
            }
          }
        }

        // The database agrees: one recorded claim event for the key.
        assert.strictEqual(
          yield* Effect.sync(() => events("KeyClaimed", key)),
          1,
          `${key}: one KeyClaimed`,
        )
      }

      // The winner claiming again is a no-op; release and a new claim by another holder follow.

      const first = ClaimId.make("k-0")

      const accepted = outcomes.find(
        (outcome) => outcome.key === "k-0" && Result.isSuccess(outcome.result),
      )

      assert.isDefined(accepted)

      const winner = accepted?.holder ?? ""

      yield* client.ClaimKey(first, { holder: winner })
      assert.strictEqual(yield* Effect.sync(() => events("KeyClaimed", "k-0")), 1)

      yield* client.ReleaseKey(first, { holder: "someone-else" })
      assert.strictEqual(yield* Effect.sync(() => events("KeyReleased", "k-0")), 0)

      yield* client.ReleaseKey(first, { holder: winner })
      assert.strictEqual(yield* Effect.sync(() => events("KeyReleased", "k-0")), 1)

      yield* client.ClaimKey(first, { holder: "second-holder" })
      assert.strictEqual(yield* Effect.sync(() => events("KeyClaimed", "k-0")), 2)
    }).pipe(
      Effect.ensuring(alchemy("destroy", "v4").pipe(Effect.ignore)),
      Effect.scoped,
      Effect.provide(FetchHttpClient.layer),
    ),
  { timeout: 1_800_000 },
)
