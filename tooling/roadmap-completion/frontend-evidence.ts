export type FrontendEvidenceStatus = "blocked" | "passed" | "approved_with_risk"

export type FrontendRiskCheckPolicy = {
  readonly riskId: string
  readonly behaviorTest: string
  readonly approvedPrimitives: readonly string[]
}

export const frontendEvidence = {
  "frontend.design-system": {
    path: "docs/operations/frontend-design-system-evidence.json",
    checks: [
      "kobalte-solid2-compatibility",
      "tokens",
      "focus",
      "keyboard",
      "contrast",
      "density",
      "theme",
      "reduced-motion",
      "vendor-boundaries",
    ],
    riskPolicy: {
      "kobalte-solid2-compatibility": {
        riskId: "solid2-peer-range-mismatch",
        behaviorTest: "tests/frontend/kobalte.test.ts",
        approvedPrimitives: ["Dialog"],
      },
    },
  },
  "frontend.accessibility-performance": {
    path: "docs/operations/frontend-readiness-evidence.json",
    checks: [
      "keyboard",
      "screen-reader",
      "focus-errors",
      "contrast-high-contrast",
      "reduced-motion",
      "zoom-localization",
      "route-splitting",
      "bundle-size",
      "interaction-latency",
      "long-session",
      "semantic-fallback",
    ],
    riskPolicy: {},
  },
} as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isDate = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  new Date(value).toISOString().slice(0, 10) === value

const isSafePath = (value: unknown, prefix: string): value is string =>
  typeof value === "string" &&
  value.startsWith(prefix) &&
  value.split("/").every((part) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part))

// Proofs are repository-relative files, never URLs, absolute paths, or traversal.
export const isFrontendProofPath = (value: unknown): value is string =>
  isSafePath(value, "docs/operations/")

export const isFrontendBrowserTestPath = (value: unknown): value is string =>
  isSafePath(value, "tests/frontend/")

const isFrontendUiPath = (value: unknown): value is string => isSafePath(value, "apps/web/src/ui/")

const isFrontendUsagePath = (value: unknown): value is string =>
  isSafePath(value, "apps/web/src/app/") || isSafePath(value, "apps/web/src/features/")

const isRiskApproval = (
  checkName: string,
  check: Record<string, unknown>,
  policy: Readonly<Record<string, FrontendRiskCheckPolicy>>,
  fileExists: (path: string) => boolean,
): boolean => {
  const rule = policy[checkName]
  if (rule === undefined || check.compatibility === undefined) return false

  const compatibility = check.compatibility
  if (
    !isRecord(compatibility) ||
    compatibility.bundle !== "passed" ||
    compatibility.build !== "passed"
  )
    return false

  const behavior = check.behavior
  if (
    !isRecord(behavior) ||
    behavior.status !== "passed" ||
    behavior.browserTest !== rule.behaviorTest ||
    !isFrontendBrowserTestPath(behavior.browserTest) ||
    !fileExists(behavior.browserTest)
  )
    return false

  const acceptance = check.riskAcceptance
  if (
    !isRecord(acceptance) ||
    acceptance.status !== "accepted" ||
    acceptance.id !== rule.riskId ||
    typeof acceptance.acceptedBy !== "string" ||
    acceptance.acceptedBy.trim() === "" ||
    !isDate(acceptance.acceptedDate) ||
    typeof acceptance.rollback !== "string" ||
    acceptance.rollback.trim() === ""
  )
    return false

  const dependencyPolicy = check.dependencyPolicy
  if (
    !isRecord(dependencyPolicy) ||
    dependencyPolicy.pinned !== true ||
    dependencyPolicy.automaticUpgrades !== false ||
    dependencyPolicy.lockfile !== "pnpm-lock.yaml"
  )
    return false

  const production = check.productionApproval
  if (!isRecord(production) || !Array.isArray(production.primitives)) return false
  if (production.status === "not_activated") return production.primitives.length === 0
  if (production.status !== "approved_with_risk" || production.primitives.length === 0) return false

  return production.primitives.every((primitive) => {
    if (!isRecord(primitive) || typeof primitive.name !== "string") return false
    if (!rule.approvedPrimitives.includes(primitive.name)) return false
    return (
      isFrontendUiPath(primitive.contract) &&
      fileExists(primitive.contract) &&
      isFrontendUsagePath(primitive.usage) &&
      fileExists(primitive.usage) &&
      isFrontendBrowserTestPath(primitive.browserTest) &&
      fileExists(primitive.browserTest)
    )
  })
}

export type FrontendEvidenceOptions = {
  readonly riskPolicy?: Readonly<Record<string, FrontendRiskCheckPolicy>>
  readonly fileExists?: (path: string) => boolean
}

export const evaluateFrontendEvidence = (
  text: string | undefined,
  requiredChecks: readonly string[],
  proofExists: (path: string) => boolean,
  options: FrontendEvidenceOptions = {},
): boolean => {
  try {
    const evidence: unknown = JSON.parse(text ?? "")
    if (
      !isRecord(evidence) ||
      (evidence.status !== "passed" && evidence.status !== "approved_with_risk") ||
      typeof evidence.reviewer !== "string" ||
      evidence.reviewer.trim() === "" ||
      !isDate(evidence.reviewDate) ||
      !isRecord(evidence.checks) ||
      requiredChecks.length === 0
    )
      return false

    const checks = evidence.checks
    if (!requiredChecks.every((name) => Object.hasOwn(checks, name))) return false
    const fileExists = options.fileExists ?? proofExists
    const statuses = Object.entries(checks).map(([name, check]) => {
      if (!isRecord(check) || !isFrontendProofPath(check.proof) || !proofExists(check.proof)) {
        return undefined
      }
      if (check.status === "passed") return "passed" as const
      if (
        check.status === "approved_with_risk" &&
        isRiskApproval(name, check, options.riskPolicy ?? {}, fileExists)
      )
        return "approved_with_risk" as const
      return undefined
    })
    if (statuses.some((status) => status === undefined)) return false
    const hasRisk = statuses.some((status) => status === "approved_with_risk")
    return evidence.status === (hasRisk ? "approved_with_risk" : "passed")
  } catch {
    return false
  }
}
