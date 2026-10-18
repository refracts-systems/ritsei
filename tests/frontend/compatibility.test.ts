import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { probeKobalteCompatibility } from "../../tooling/frontend/compatibility.ts"

it.effect(
  "bundles the Kobalte Solid 2 dialog probe without activating it",
  () =>
    Effect.gen(function* () {
      const result = yield* Effect.promise(probeKobalteCompatibility)
      assert.equal(result.build, "passed")
      assert.equal(result.behavior, "unreviewed")
    }),
  { timeout: 60_000 },
)
