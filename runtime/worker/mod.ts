import "../../tooling/load-env.ts"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as Effect from "effect/Effect"
import postgres from "postgres"

import { isMain } from "../../tooling/entrypoint.ts"
import { readRuntimeConfiguration, type RitseiRuntimeConfiguration } from "../config.ts"
import { serviceLayers } from "../layers.ts"
import { type FinancialWorkerInput, runFinancialOperationOnce } from "./runner.ts"

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
    Effect.gen(function*() {
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
  Effect.gen(function*() {
    const configuration = yield* readRuntimeConfiguration()
    yield* startWorker(url, { tenantId, workerId }, configuration)
  }).pipe(NodeRuntime.runMain)
}
