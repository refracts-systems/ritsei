import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { AuthorizationDenied, makeAuthorizationTestLayer } from "../../authorization/mod.ts"
import { makeMessagingTestLayer } from "../../messaging/mod.ts"
import { SalesService } from "../../sales/mod.ts"
import {
  AccountingCapabilities,
  AccountingService,
  FinancialStagingEvidenceInvalid,
  makeAccountingTestLayer,
} from "../mod.ts"
import { hashFinancialStagingEvidence } from "../mod.ts"

const principal = { userAccountId: "staging-operator", sessionId: "staging-session" }
const tenantId = "00000000-0000-4000-8000-000000000001"
const legalEntityId = "00000000-0000-4000-8000-000000000002"
const evidence = {
  recordId: "00000000-0000-7000-8000-000000000003",
  schemaVersion: 1,
  gateId: "projection_rebuild",
  cohort: {
    cohortId: "cohort-1",
    tenantId,
    legalEntityId,
    ownerPrincipalId: "owner",
    approvalAuthorityRef: "approval-role",
    abortAuthorityRef: "abort-role",
    deploymentRevision: "revision-1",
    plannedScenarioIds: [],
    maxOperationCount: 10,
  },
  tenantId,
  legalEntityId,
  operatorPrincipalId: principal.userAccountId,
  deploymentRevision: "revision-1",
  providerIdentityRef: "tigerbeetle:staging",
  endpointRefs: [],
  failureScenarioIds: [],
  operationIds: [],
  transferIds: [],
  leaseGenerations: [],
  watermarks: [],
  backupRestore: [],
  metrics: [],
  alerts: [],
  startedAt: "2026-08-30T00:00:00.000Z",
  completedAt: "2026-08-30T00:01:00.000Z",
  result: "pass" as const,
  mismatchCount: 0,
  orphanCount: 0,
}

const layer = makeAccountingTestLayer().pipe(
  Layer.provide(
    Layer.mergeAll(
      makeAuthorizationTestLayer([
        {
          userAccountId: principal.userAccountId,
          tenantId,
          capability: AccountingCapabilities.legalEntityConfigure,
        },
        {
          userAccountId: principal.userAccountId,
          tenantId,
          capability: AccountingCapabilities.financialEvidenceRecord,
        },
        {
          userAccountId: principal.userAccountId,
          tenantId,
          capability: AccountingCapabilities.financialEvidenceRead,
        },
      ]),
      makeMessagingTestLayer(),
      Layer.succeed(SalesService, {} as SalesService),
    ),
  ),
)

const deniedLayer = makeAccountingTestLayer().pipe(
  Layer.provide(
    Layer.mergeAll(
      makeAuthorizationTestLayer([]),
      makeMessagingTestLayer(),
      Layer.succeed(SalesService, {} as SalesService),
    ),
  ),
)

it.effect("denies staging evidence lookup without its read capability", () =>
  Effect.gen(function* () {
    const accounting = yield* AccountingService
    const denied = yield* Effect.flip(
      accounting.listFinancialStagingEvidence({
        principal,
        tenantId,
        gateId: "projection_rebuild",
        limit: 10,
      }),
    )
    assert.instanceOf(denied, AuthorizationDenied)
  }).pipe(Effect.provide(deniedLayer)),
)

it.effect("records staging evidence through the authorized Accounting contract", () =>
  Effect.gen(function* () {
    const accounting = yield* AccountingService
    yield* accounting.configureLegalEntity({
      principal,
      tenantId,
      legalEntityId,
      baseCurrency: "USD",
      precision: 2,
      fiscalYearStartMonth: 1,
      postingEnabled: true,
    })
    const evidenceHash = yield* hashFinancialStagingEvidence(evidence)
    const input = {
      principal,
      tenantId,
      evidence,
      canonicalizationVersion: 1 as const,
      evidenceHash,
    }
    const first = yield* accounting.recordFinancialStagingEvidence(input)
    const replay = yield* accounting.recordFinancialStagingEvidence(input)
    assert.strictEqual(first.recordId, evidence.recordId)
    assert.deepStrictEqual(replay, first)
    assert.lengthOf(
      yield* accounting.listFinancialStagingEvidence({
        principal,
        tenantId,
        gateId: evidence.gateId,
        limit: 10,
      }),
      1,
    )

    const invalid = yield* Effect.flip(
      accounting.recordFinancialStagingEvidence({ ...input, evidenceHash: "0".repeat(64) }),
    )
    assert.instanceOf(invalid, FinancialStagingEvidenceInvalid)

    const mismatchedEvidence = { ...evidence, operatorPrincipalId: "different-operator" }
    const mismatchedHash = yield* hashFinancialStagingEvidence(mismatchedEvidence)
    const operatorFailure = yield* Effect.flip(
      accounting.recordFinancialStagingEvidence({
        ...input,
        evidence: mismatchedEvidence,
        evidenceHash: mismatchedHash,
      }),
    )
    assert.instanceOf(operatorFailure, FinancialStagingEvidenceInvalid)
    assert.strictEqual(
      (operatorFailure as FinancialStagingEvidenceInvalid).reason,
      "operator_mismatch",
    )
  }).pipe(Effect.provide(layer)),
)
