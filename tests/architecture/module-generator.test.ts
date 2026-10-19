import { assert, describe, it } from "@effect/vitest"

import { isValidModuleName, renderModule } from "../../tooling/ritsei.ts"

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
})
