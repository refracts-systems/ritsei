import { assert, describe, it } from "@effect/vitest"

import { analyzeAiBoundary, analyzePublicPackageImports } from "../../tooling/architecture.ts"
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
        { path: "modules/a/mod.ts", source: 'export { A } from "./src/service.ts"' },
        {
          path: "modules/a/src/service.ts",
          source: 'import { B } from "../../b/src/service.ts"',
        },
        { path: "modules/b/mod.ts", source: 'export { B } from "./src/service.ts"' },
      ],
      ["a", "b"],
    )

    assert.isTrue(failures.some((failure) => failure.includes("must use modules/b/mod.ts")))
  })

  it("keeps AI/provider code behind the integration and persistence boundaries", () => {
    const providerImport = (name: string, binding: string) =>
      `import ${binding} from ${JSON.stringify(name)}`

    assert.deepStrictEqual(
      analyzeAiBoundary([
        {
          path: "modules/integrations/src/model-adapter.ts",
          source: providerImport("effect/ai", "{ LanguageModel }"),
        },
      ]),
      [],
    )
    assert.isTrue(
      analyzeAiBoundary([
        {
          path: "modules/sales/src/service.ts",
          source: providerImport("effect/ai/LanguageModel", "* as LanguageModel"),
        },
      ]).some((failure) => failure.includes("must stay under modules/integrations/")),
    )
    const integrationSchemaPath = ["../../../db/schema", "integration.ts"].join("/")
    assert.deepStrictEqual(
      analyzeAiBoundary([
        {
          path: "modules/integrations/src/reliability-store.ts",
          source: [
            `import { externalReliabilityRecords } from "${integrationSchemaPath}"`,
            'import { Database } from "../../foundation/mod.ts"',
            "database.transaction(() => undefined)",
          ].join("\n"),
        },
      ]),
      [],
    )
    assert.isTrue(
      analyzeAiBoundary([
        {
          path: "modules/integrations/src/reliability-store.ts",
          source: providerImport("openai", "OpenAI"),
        },
      ]).some((failure) => failure.includes("persistence adapter cannot import provider SDK")),
    )
    assert.deepStrictEqual(
      analyzeAiBoundary([
        {
          path: "modules/integrations/src/governance-store.ts",
          source: [
            `import { externalConnectorGovernance } from "${integrationSchemaPath}"`,
            'import { Database } from "../../foundation/mod.ts"',
            "database.transaction(() => undefined)",
          ].join("\n"),
        },
      ]),
      [],
    )
    assert.isTrue(
      analyzeAiBoundary([
        {
          path: "modules/integrations/src/governance-store.ts",
          source: providerImport("openai", "OpenAI"),
        },
      ]).some((failure) => failure.includes("persistence adapter cannot import provider SDK")),
    )

    const failures = analyzeAiBoundary([
      {
        path: "modules/sales/src/recommendations/model.ts",
        source: [
          providerImport("openai", "OpenAI"),
          ['import { orders } from "../../db/', "schema/sales.ts", '"'].join(""),
          "database.update(orders)",
        ].join("\n"),
      },
    ])

    assert.isTrue(
      failures.some((failure) => failure.includes("must stay under modules/integrations")),
    )
    assert.isTrue(failures.some((failure) => failure.includes("private persistence")))
    assert.isTrue(failures.some((failure) => failure.includes("direct business-fact mutations")))
  })
})
