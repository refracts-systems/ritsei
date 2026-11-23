/**
 * The fail-closed read of `PRC-READ-1` (ADR-0124 phase 3) as the Effect Cluster pool serves it. A
 * query that `waitsFor` a projection and is asked `atLeast` a write must wait for the projection to
 * handle that write, and fail with `ConsistencyTimeout` when it does not: never answer from stale
 * data. The query answers with a fixed marker, because its handler runs in the API service and the
 * projection in a runner, so no in-memory state is shared between them: what is proven is the wait
 * and the failure, by timing and by `ConsistencyTimeout`. The projection here lags on purpose for keys that start with `slow-` and is immediate
 * otherwise, so one deployment shows both the read that waits and the read that fails closed.
 */
import * as Domain from "@alchemy.run/domain"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import { ClaimId, KeyClaim, KeyClaimed, KeyReleased } from "./claim-proof-model.ts"

/** How long the projection lags on a `slow-` key; longer than the query's 10 second wait. */
export const slowLag = Duration.seconds(40)

export class ClaimHolders extends Domain.Projection("ClaimHolders", {
  from: [KeyClaim],
  key: KeyClaim,
  on: [KeyClaimed, KeyReleased],
}) {}

export const ClaimHoldersLive = ClaimHolders.toLayer(
  Effect.succeed(
    Effect.fn(function* (batch) {
      for (const { envelope } of batch) {
        // The projection holds no state here: only how far it has handled a stream matters.
        if (envelope.stream.split("/").slice(1).join("/").startsWith("slow-")) {
          yield* Effect.sleep(slowLag)
        }
      }
    }),
  ),
)

export class HolderOf extends Domain.Query("HolderOf", {
  input: { claimId: Schema.String },
  success: Schema.String,
  waitsFor: [ClaimHolders],
}) {}

export const HolderOfLive = HolderOf.toLayer(
  Effect.succeed(({ claimId }) => Effect.succeed(`answered:${claimId}`)),
)

export class ReadProofModel extends Domain.Model("PilotModel", {
  aggregates: [KeyClaim],
  projections: [ClaimHolders],
  queries: [HolderOf],
}) {}

export const ReadProofHandlers = Layer.mergeAll(ClaimHoldersLive, HolderOfLive)

export class ReadProofApi extends Domain.Api("PilotApi", { model: ReadProofModel }) {}

export { ClaimId }
