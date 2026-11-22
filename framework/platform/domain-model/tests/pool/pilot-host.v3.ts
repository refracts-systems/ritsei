import * as Docker from "@alchemy.run/docker"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { layerDomainModelCluster } from "../../mod.ts"
import { clusterOptions, serviceProps } from "./pilot-host.ts"
import { PilotHandlers } from "./pilot-model.ts"
import { PilotApiV3, PilotModelV3 } from "./pilot-model.v3.ts"

/** The model hosted on the pool; the pool's runners load this export. */
export const PilotLive = PilotModelV3.layer(PilotHandlers).pipe(
  Layer.provide(layerDomainModelCluster(clusterOptions(import.meta.url))),
)

export default class PilotService extends Docker.Service<PilotService>()(
  "PilotService",
  serviceProps(import.meta.url),
  Effect.gen(function* () {
    const api = yield* PilotApiV3

    return { fetch: api.fetch }
  }).pipe(Effect.provide(PilotLive)),
) {}
