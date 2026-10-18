import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { boneyardCoreProbe } from "../../apps/web/src/ui/compatibility/boneyard.ts"
import { probeBoneyardCoreCompatibility } from "../../tooling/frontend/compatibility.ts"

it("validates the framework-neutral Boneyard core API", () => {
  const result = boneyardCoreProbe()

  assert.equal(result.height, 24)
  assert.equal(result.boneCount, 1)
  assert.isTrue(result.rendered)
  assert.equal(result.normalizedWidth, 10)
  assert.equal(result.snapshotType, "function")
})

it.effect(
  "keeps React and Playwright out of the production core bundle",
  () =>
    Effect.gen(function* () {
      const result = yield* Effect.promise(probeBoneyardCoreCompatibility)

      assert.equal(result.build, "passed")
      if (result.build === "passed") assert.equal(result.productionBundle, "safe")
    }),
  { timeout: 60_000 },
)
