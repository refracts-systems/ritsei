import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import { ErpModules } from "../../erp/runtime/modules.gen.ts"
import { checkModules, parseRules, ruleFailures } from "../../tooling/modules.ts"

it.effect("installed module manifests match the repository", () =>
  Effect.gen(function* () {
    const failures = yield* Effect.promise(() => checkModules(ErpModules))
    assert.deepStrictEqual(failures, [])
  }),
)

describe("module rules", () => {
  const rules = parseRules(
    [
      "# Stock Rules",
      "### `STK-1` Reservations never exceed stock",
      "text",
      "### `STK-2` Counts are approved",
      "This rule is unenforced until counts exist.",
      "### Not a rule",
    ].join("\n"),
  )

  const test = (path: string, source: string) => ({ path, source })

  it("reads identifiers and the unenforced mark from rule headings", () => {
    assert.deepStrictEqual(rules, [
      { id: "STK-1", unenforced: false },
      { id: "STK-2", unenforced: true },
    ])
  })

  it("requires a test to name every enforced rule and every named rule to exist", () => {
    const failures = ruleFailures(new Map([["stock", rules]]), [
      test("erp/modules/stock/tests/stock.test.ts", 'it("[STK-9] something")'),
      test("erp/modules/stock/src/service.ts", "// [STK-1] is not a test"),
    ])

    assert.deepStrictEqual(failures, [
      "erp/modules/stock/tests/stock.test.ts names rule STK-9, which erp/modules/stock/RULES.md does not declare",
      "erp/modules/stock/RULES.md: no test names [STK-1]; add one or mark it unenforced",
    ])
  })

  it("rejects an unenforced mark on a rule a test names", () => {
    const failures = ruleFailures(new Map([["stock", rules]]), [
      test("erp/modules/stock/tests/stock.test.ts", 'it("[STK-1] [STK-2] both")'),
    ])

    assert.deepStrictEqual(failures, [
      "erp/modules/stock/RULES.md: STK-2 is marked unenforced but a test names it",
    ])
  })
})
