import { readFile } from "node:fs/promises"

import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import ts from "typescript"

import {
  addCapabilities,
  addOwnership,
  addSchemaExports,
  addSchemaFilter,
  addServiceLayer,
} from "../../tooling/entity-edits.ts"
import { entityNames, renderEntityModule } from "../../tooling/entity-templates.ts"
import { partial } from "../support/partial.ts"

const names = entityNames("service_contract", "contract")
const read = (path: string) => Effect.promise(() => readFile(path, "utf8"))

/** The edited source still parses, and only the expected text was added. */
const assertInserted = (
  path: string,
  before: string,
  after: string,
  expected: readonly string[],
) => {
  const file = ts.createSourceFile(path, after, ts.ScriptTarget.Latest, true)
  assert.deepStrictEqual(
    partial<{ parseDiagnostics: readonly unknown[] }>()(file).parseDiagnostics,
    [],
  )

  for (const text of expected) assert.include(after, text)
  let remaining = after

  for (const text of expected) remaining = remaining.replace(text, "")
  assert.strictEqual(remaining.replace(/[\s,]/g, ""), before.replace(/[\s,]/g, ""))
}

describe("ritsei new module --entity", () => {
  it("renders the module, table, endpoint, page, and tests under the owner's paths", () => {
    const paths = renderEntityModule(names).map(({ path }) => path)

    for (const expected of [
      "erp/modules/service_contract/manifest.ts",
      "erp/modules/service_contract/http.ts",
      "erp/modules/service_contract/tests/service_contract.test.ts",
      "db/schema/service_contract.ts",
      "apps/web/src/app/modules/service_contract.tsx",
      "apps/web/src/app/modules/service_contract.workspace.ts",
    ]) {
      assert.include(paths, expected)
    }

    assert.isTrue(
      paths.every((path) =>
        /^(?:erp\/modules\/service_contract|db\/schema|apps\/web\/src\/(?:features|app\/modules))\//.test(
          path,
        ),
      ),
    )
  })

  it("declares read and create capabilities, deny by default", () => {
    const capabilities = renderEntityModule(names).find(({ path }) =>
      path.endsWith("src/capabilities.ts"),
    )!.content

    assert.include(capabilities, '"service_contract.contract.read"')
    assert.include(capabilities, '"service_contract.contract.create"')
    assert.include(capabilities, "Deny by default")
  })

  it.effect("inserts capabilities, owner, and definitions into the closed catalog", () =>
    Effect.gen(function* () {
      const path = "framework/modules/authorization/src/capabilities.ts"
      const before = yield* read(path)
      assertInserted(path, before, addCapabilities(path, before, names), [
        '"service_contract.contract.read"',
        '"service_contract.contract.create"',
        '"service_contract"',
        'definition("service_contract.contract.read", "service_contract", "contract", "read")',
        'definition("service_contract.contract.create", "service_contract", "contract", "create")',
      ])
    }),
  )

  it.effect("adds the schema to Drizzle Kit and to the schema entry point", () =>
    Effect.gen(function* () {
      const config = yield* read("drizzle.config.ts")
      assertInserted(
        "drizzle.config.ts",
        config,
        addSchemaFilter("drizzle.config.ts", config, names),
        ['"service_contract"'],
      )
      const index = yield* read("db/schema/index.ts")
      const exported = addSchemaExports("index.ts", index, names)
      assertInserted("index.ts", index, exported, [
        'export { serviceContractSchema, contracts } from "./service_contract.ts"',
      ])
      assert.isAbove(exported.indexOf("./service_contract.ts"), exported.indexOf("./sales.ts"))
    }),
  )

  it.effect("composes the service layer into ApplicationLive", () =>
    Effect.gen(function* () {
      const layers = yield* read("erp/runtime/layers.ts")
      const edited = addServiceLayer("layers.ts", layers, names)
      assertInserted("layers.ts", layers, edited, [
        'import { ServiceContractLive } from "../modules/service_contract/mod.ts"',
        "const ServiceContractServiceLive = ServiceContractLive.pipe(Layer.provide(BusinessRequirements))",
        "ServiceContractServiceLive",
      ])
      assert.isAbove(
        edited.lastIndexOf("ServiceContractServiceLive"),
        edited.indexOf("const ApplicationLive = Layer.mergeAll("),
      )
    }),
  )

  it.effect("assigns schema ownership inside the [schemas] section", () =>
    Effect.gen(function* () {
      const ownership = yield* read("db/ownership.toml")
      const edited = addOwnership(ownership, names)
      const line = 'service_contract = "erp/modules/service_contract"'
      assert.include(edited, line)
      assert.isAbove(edited.indexOf(line), edited.indexOf("[schemas]"))
      assert.strictEqual(edited.replace(`\n${line}`, ""), ownership)
    }),
  )
})
