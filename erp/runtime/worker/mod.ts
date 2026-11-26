import "../../../tooling/load-env.ts"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import postgres from "postgres"

import { isMain } from "../../../tooling/entrypoint.ts"
import { readRuntimeConfiguration, type RitseiRuntimeConfiguration } from "../config.ts"
import { serviceLayers } from "../layers.ts"
import { type FinancialWorkerInput, runFinancialOperationOnce } from "./runner.ts"
import { runSituationsSweepOnce, type SituationsSweepInput } from "./situations-sweep.ts"

export { runSituationsSweepOnce, SituationsSweepInput } from "./situations-sweep.ts"

export {
  FinancialWorkerInput,
  FinancialWorkerRun,
  makeWorkerFailpointLayer,
  runFinancialOperationOnce,
  WorkerFailpointName,
  WorkerFailpointService,
  WorkerInjectedFailure,
} from "./runner.ts"

export const startWorker = (
  url: string,
  input: FinancialWorkerInput,
  configuration: RitseiRuntimeConfiguration,
  intervalMs = 1_000,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const client = postgres(url)
      yield* Effect.addFinalizer(() => Effect.promise(() => client.end()))
      const services = serviceLayers(client, configuration)
      yield* Effect.forever(
        runFinancialOperationOnce(input).pipe(
          Effect.provide(services),
          Effect.andThen(Effect.sleep(intervalMs)),
        ),
      )
    }),
  )

/** Runs the situations sweep on an interval; one failed sweep is reported and the next still runs. */
export const startSituationsSweep = (
  url: string,
  input: Schema.Codec.Encoded<typeof SituationsSweepInput>,
  configuration: RitseiRuntimeConfiguration,
  intervalMs = 300_000,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const client = postgres(url)
      yield* Effect.addFinalizer(() => Effect.promise(() => client.end()))
      const services = serviceLayers(client, configuration)

      yield* Effect.forever(
        runSituationsSweepOnce(input).pipe(
          Effect.provide(services),
          Effect.catch((error) => Effect.logError("situations sweep failed", error._tag)),
          Effect.andThen(Effect.sleep(intervalMs)),
        ),
      )
    }),
  )

if (isMain(import.meta.url)) {
  const url = process.env["DATABASE_URL"]
  const tenantId = process.env["WORKER_TENANT_ID"]

  if (url === undefined || tenantId === undefined) {
    console.error("DATABASE_URL and WORKER_TENANT_ID are required")
    process.exit(1)
  }

  const workerId = process.env["WORKER_ID"]?.trim()

  if (workerId === undefined || workerId.length === 0) {
    console.error("WORKER_ID is required")
    process.exit(1)
  }

  Effect.gen(function* () {
    const configuration = yield* readRuntimeConfiguration()
    yield* startWorker(url, { tenantId, workerId }, configuration)
  }).pipe(NodeRuntime.runMain)
}
