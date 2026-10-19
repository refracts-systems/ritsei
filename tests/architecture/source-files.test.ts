import { assert, describe, it } from "@effect/vitest"
import { isIgnoredSourcePath } from "../../tooling/source-files.ts"

describe("source collection exclusions", () => {
  it("ignores only known generated frontend trees and nonproduction sources", () => {
    for (const path of [
      "vendor/effect/src/Effect.ts",
      "apps/web/node_modules/package/index.ts",
      ".auto/output.ts",
      "apps/web/src/ui/generated/css/index.ts",
      "apps/web/src/shared/contracts/generated/identity.ts",
      "apps/web/dist/assets/index.js",
      "apps/web/src/experiments/solid-effect/src/main.tsx",
    ]) {
      assert.isTrue(isIgnoredSourcePath(path), path)
      assert.isTrue(isIgnoredSourcePath(`/repo/${path}`), path)
      assert.isTrue(isIgnoredSourcePath(path.replaceAll("/", "\\")), path)
    }
    for (const path of [
      "framework/modules/identity/src/generated/policy.ts",
      "apps/web/src/features/identity/generated/policy.ts",
      "apps/web/src/ui/generated-business.ts",
      "apps/web/src/shared/contracts/generated-values.ts",
      "apps/web/src/experiments/production/main.tsx",
      "apps/web/src/ui/button.tsx",
    ])
      assert.isFalse(isIgnoredSourcePath(path), path)
  })
})
