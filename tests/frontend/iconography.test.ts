import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { readFile } from "node:fs/promises"
import { iconRegistry } from "../../apps/web/src/ui/icons/registry.ts"
import { defaultIconVariant } from "../../apps/web/src/ui/icons/semantics.ts"
import {
  buildSprite,
  readRegistryGlyphs,
  spritePath,
} from "../../tooling/frontend/phosphor-sprite.ts"

it("keeps semantic icon names stable across provider mappings", () => {
  assert.equal(iconRegistry["action.delete"], "trash")
  assert.equal(iconRegistry["object.purchase-order"], "clipboard-text")
  assert.equal(defaultIconVariant("status.warning"), "regular")
  assert.equal(defaultIconVariant("empty.purchase-order"), "duotone")
})

it.effect("keeps the committed icon sprite in sync with the registry", () =>
  Effect.gen(function* () {
    // Regenerate with: pnpm exec tsx tooling/frontend/phosphor-sprite.ts
    const committed = (yield* Effect.promise(() => readFile(spritePath, "utf8"))).replaceAll(
      "\r\n",
      "\n",
    )
    assert.deepEqual(
      yield* Effect.promise(readRegistryGlyphs),
      [...new Set(Object.values(iconRegistry))].toSorted(),
    )
    assert.equal(committed, yield* Effect.promise(buildSprite))
    for (const glyph of new Set(Object.values(iconRegistry))) {
      assert.include(committed, `id="ph-${glyph}"`)
      assert.include(committed, `id="ph-${glyph}-fill"`)
    }
  }),
)
