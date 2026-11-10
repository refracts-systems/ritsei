import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { readFile } from "node:fs/promises"
import { iconRegistry } from "../../apps/web/src/ui/icons/registry.ts"
import {
  buildSprite,
  readRegistryGlyphs,
  spritePath,
} from "../../tooling/frontend/phosphor-sprite.ts"

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
