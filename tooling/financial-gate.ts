import { readFile } from "node:fs/promises"

import { isMain } from "./entrypoint.ts"

export type EvidenceClass =
  | "repo-proof"
  | "local-real"
  | "staging-real"
  | "production-real"
  | "mock-only"
  | "missing"

export type FinancialGateEvidence = {
  readonly id: string
  readonly title: string
  readonly observed: "PASS" | "FAIL"
  readonly evidenceClass: EvidenceClass
  readonly acceptedEvidenceClasses: readonly EvidenceClass[]
  readonly evidence: readonly string[]
  readonly reason: string
  readonly failureCategory: "none" | "code" | "environment" | "evidence" | "governance"
  readonly requiredEvidence: string
  readonly remediation: string
}

export type FinancialManifest = {
  readonly schemaVersion: number
  readonly reviewedAt: string
  readonly baselineCommit: string
  readonly summary: {
    readonly passed: number
    readonly failed: number
    readonly total: number
  }
  readonly gates: readonly FinancialGateEvidence[]
}

export const requiredFinancialGateIds = [
  "controlled_activation",
  "process_kill_no_double_posting",
  "worker_adapter_restart",
  "tigerbeetle_outage_fail_closed",
  "replica_quorum_failure",
  "postgresql_not_financial_authority",
  "independent_backup_restore",
  "recovery_watermark",
  "global_reconciliation",
  "projection_rebuild",
  "artifact_integrity",
  "production_signing_custody",
  "key_rotation_recovery",
  "operator_alerts",
  "bounded_cohort",
  "no_unresolved_p0",
] as const

export type FinancialEvaluation = {
  readonly manifest: FinancialManifest
  readonly gates: readonly {
    readonly gate: FinancialGateEvidence
    readonly passes: boolean
  }[]
  readonly passed: number
  readonly failed: number
}

const evidenceClasses = new Set<EvidenceClass>([
  "repo-proof",
  "local-real",
  "staging-real",
  "production-real",
  "mock-only",
  "missing",
])

const failureCategories = new Set<FinancialGateEvidence["failureCategory"]>([
  "none",
  "code",
  "environment",
  "evidence",
  "governance",
])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isEvidenceClass = (value: unknown): value is EvidenceClass =>
  typeof value === "string" && evidenceClasses.has(value as EvidenceClass)

const isFailureCategory = (value: unknown): value is FinancialGateEvidence["failureCategory"] =>
  typeof value === "string" &&
  failureCategories.has(value as FinancialGateEvidence["failureCategory"])

const isObserved = (value: unknown): value is FinancialGateEvidence["observed"] =>
  value === "PASS" || value === "FAIL"

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string")

const isEvidenceClassArray = (value: unknown): value is readonly EvidenceClass[] =>
  Array.isArray(value) && value.length > 0 && value.every(isEvidenceClass)

const isFinancialGateEvidence = (value: unknown): value is FinancialGateEvidence => {
  if (!isRecord(value)) return false
  return [
    typeof value.id === "string",
    typeof value.title === "string",
    isObserved(value.observed),
    isEvidenceClass(value.evidenceClass),
    isEvidenceClassArray(value.acceptedEvidenceClasses),
    isStringArray(value.evidence),
    typeof value.reason === "string",
    isFailureCategory(value.failureCategory),
    typeof value.requiredEvidence === "string",
    typeof value.remediation === "string",
  ].every(Boolean)
}

const isSummary = (value: unknown): value is FinancialManifest["summary"] => {
  if (!isRecord(value)) return false
  return ["passed", "failed", "total"].every((key) => typeof value[key] === "number")
}

const isManifest = (value: unknown): value is FinancialManifest => {
  if (!isRecord(value)) return false
  return (
    typeof value.schemaVersion === "number" &&
    typeof value.reviewedAt === "string" &&
    typeof value.baselineCommit === "string" &&
    isSummary(value.summary) &&
    Array.isArray(value.gates) &&
    value.gates.every(isFinancialGateEvidence)
  )
}

const parseManifest = (value: unknown): FinancialManifest => {
  if (!isManifest(value)) throw new Error("Evidence manifest fields are invalid.")
  if (value.schemaVersion !== 1 || value.baselineCommit !== "056828250526") {
    throw new Error("Evidence manifest schema or baseline commit is invalid.")
  }
  return value
}

const indexGates = (manifest: FinancialManifest): Map<string, FinancialGateEvidence> => {
  const gatesById = new Map(manifest.gates.map((gate) => [gate.id, gate]))
  const missingIds = requiredFinancialGateIds.filter((id) => !gatesById.has(id))
  const duplicateIds = manifest.gates
    .map((gate) => gate.id)
    .filter((id, index, ids) => ids.indexOf(id) !== index)

  if (
    missingIds.length > 0 ||
    duplicateIds.length > 0 ||
    manifest.gates.length !== requiredFinancialGateIds.length
  ) {
    throw new Error(
      `Evidence manifest must contain exactly 16 unique gates; missing=${
        missingIds.join(",") || "none"
      }, duplicates=${duplicateIds.join(",") || "none"}.`,
    )
  }
  return gatesById
}

const evaluateGates = (gatesById: ReadonlyMap<string, FinancialGateEvidence>) =>
  requiredFinancialGateIds.map((id) => {
    const gate = gatesById.get(id)!
    return {
      gate,
      passes: gate.observed === "PASS" && gate.acceptedEvidenceClasses.includes(gate.evidenceClass),
    }
  })

const validateSummary = (manifest: FinancialManifest, passed: number, failed: number) => {
  if (
    manifest.summary.passed !== passed ||
    manifest.summary.failed !== failed ||
    manifest.summary.total !== requiredFinancialGateIds.length
  ) {
    throw new Error(
      `Manifest summary is stale; expected passed=${passed}, failed=${failed}, ` +
        `total=${requiredFinancialGateIds.length}.`,
    )
  }
}

export const evaluateFinancialManifest = (value: unknown): FinancialEvaluation => {
  const manifest = parseManifest(value)
  const gates = evaluateGates(indexGates(manifest))
  const failed = gates.filter(({ passes }) => !passes).length
  const passed = gates.length - failed
  validateSummary(manifest, passed, failed)
  return { manifest, gates, passed, failed }
}

if (isMain(import.meta.url)) {
  const manifestPath =
    process.argv.slice(2)[0] ?? "docs/operations/financial-readiness-evidence-2026-08-18.json"
  const failClosed = (message: string): never => {
    console.error(message)
    console.error("NO-GO — PostgreSQL remains the default financial engine.")
    process.exit(1)
  }

  let evaluation: FinancialEvaluation
  try {
    evaluation = evaluateFinancialManifest(JSON.parse(await readFile(manifestPath, "utf8")))
  } catch (error) {
    failClosed(`Unable to validate evidence manifest ${manifestPath}: ${String(error)}`)
  }

  for (const { gate, passes } of evaluation!.gates) {
    console.log(
      `${passes ? "PASS" : "FAIL"} ${gate.id} ` +
        `[observed=${gate.observed}, evidence=${gate.evidenceClass}, accepted=${gate.acceptedEvidenceClasses.join(
          "|",
        )}] ${gate.title}`,
    )
    console.log(`  ${gate.reason}`)
    if (!passes) {
      console.log(`  required: ${gate.requiredEvidence}`)
      console.log(`  remediation: ${gate.remediation}`)
    }
  }

  console.log(
    `SUMMARY ${evaluation!.passed} PASS / ${evaluation!.failed} FAIL / ${
      evaluation!.gates.length
    } TOTAL`,
  )
  if (evaluation!.failed > 0) {
    failClosed(`${evaluation!.failed} final production-readiness gate(s) remain unresolved.`)
  }
  console.log("GO — TigerBeetle is approved for controlled production activation.")
}
