import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { Uuid } from "../../../framework/foundation/mod.ts"
import { Principal } from "../../../framework/modules/auth/mod.ts"
import { SituationsService } from "../../modules/situations/mod.ts"

export const SituationsSweepInput = Schema.Struct({
  tenantId: Uuid,
  /** A service account granted the detect capability, and read access in each owning module. */
  principal: Principal,
  legalEntityIds: Schema.Array(Uuid).check(Schema.isMinLength(1)),
})

export interface SituationsSweepResult {
  readonly legalEntityId: string
  readonly status: "swept" | "failed"
  readonly escalated: number
  readonly error: string | null
}

/**
 * Detects, then escalates, for each legal entity. Both calls are idempotent, so two overlapping
 * sweeps cannot double-open or double-escalate. A legal entity that fails is reported and the
 * rest still run; the next sweep retries it.
 */
export const runSituationsSweepOnce = Effect.fn("SituationsSweep.runOnce")(function* (
  input: Schema.Codec.Encoded<typeof SituationsSweepInput>,
) {
  const decoded = yield* Schema.decodeUnknownEffect(SituationsSweepInput)(input)
  const situations = yield* SituationsService

  const sweepOne = (legalEntityId: string) =>
    Effect.gen(function* () {
      const scope = { principal: decoded.principal, tenantId: decoded.tenantId, legalEntityId }

      yield* situations.detect(scope)
      const advanced = yield* situations.advanceEscalations(scope)

      return {
        legalEntityId,
        status: "swept",
        escalated: advanced.escalated,
        error: null,
      } satisfies SituationsSweepResult
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed({
          legalEntityId,
          status: "failed",
          escalated: 0,
          error: error._tag,
        } satisfies SituationsSweepResult),
      ),
    )

  return yield* Effect.forEach(decoded.legalEntityIds, sweepOne)
})
