import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import { ErpModules } from "../../erp/runtime/modules.ts"
import { checkModules } from "../../tooling/modules.ts"

it.effect("installed module manifests match the repository", () =>
  Effect.gen(function* () {
    const failures = yield* Effect.promise(() => checkModules(ErpModules))
    assert.deepStrictEqual(failures, [])
  }),
)
