import { assert, describe, it } from "@effect/vitest"
import {
  evaluateFrontendEvidence,
  frontendEvidence,
} from "../../tooling/roadmap-completion/frontend-evidence.ts"
import { gates } from "../../tooling/roadmap-completion/registry.ts"
import { parsePassedTestFiles } from "../../tooling/roadmap-completion/test-report.ts"

const suite = (statuses = ["passed"]) => ({
  name: "/repo/tests/frontend/shell.test.ts",
  status: "passed",
  assertionResults: statuses.map((status) => ({ status })),
})
const report = (...testResults: unknown[]) => JSON.stringify({ testResults })
const proof = "docs/operations/frontend-review.md"

const acceptedEvidence = (checks: readonly string[]) => ({
  status: "passed",
  reviewer: "Frontend reviewer",
  reviewDate: "2026-09-01",
  checks: Object.fromEntries(checks.map((name) => [name, { status: "passed", proof }])),
})

describe("frontend gate evidence", () => {
  it("requires behavioral tests alongside documentary checks and preserves upstream dependencies", () => {
    for (const [id, test] of [
      ["frontend.shell", "tests/frontend/shell.test.ts"],
      ["frontend.application-boundaries", "tests/frontend/workflow.test.ts"],
      ["frontend.design-system", "apps/web/src/ui/accessibility.test.ts"],
      ["frontend.design-system", "tests/frontend/kobalte.test.ts"],
      ["frontend.accessibility-performance", "apps/web/src/ui/accessibility.test.ts"],
    ]) {
      const gate = gates.find((gate) => gate.id === id)!
      const files = gate.commands!.flatMap((command) => command.args.slice(2))
      assert.include(files, test)
      assert.include(files, "tests/architecture/roadmap-track-contracts.test.ts")
    }
    assert.deepEqual(gates.find((gate) => gate.id === "frontend.shell")!.dependencies, [
      "workload.command-reserve",
      "process.designer095",
    ])
    assert.deepEqual(
      gates.find((gate) => gate.id === "frontend.accessibility-performance")!.dependencies,
      ["frontend.application-boundaries", "frontend.design-system"],
    )
  })

  it("accepts JSON reports after runner log output", () => {
    assert.deepEqual(
      [...parsePassedTestFiles(`transforming...\n✓ contracts\n${report(suite())}`)],
      [suite().name],
    )
  })

  it("accepts only suites with positive, entirely passed assertion results", () => {
    assert.deepEqual([...parsePassedTestFiles(report(suite()))], [suite().name])
    for (const status of ["skipped", "pending", "todo", "failed", "unknown"]) {
      assert.equal(parsePassedTestFiles(report(suite(["passed", status]))).size, 0)
    }
    assert.equal(parsePassedTestFiles(report(suite([]))).size, 0)
    assert.equal(parsePassedTestFiles(report({ ...suite(), status: "failed" })).size, 0)
    assert.deepEqual(
      [...parsePassedTestFiles(report({ ...suite(), name: "C:\\repo\\shell.test.ts" }))],
      ["C:/repo/shell.test.ts"],
    )
  })

  it("fails closed on absent, malformed, incomplete, or duplicate reports", () => {
    for (const text of [
      undefined,
      "",
      "not json",
      "null",
      "[]",
      "{}",
      '{"testResults":{}}',
      report(null),
      report({ name: "test.ts", status: "passed" }),
      report({ ...suite(), assertionResults: [null] }),
      report({ ...suite(), assertionResults: [{}] }),
      report({ ...suite(), name: "" }),
      report(suite(), suite()),
      report(suite(), null),
    ])
      assert.equal(parsePassedTestFiles(text).size, 0)
  })

  it("requires reviewed, passing checks and existing proof for both manual gates", () => {
    for (const { checks } of Object.values(frontendEvidence)) {
      const valid = acceptedEvidence(checks)
      const evaluate = (value: unknown) =>
        evaluateFrontendEvidence(JSON.stringify(value), checks, (path) => path === proof)
      assert.isTrue(evaluate(valid))
      for (const invalid of [
        null,
        {},
        { ...valid, status: "blocked" },
        { ...valid, status: "failed" },
        { ...valid, reviewer: " " },
        { ...valid, reviewDate: "" },
        { ...valid, reviewDate: "2026-02-30" },
        { ...valid, checks: {} },
        { ...valid, checks: [] },
        { ...valid, checks: { ...valid.checks, [checks[0]!]: { status: "blocked", proof } } },
        { ...valid, checks: { ...valid.checks, [checks[0]!]: { status: "passed" } } },
      ])
        assert.isFalse(evaluate(invalid))
      assert.isFalse(evaluateFrontendEvidence(JSON.stringify(valid), checks, () => false))
      assert.isFalse(evaluateFrontendEvidence(undefined, checks, () => true))
      assert.isFalse(evaluateFrontendEvidence("broken json", checks, () => true))
    }
  })

  it("accepts only the configured Kobalte risk with explicit non-global activation", () => {
    const evidence = frontendEvidence["frontend.design-system"]
    const checks: Record<string, Record<string, unknown>> = Object.fromEntries(
      evidence.checks.map((name) => [name, { status: "passed", proof }]),
    )
    checks["kobalte-solid2-compatibility"] = {
      status: "approved_with_risk",
      proof,
      compatibility: { bundle: "passed", build: "passed", peerRange: "accepted_risk" },
      behavior: {
        status: "passed",
        browserTest: "tests/frontend/kobalte.test.ts",
      },
      riskAcceptance: {
        status: "accepted",
        id: "solid2-peer-range-mismatch",
        acceptedBy: "Frontend reviewer",
        acceptedDate: "2026-09-05",
        rollback: "Use the semantic HTML fallback.",
      },
      dependencyPolicy: {
        pinned: true,
        automaticUpgrades: false,
        lockfile: "pnpm-lock.yaml",
      },
      productionApproval: {
        status: "not_activated",
        primitives: [],
      },
    }
    const value = {
      status: "approved_with_risk",
      reviewer: "Frontend reviewer",
      reviewDate: "2026-09-05",
      checks,
    }
    const options = {
      riskPolicy: evidence.riskPolicy,
      fileExists: (path: string) => path === proof || path === "tests/frontend/kobalte.test.ts",
    }
    const evaluate = (candidate: unknown) =>
      evaluateFrontendEvidence(
        JSON.stringify(candidate),
        evidence.checks,
        (path) => path === proof,
        options,
      )

    assert.isTrue(evaluate(value))
    assert.isFalse(evaluate({ ...value, status: "passed" }))
    assert.isFalse(
      evaluate({
        ...value,
        checks: {
          ...checks,
          "kobalte-solid2-compatibility": {
            ...checks["kobalte-solid2-compatibility"],
            riskAcceptance: {
              ...(checks["kobalte-solid2-compatibility"].riskAcceptance as Record<string, unknown>),
              id: "other-risk",
            },
          },
        },
      }),
    )
    assert.isFalse(
      evaluate({
        ...value,
        checks: {
          ...checks,
          "kobalte-solid2-compatibility": {
            ...checks["kobalte-solid2-compatibility"],
            productionApproval: {
              status: "approved_with_risk",
              primitives: [
                {
                  name: "Select",
                  contract: "apps/web/src/ui/select.tsx",
                  usage: "apps/web/src/features/identity/accounts.tsx",
                  browserTest: "tests/frontend/kobalte.test.ts",
                },
              ],
            },
          },
        },
      }),
    )
  })

  it("rejects unsafe proof paths before consulting the filesystem", () => {
    const checks = frontendEvidence["frontend.design-system"].checks
    for (const path of [
      "../secret",
      "/tmp/proof",
      "docs/operations/../secret",
      "docs/operations/./proof",
      "docs/operations//proof",
      "docs/operations/",
      "docs/operations/\\secret",
      "https://example.com/proof",
      "docs/operations/%2e%2e/secret",
      "C:\\proof",
    ]) {
      const valid = acceptedEvidence(checks)
      valid.checks[checks[0]!] = { status: "passed", proof: path }
      let unsafeRead = false
      assert.isFalse(
        evaluateFrontendEvidence(JSON.stringify(valid), checks, (requested) => {
          if (requested === path) unsafeRead = true
          return true
        }),
      )
      assert.isFalse(unsafeRead)
    }
  })
})
