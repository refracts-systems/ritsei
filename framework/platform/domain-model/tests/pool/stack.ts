/**
 * The Alchemy stack the pool test deploys with the Alchemy CLI (ADR-0124, phase 0). It is run from
 * the repository root: `alchemy deploy <this file> --stage <stage> --yes`. `PILOT_STACK=db` deploys the
 * database alone, so the test can apply the migration before any runner starts; `v1`, `v2` and `v3`
 * deploy the service, the pool and the database with the first, second or third model; `v4` serves
 * the claim model of the claim proof.
 */
import * as Docker from "@alchemy.run/docker"
import * as Cluster from "@alchemy.run/effect-cluster"
import { Database as ClusterDatabase } from "@alchemy.run/effect-cluster/Database"
import * as Alchemy from "alchemy"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { Database } from "./pilot-host.ts"

const modules = {
  v1: () => import("./pilot-host.v1.ts"),
  v2: () => import("./pilot-host.v2.ts"),
  v3: () => import("./pilot-host.v3.ts"),
  v4: () => import("./pilot-host.v4.ts"),
}

const version = process.env["PILOT_STACK"] ?? "db"

const served = (
  load: () => Promise<{ readonly default: Effect.Effect<{ readonly name: unknown }, never, any> }>,
) =>
  Effect.gen(function* () {
    const module = yield* Effect.promise(load)
    const service = yield* module.default

    return { service: service.name }
  })

const program =
  version === "v1" || version === "v2" || version === "v3" || version === "v4"
    ? served(modules[version])
    : Effect.asVoid(Effect.provide(ClusterDatabase, Database)).pipe(Effect.as({ service: "none" }))

export default Alchemy.Stack(
  "RitseiPilot",
  {
    providers: Layer.mergeAll(Docker.providers(), Cluster.providers()),
    state: Alchemy.localState(),
  },
  // SAFETY: both branches yield { service } and need only the providers the stack options supply.
  program as Effect.Effect<{ service: string }, never, any>,
)
