import "../../tooling/load-env.ts"
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as Effect from "effect/Effect"
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder"
import * as HttpApiScalar from "effect/http-api/HttpApiScalar"
import * as HttpRouter from "effect/http/HttpRouter"
import * as Layer from "effect/Layer"
import postgres, { type Sql } from "postgres"

import type { PostgresClient } from "../../foundation/mod.ts"
import { validatePostgresVersion } from "../../platform/mod.ts"
import { isMain } from "../../tooling/entrypoint.ts"
import { createNodeServer } from "../adapters/node-server.ts"
import { readRuntimeConfiguration, type RitseiRuntimeConfiguration } from "../config.ts"
import { serviceLayers } from "../layers.ts"
import { RitseiApi } from "./api.ts"
import { CurrentRuntimeConfiguration } from "./api.ts"
import { ApiHandlers, BearerAuthLive } from "./handlers.ts"
import { requestBodyLimitLayer } from "./request-limits.ts"

export { serviceLayers } from "../layers.ts"

export const makeApiLayer = (
  client: Sql,
  configuration: RitseiRuntimeConfiguration,
  port = 8000,
  replicaClient?: Sql,
) => {
  if (configuration.postgresReadYourWrites !== undefined && replicaClient === undefined) {
    throw new Error("PostgreSQL read-your-writes requires a replica client")
  }
  const services = serviceLayers(client, configuration, undefined, replicaClient)
  const authMiddleware = BearerAuthLive.pipe(Layer.provide(services))
  const handlers = ApiHandlers.pipe(
    Layer.provide(Layer.succeed(CurrentRuntimeConfiguration)(configuration)),
    Layer.provide(authMiddleware),
    Layer.provide(services),
  )

  const apiLayer = HttpApiBuilder.layer(RitseiApi).pipe(
    Layer.provide(handlers),
    Layer.provide(HttpApiScalar.layer(RitseiApi)),
  )

  return Layer.mergeAll(apiLayer, requestBodyLimitLayer).pipe(
    HttpRouter.serve,
    Layer.provide(NodeHttpServer.layer(createNodeServer, { port })),
    Layer.provide(services),
  )
}

export const startApi = (url: string, port = 8000) =>
  Effect.scoped(
    Effect.gen(function* () {
      const configuration = yield* readRuntimeConfiguration()
      const client = postgres(url)
      yield* Effect.addFinalizer(() => Effect.promise(() => client.end()))
      yield* validatePostgresVersion(client as unknown as PostgresClient)
      const replicaClient =
        configuration.postgresReadYourWrites === undefined
          ? undefined
          : postgres(configuration.postgresReadYourWrites.replicaUrl)
      if (replicaClient !== undefined) {
        yield* Effect.addFinalizer(() => Effect.promise(() => replicaClient.end()))
        yield* validatePostgresVersion(replicaClient as unknown as PostgresClient)
      }
      yield* Layer.launch(makeApiLayer(client, configuration, port, replicaClient))
    }),
  )

if (isMain(import.meta.url)) {
  const url = process.env["DATABASE_URL"]
  if (url === undefined || url.trim() === "") {
    console.error("DATABASE_URL is required")
    process.exit(1)
  }
  const port = Number.parseInt(process.env["PORT"] ?? "8000", 10)
  startApi(url, port).pipe(NodeRuntime.runMain)
}
