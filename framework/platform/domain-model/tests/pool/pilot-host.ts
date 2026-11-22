/**
 * The pilot on the Effect Cluster host over a local Docker Swarm (ADR-0124, phase 0): a PostgreSQL
 * 19 database service, a pool of one runner, and a service that serves the model's Api. The module
 * that calls `pilotHost` is the program the pool's runners and the Api service load, so it must
 * default-export the service and name the model's Layer `PilotLive`.
 */
import * as Docker from "@alchemy.run/docker"
import * as ClusterDb from "@alchemy.run/effect-cluster/Database"
import * as ClusterDocker from "@alchemy.run/effect-cluster/Docker"
import * as Output from "alchemy/Output"
import { Random } from "alchemy/Random"
import * as Redacted from "effect/Redacted"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

/** The image of the database the cluster coordinates through: the PostgreSQL release under test. */
export const POSTGRES_IMAGE = "postgres:19"
export const GATEWAY_PORT = 34500
export const SERVICE_PORT = 34501

/** Named, so the Api service can join it: the gateway is only reachable by name on this network. */
export const NETWORK = "ritsei-pilot-cluster"

/**
 * `ClusterDocker.Database` as shipped, with one change: its volume is mounted at
 * `/var/lib/postgresql`. The shipped layer mounts it at `/var/lib/postgresql/data`, and PostgreSQL 18
 * and later images refuse to start with a mount there (phase 0 finding). The rest is the same: a
 * one-replica swarm service on an overlay network, whose address is `cluster-db`.
 */
export const Database = Layer.effect(
  ClusterDb.Database,
  Effect.gen(function* () {
    if (globalThis.__ALCHEMY_RUNTIME__) {
      // SAFETY: a runner reads its database from its own environment and never uses the shard groups.
      return { url: Redacted.make(""), shardGroups: undefined as never }
    }

    const password = yield* Random("PilotDbPassword", { bytes: 24 })
    const network = yield* Docker.Network("PilotDbNetwork", { driver: "overlay", name: NETWORK })
    const data = yield* Docker.Volume("PilotDbData", {})
    const alias = "cluster-db"

    const db = yield* Docker.Service("PilotDbPostgres", {
      image: POSTGRES_IMAGE,
      environment: { POSTGRES_PASSWORD: password.text, POSTGRES_DB: "cluster" },
      volumes: [{ hostPath: data.name, containerPath: "/var/lib/postgresql" }],
      networks: [{ name: network.name, aliases: [alias] }],
      replicas: 1,
    })

    return {
      url: Output.all(db.name, password.text).pipe(
        Output.map(([, text]) =>
          Redacted.make(
            `postgres://postgres:${encodeURIComponent(Redacted.value(text))}@${alias}:5432/cluster`,
          ),
        ),
      ),
      network: { kind: "docker" as const, name: network.name },
      shardGroups: yield* ClusterDb.clusterShardGroups("PilotDb"),
    }
  }),
)

export const Pool = ClusterDocker.SwarmPool("Pilot", { gatewayPort: GATEWAY_PORT }).pipe(
  Layer.provide(Database),
)

/** What the runners and the service both load: the model Layer is built from the same `main`. */
export const clusterOptions = (main: string) => ({
  name: "PilotModel",
  main,
  handler: "PilotLive",
  pool: Pool,
})

/** The service that serves the model's Api; it joins the cluster network to reach the gateway by name. */
export const serviceProps = (main: string) => ({
  main,
  port: 3000,
  networks: [NETWORK],
  ports: [{ external: SERVICE_PORT, internal: 3000 }],
})
