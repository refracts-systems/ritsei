import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { ProcessPack, resolveProcessPackCapabilities } from "../mod.ts"

const salesConfirm = {
  kind: "DomainAction" as const,
  id: "sales.order.confirm",
  version: 1,
}

const pack = {
  id: "distribution.starter",
  version: 1,
  stability: "EXPERIMENTAL" as const,
  profileId: "distribution",
  name: "Distribution starter pack",
  description: "Curated starter processes for a distribution company.",
  processTemplateIds: ["order-confirmation"],
  requiredCapabilities: [salesConfirm],
  optionalCapabilities: [
    {
      kind: "DomainAction" as const,
      id: "inventory.stock.adjust",
      version: 1,
    },
  ],
  decisions: [],
  forms: [],
  configuration: [],
  recommendedPolicies: [],
  projections: [],
  documentation: [],
}

it.effect("decodes semantic Process Packs and resolves exact required capabilities", () =>
  Effect.gen(function* () {
    const decoded = yield* Schema.decodeUnknownEffect(ProcessPack)(pack)
    const resolution = resolveProcessPackCapabilities(decoded, [salesConfirm])

    assert.strictEqual(resolution.packId, "distribution.starter")
    assert.strictEqual(resolution.status, "ready")
    assert.deepStrictEqual(resolution.missingRequiredCapabilities, [])
  }),
)

it("reports missing required versions without blocking optional capabilities", () => {
  const resolution = resolveProcessPackCapabilities(pack, [{ ...salesConfirm, version: 2 }])

  assert.strictEqual(resolution.status, "missing_required_capabilities")
  assert.deepStrictEqual(resolution.missingRequiredCapabilities, [salesConfirm])
})

it.effect("requires at least one process template", () =>
  Effect.gen(function* () {
    const failure = yield* Effect.flip(
      Schema.decodeUnknownEffect(ProcessPack)({ ...pack, processTemplateIds: [] }),
    )

    assert.strictEqual(failure._tag, "SchemaError")
  }),
)
