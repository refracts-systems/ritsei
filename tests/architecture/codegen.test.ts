import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import { generate } from "../../tooling/codegen.ts"

it.effect("generated module composition matches the manifests", () =>
  Effect.gen(function* () {
    const stale = yield* Effect.promise(() => generate({ check: true }))
    assert.deepStrictEqual(stale, [], "run pnpm run ritsei gen")
  }),
)
