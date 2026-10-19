import { assert, describe, it } from "@effect/vitest"

import {
  analyzeAiBoundary,
  analyzeLayerImports,
  analyzePublicPackageImports,
} from "../../tooling/architecture.ts"
import { validateSkillDocument } from "../../tooling/check-agent-skills.ts"

const validSkill = `---
name: example-workflow
description: "Use when an RITSEI change needs a repository-native example workflow."
---

# Purpose
`

describe("repository tooling", () => {
  it("validates repository-native skill frontmatter", () => {
    assert.deepStrictEqual(
      validateSkillDocument(".agents/skills/example-workflow/SKILL.md", validSkill),
      [],
    )
    assert.isTrue(
      validateSkillDocument(".agents/skills/other-workflow/SKILL.md", validSkill).some((failure) =>
        failure.includes("must match directory"),
      ),
    )
  })

  it("rejects cross-package imports outside public entry points", () => {
    const failures = analyzePublicPackageImports(
      [
        { path: "erp/modules/a/mod.ts", source: 'export { A } from "./src/service.ts"' },
        {
          path: "erp/modules/a/src/service.ts",
          source: 'import { B } from "../../../../framework/modules/b/src/service.ts"',
        },
        { path: "framework/modules/b/mod.ts", source: 'export { B } from "./src/service.ts"' },
      ],
      ["erp/modules/a", "framework/modules/b"],
    )

    assert.isTrue(
      failures.some((failure) => failure.includes("must use framework/modules/b/mod.ts")),
    )
  })

  it("keeps the framework independent of the ERP and extensions", () => {
    const failures = analyzeLayerImports([
      {
        path: "framework/modules/catalog/src/service.ts",
        source: 'import { Sales } from "../../../../erp/modules/sales/mod.ts"',
      },
      {
        path: "erp/modules/sales/src/service.ts",
        source: 'import { Extra } from "../../../../extensions/extra/mod.ts"',
      },
    ])

    assert.isTrue(failures.some((failure) => failure.includes("framework must not import erp")))
    assert.isTrue(failures.some((failure) => failure.includes("erp must not import extensions")))
    assert.deepStrictEqual(
      analyzeLayerImports([
        {
          path: "erp/modules/sales/src/service.ts",
          source: 'import { Database } from "../../../../framework/foundation/mod.ts"',
        },
        {
          path: "extensions/extra/src/service.ts",
          source: 'import { Sales } from "../../../erp/modules/sales/mod.ts"',
        },
      ]),
      [],
    )
  })

  it("keeps AI/provider code behind the integration and persistence boundaries", () => {
    const providerImport = (name: string, binding: string) =>
      `import ${binding} from ${JSON.stringify(name)}`

    assert.deepStrictEqual(
      analyzeAiBoundary([
        {
          path: "framework/modules/integrations/src/model-adapter.ts",
          source: providerImport("effect/ai", "{ LanguageModel }"),
        },
      ]),
      [],
    )
    assert.isTrue(
      analyzeAiBoundary([
        {
          path: "erp/modules/sales/src/service.ts",
          source: providerImport("effect/ai/LanguageModel", "* as LanguageModel"),
        },
      ]).some((failure) => failure.includes("must stay under framework/modules/integrations/")),
    )
    const integrationSchemaPath = ["../../../db/schema", "integration.ts"].join("/")
    assert.deepStrictEqual(
      analyzeAiBoundary([
        {
          path: "framework/modules/integrations/src/reliability-store.ts",
          source: [
            `import { externalReliabilityRecords } from "${integrationSchemaPath}"`,
            'import { Database } from "../../framework/foundation/mod.ts"',
            "database.transaction(() => undefined)",
          ].join("\n"),
        },
      ]),
      [],
    )
    assert.isTrue(
      analyzeAiBoundary([
        {
          path: "framework/modules/integrations/src/reliability-store.ts",
          source: providerImport("openai", "OpenAI"),
        },
      ]).some((failure) => failure.includes("persistence adapter cannot import provider SDK")),
    )
    assert.deepStrictEqual(
      analyzeAiBoundary([
        {
          path: "framework/modules/integrations/src/governance-store.ts",
          source: [
            `import { externalConnectorGovernance } from "${integrationSchemaPath}"`,
            'import { Database } from "../../framework/foundation/mod.ts"',
            "database.transaction(() => undefined)",
          ].join("\n"),
        },
      ]),
      [],
    )
    assert.isTrue(
      analyzeAiBoundary([
        {
          path: "framework/modules/integrations/src/governance-store.ts",
          source: providerImport("openai", "OpenAI"),
        },
      ]).some((failure) => failure.includes("persistence adapter cannot import provider SDK")),
    )

    const failures = analyzeAiBoundary([
      {
        path: "erp/modules/sales/src/recommendations/model.ts",
        source: [
          providerImport("openai", "OpenAI"),
          ['import { orders } from "../../db/', "schema/sales.ts", '"'].join(""),
          "database.update(orders)",
        ].join("\n"),
      },
    ])

    assert.isTrue(
      failures.some((failure) =>
        failure.includes("must stay under framework/modules/integrations"),
      ),
    )
    assert.isTrue(failures.some((failure) => failure.includes("private persistence")))
    assert.isTrue(failures.some((failure) => failure.includes("direct business-fact mutations")))
  })
})
