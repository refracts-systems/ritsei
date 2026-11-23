import * as Docker from "@alchemy.run/docker"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { layerDomainModelCluster } from "../../mod.ts"
import { ClaimProofApi, ClaimProofModel } from "./claim-proof-model.ts"
import { clusterOptions, serviceProps } from "./pilot-host.ts"

/** The claim model hosted on the pool; the pool's runners load this export. */
export const PilotLive = ClaimProofModel.layer(Layer.empty).pipe(
  Layer.provide(layerDomainModelCluster(clusterOptions(import.meta.url))),
)

export default class PilotService extends Docker.Service<PilotService>()(
  "PilotService",
  serviceProps(import.meta.url),
  Effect.gen(function* () {
    const api = yield* ClaimProofApi

    return { fetch: api.fetch }
  }).pipe(Effect.provide(PilotLive)),
) {}
