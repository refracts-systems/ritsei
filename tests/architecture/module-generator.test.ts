import { readFile } from "node:fs/promises"

import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import { isValidModuleName, registerModule, renderModule } from "../../tooling/ritsei.ts"

describe("ritsei new module", () => {
  it("scaffolds structure without capabilities, tables, or routes", () => {
    const files = renderModule("supplier_contract")
    assert.deepStrictEqual(
      files.map(({ path }) => path),
      [
        "erp/modules/supplier_contract/manifest.ts",
        "erp/modules/supplier_contract/mod.ts",
        "erp/modules/supplier_contract/src/contract.ts",
        "erp/modules/supplier_contract/src/layers.ts",
        "erp/modules/supplier_contract/tests/supplier_contract.test.ts",
      ],
    )
    const manifest = files[0]!.content
    assert.include(manifest, "export const SupplierContractModule = defineModule({")
    for (const empty of [
      "schemas: []",
      "capabilities: {}",
      "actions: []",
      "http: []",
      "pages: []",
    ]) {
      assert.include(manifest, empty)
    }
    assert.notInclude(files.map(({ content }) => content).join("\n"), "pgSchema")
  })

  it("rejects names outside the module and capability grammar", () => {
    for (const name of ["Orders", "supplier-contract", "1orders", ""]) {
      assert.isFalse(isValidModuleName(name))
      assert.throws(() => renderModule(name))
    }
  })

  it.effect("registers the manifest in import order and appends it to the installed list", () =>
    Effect.gen(function* () {
      const registry = yield* Effect.promise(() => readFile("erp/runtime/modules.ts", "utf8"))
      const updated = registerModule(registry, "returns")
      const lines = updated.split("\n")
      const imported = lines.indexOf('import { ReturnsModule } from "../modules/returns/mod.ts"')
      assert.isAbove(
        imported,
        lines.indexOf('import { ProcurementModule } from "../modules/procurement/mod.ts"'),
      )
      assert.isBelow(
        imported,
        lines.indexOf('import { SalesModule } from "../modules/sales/mod.ts"'),
      )
      assert.strictEqual(lines[lines.lastIndexOf("]") - 1], "  ReturnsModule,")
      assert.throws(() => registerModule(updated, "returns"))
    }),
  )
})
