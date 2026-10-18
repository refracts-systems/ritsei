import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { probeDndCompatibility } from "../../tooling/frontend/compatibility.ts"

it.effect(
  "fails closed when the dnd-kit Solid adapter is not compatible with Solid 2",
  () =>
    Effect.gen(function* () {
      const result = yield* Effect.promise(probeDndCompatibility)
      assert.equal(result.build, "blocked")
      assert.match(result.diagnostic ?? "", /\.\/web.*not exported/)
    }),
  { timeout: 60_000 },
)
