import * as Docker from "@alchemy.run/docker"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { layerDomainModelCluster } from "../../mod.ts"
import { clusterOptions, serviceProps } from "./pilot-host.ts"
import { ReadProofApi, ReadProofHandlers, ReadProofModel } from "./read-proof-model.ts"

/** The read proof model hosted on the pool; the pool's runners load this export. */
export const PilotLive = ReadProofModel.layer(ReadProofHandlers).pipe(
  Layer.provide(layerDomainModelCluster(clusterOptions(import.meta.url))),
)

export default class PilotService extends Docker.Service<PilotService>()(
  "PilotService",
  serviceProps(import.meta.url),
  Effect.gen(function* () {
    const api = yield* ReadProofApi

    return { fetch: api.fetch }
  }).pipe(Effect.provide(PilotLive)),
) {}
