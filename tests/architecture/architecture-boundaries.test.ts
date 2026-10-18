import { assert, describe, it } from "@effect/vitest"

import { analyzeFrontend } from "../../tooling/architecture.ts"

describe("architecture boundaries", () => {
  const frontend = (source: string, path = "apps/web/src/features/identity/page.tsx") =>
    analyzeFrontend({ path, source })

  it("contains primitive, generated styling, and renderer vendors inside UI", () => {
    for (
      const specifier of [
        "@kobalte/core/dialog",
        "@pandacss/dev",
        "@dnd-kit/solid",
        "vgpu/client",
        "@vgpu/render/inspect",
        "typegpu",
        "three",
        "styled-system/css",
        "../../ui/generated/css",
        "@/ui/generated/css",
        "~/ui/generated/css",
        "../../../../../vendor/renderer/mod.ts",
      ]
    ) {
      assert.isNotEmpty(frontend(`import { value } from "${specifier}"`), specifier)
    }
    assert.deepStrictEqual(
      frontend(
        "import { Dialog } from \"@kobalte/core/dialog\"; import { css } from \"./generated/css\"",
        "apps/web/src/ui/button.tsx",
      ),
      [],
    )
    assert.deepStrictEqual(frontend("import { Button } from \"../../ui/mod.ts\""), [])
  })

  it("requires leaf RITSEI UI imports instead of catch-all barrels", () => {
    for (const specifier of ["../../ui/index.ts", "../../ui/recipes/index.ts"]) {
      assert.isNotEmpty(frontend(`import { value } from "${specifier}"`), specifier)
    }
    assert.deepStrictEqual(
      frontend("import { layout } from \"../../ui/foundations/layout.ts\""),
      [],
    )
  })

  it("keeps shared UI independent of application and domain knowledge", () => {
    for (
      const specifier of [
        "../features/identity/mod.ts",
        "../app/runtime.ts",
        "../routes/identity.ts",
        "../domains/identity.ts",
        "../shared/api/identity.ts",
        "../shared/contracts/generated/identity.ts",
        "../../../../modules/identity/mod.ts",
      ]
    ) {
      assert.isNotEmpty(
        frontend(
          `import type { Value } from "${specifier}"`,
          "apps/web/src/ui/button.tsx",
        ),
        specifier,
      )
    }
    assert.deepStrictEqual(
      frontend(
        "import type { Money } from \"../shared/values/money.ts\"",
        "apps/web/src/ui/button.tsx",
      ),
      [],
    )
  })

  it("rejects backend runtime imports, reexports, mixed imports, and dynamic imports", () => {
    for (
      const source of [
        "import { Identity } from \"@ritsei/identity\"",
        "import { type User, Identity } from \"@ritsei/identity\"",
        "export { Identity } from \"@ritsei/identity\"",
        "export * from \"@ritsei/identity\"",
        "import \"@ritsei/identity\"",
        "const service = import(\"@ritsei/identity\")",
        "const service = require(\"@ritsei/identity\")",
        "import { Database } from \"../../../../../foundation/mod.ts\"",
        "import type { Private } from \"../../../../../modules/identity/src/service.ts\"",
        "import type { Database } from \"../../../../../platform/postgres/mod.ts\"",
      ]
    ) assert.isNotEmpty(frontend(source), source)
  })

  it("allows erased public contract types and local generated runtime schemas", () => {
    for (
      const source of [
        "import type { User } from \"@ritsei/identity\"",
        "import { type User } from \"@ritsei/identity\"",
        "export type { User } from \"@ritsei/identity\"",
        "export { type User } from \"@ritsei/identity\"",
        "type User = import(\"@ritsei/identity\").User",
        "import type { Value } from \"../../../../../foundation/mod.ts\"",
        "import { User } from \"../../shared/contracts/generated/identity.ts\"",
        "// import { Identity } from \"@ritsei/identity\"",
      ]
    ) assert.deepStrictEqual(frontend(source), [], source)
  })

  it("exempts tests, configs, and the explicitly nonproduction experiment", () => {
    for (
      const path of [
        "apps/web/vite.config.ts",
        "apps/web/src/ui/example.test.tsx",
        "apps/web/src/__tests__/example.ts",
        "apps/web/src/__fixtures__/example.ts",
        "apps/web/src/experiments/solid-effect/src/main.tsx",
      ]
    ) assert.deepStrictEqual(frontend("import { Identity } from \"@ritsei/identity\"", path), [])
    assert.isNotEmpty(frontend(
      "import { Identity } from \"@ritsei/identity\"",
      "apps/web/src/experiments/production/main.tsx",
    ))
  })
})
