import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import { FinancialStagingEvidenceConflict, FinancialStagingEvidenceInvalid } from "../mod.ts"
import { FINANCIAL_STAGING_EVIDENCE_CANONICALIZATION_VERSION } from "../mod.ts"
import { hashFinancialStagingEvidence } from "../mod.ts"
import {
  makeMemoryFinancialStagingEvidenceStore,
  verifyFinancialStagingEvidenceRecord,
} from "../src/financial-staging-evidence.ts"

const tenantId = "00000000-0000-7000-8000-000000000001"
const legalEntityId = "00000000-0000-7000-8000-000000000002"

const makeEvidence = (recordId: string, gateId = "projection_rebuild") => ({
  recordId,
  schemaVersion: 1,
  gateId,
  cohort: {
    cohortId: "cohort-1",
    tenantId,
    legalEntityId,
    ownerPrincipalId: "owner",
    approvalAuthorityRef: "approval-role",
    abortAuthorityRef: "abort-role",
    deploymentRevision: "revision-1",
    plannedScenarioIds: ["worker_adapter_restart"],
    maxOperationCount: 10,
  },
  tenantId,
  legalEntityId,
  operatorPrincipalId: "operator",
  deploymentRevision: "revision-1",
  providerIdentityRef: "tigerbeetle:staging",
  endpointRefs: ["staging/tigerbeetle"],
  failureScenarioIds: ["worker_adapter_restart"],
  operationIds: [],
  transferIds: [],
  leaseGenerations: [],
  watermarks: [],
  backupRestore: [],
  metrics: [{ name: "unknown_outcomes", value: 0, unit: "count" }],
  alerts: [],
  startedAt: "2026-08-30T00:00:00.000Z",
  completedAt: "2026-08-30T00:01:00.000Z",
  result: "pass" as const,
  mismatchCount: 0,
  orphanCount: 0,
})

const append = (
  store: ReturnType<typeof makeMemoryFinancialStagingEvidenceStore>,
  evidence: ReturnType<typeof makeEvidence>,
) =>
  Effect.gen(function* () {
    const evidenceHash = yield* hashFinancialStagingEvidence(evidence)
    return yield* store.append({
      tenantId,
      evidence,
      canonicalizationVersion: FINANCIAL_STAGING_EVIDENCE_CANONICALIZATION_VERSION,
      evidenceHash,
    })
  })

describe("financial staging evidence store", () => {
  it.effect("appends once and supports scoped gate, cohort, and deployment lookup", () =>
    Effect.gen(function* () {
      const store = makeMemoryFinancialStagingEvidenceStore()
      const first = yield* append(store, makeEvidence("00000000-0000-7000-8000-000000000003"))
      const second = yield* append(
        store,
        makeEvidence("00000000-0000-7000-8000-000000000004", "global_reconciliation"),
      )

      assert.isFalse(first.duplicate)
      assert.isFalse(second.duplicate)
      assert.deepStrictEqual(
        (yield* store.get(tenantId, first.record.recordId))?.evidence,
        first.record.evidence,
      )
      assert.lengthOf(yield* store.list({ tenantId, gateId: "projection_rebuild", limit: 10 }), 1)
      assert.lengthOf(yield* store.list({ tenantId, cohortId: "cohort-1", limit: 10 }), 2)
      assert.lengthOf(
        yield* store.list({ tenantId, deploymentRevision: "revision-1", limit: 10 }),
        2,
      )
    }),
  )

  it.effect("is idempotent, rejects conflicting content, and verifies reads", () =>
    Effect.gen(function* () {
      const store = makeMemoryFinancialStagingEvidenceStore()
      const evidence = makeEvidence("00000000-0000-7000-8000-000000000005")
      const first = yield* append(store, evidence)
      const duplicate = yield* append(store, evidence)
      assert.isTrue(duplicate.duplicate)

      const conflict = yield* Effect.flip(
        append(store, { ...evidence, gateId: "global_reconciliation" }),
      )
      assert.instanceOf(conflict, FinancialStagingEvidenceConflict)
      assert.strictEqual(conflict.reason, "different_content")

      const invalidHash = yield* Effect.flip(
        store.append({
          tenantId,
          evidence,
          canonicalizationVersion: FINANCIAL_STAGING_EVIDENCE_CANONICALIZATION_VERSION,
          evidenceHash: "0".repeat(64),
        }),
      )
      assert.instanceOf(invalidHash, FinancialStagingEvidenceInvalid)
      assert.strictEqual(invalidHash.reason, "hash_mismatch")

      const tampered = yield* Effect.flip(
        verifyFinancialStagingEvidenceRecord({
          ...first.record,
          evidenceHash: "0".repeat(64),
        }),
      )
      assert.instanceOf(tampered, FinancialStagingEvidenceInvalid)
      assert.strictEqual(tampered.reason, "hash_mismatch")
    }),
  )
})
