import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  compareFinancialStoreInventories,
  FinancialBackupRestoreEvidence,
  FinancialStagingEvidence,
  FinancialStagingTelemetryInput,
  FinancialStagingTelemetrySnapshot,
  FinancialStoreObservationFailure,
  hashFinancialStagingEvidence,
  hashFinancialStoreWatermarks,
  financialStoreObservationRegistry,
} from "../mod.ts"

const watermark = (authority: "postgresql" | "tigerbeetle", value: string) => ({
  authority,
  scope:
    authority === "postgresql"
      ? "tenant:00000000-0000-7000-8000-000000000001/legal-entity:00000000-0000-7000-8000-000000000002"
      : "provider:tigerbeetle",
  value,
  snapshotRef: `sha256:${value}`,
  consistency: "bounded" as const,
  capturedAt: "2026-08-30T00:00:00.000Z",
})

describe("financial readiness contracts", () => {
  it.effect("routes observations by authority and hashes both boundaries", () =>
    Effect.gen(function* () {
      const source = watermark("postgresql", "source")
      const target = watermark("tigerbeetle", "target")
      const registry = financialStoreObservationRegistry([
        {
          authority: "postgresql",
          collector: { collect: () => Effect.succeed(source) },
          scanner: {
            scan: () =>
              Effect.succeed({
                authority: "postgresql" as const,
                scope: source.scope,
                watermark: source,
                accounts: [],
                transfers: [],
              }),
          },
        },
        {
          authority: "tigerbeetle",
          collector: { collect: () => Effect.succeed(target) },
          scanner: {
            scan: () =>
              Effect.succeed({
                authority: "tigerbeetle" as const,
                scope: target.scope,
                watermark: target,
                accounts: [],
                transfers: [],
              }),
          },
        },
      ])

      assert.deepStrictEqual(
        yield* registry.collect("postgresql", { scope: source.scope, maxRecords: 1 }),
        source,
      )
      assert.deepStrictEqual(
        yield* registry.collect("tigerbeetle", { scope: target.scope, maxRecords: 1 }),
        target,
      )
      const missingRegistry = financialStoreObservationRegistry([
        {
          authority: "postgresql",
          collector: { collect: () => Effect.succeed(source) },
          scanner: {
            scan: () =>
              Effect.succeed({
                authority: "postgresql" as const,
                scope: source.scope,
                watermark: source,
                accounts: [],
                transfers: [],
              }),
          },
        },
      ])
      const missing = yield* Effect.flip(
        missingRegistry.collect("tigerbeetle", { scope: "missing", maxRecords: 1 }),
      )
      assert.instanceOf(missing, FinancialStoreObservationFailure)
      assert.strictEqual(missing.reason, "unsupported")

      const firstHash = yield* hashFinancialStoreWatermarks(source, target)
      const secondHash = yield* hashFinancialStoreWatermarks(source, target)
      assert.strictEqual(firstHash, secondHash)
      assert.notStrictEqual(firstHash, yield* hashFinancialStoreWatermarks(target, source))

      const inventory = {
        authority: "tigerbeetle" as const,
        scope: target.scope,
        watermark: target,
        accounts: [],
        transfers: [
          {
            transferRef: "transfer-1",
            debitAccountRef: "account-1",
            creditAccountRef: "account-2",
            amountMinor: "1",
            currency: "USD",
            mappingVersion: 1,
            status: "accepted" as const,
            observedAt: "1",
          },
        ],
      }
      const inventoryMismatch = compareFinancialStoreInventories(inventory, {
        ...inventory,
        transfers: [
          ...inventory.transfers,
          {
            ...inventory.transfers[0]!,
            transferRef: "transfer-2",
          },
        ],
      })
      assert.isFalse(inventoryMismatch.ok)
      assert.strictEqual(inventoryMismatch.mismatches[0]!.kind, "unexpected_transfer")

      const evidence = {
        recordId: "00000000-0000-7000-8000-000000000003",
        schemaVersion: 1,
        gateId: "global_reconciliation",
        cohort: {
          cohortId: "cohort-1",
          tenantId: "00000000-0000-7000-8000-000000000001",
          legalEntityId: "00000000-0000-7000-8000-000000000002",
          ownerPrincipalId: "owner",
          approvalAuthorityRef: "approval-role",
          abortAuthorityRef: "abort-role",
          deploymentRevision: "revision",
          plannedScenarioIds: [],
          maxOperationCount: 1,
        },
        tenantId: "00000000-0000-7000-8000-000000000001",
        legalEntityId: "00000000-0000-7000-8000-000000000002",
        operatorPrincipalId: "operator",
        deploymentRevision: "revision",
        providerIdentityRef: "tigerbeetle:staging",
        endpointRefs: [],
        failureScenarioIds: [],
        operationIds: [],
        transferIds: [],
        leaseGenerations: [],
        watermarks: [source, target],
        backupRestore: [],
        metrics: [],
        alerts: [],
        startedAt: "2026-08-30T00:00:00.000Z",
        completedAt: "2026-08-30T00:01:00.000Z",
        result: "pass" as const,
        mismatchCount: 0,
        orphanCount: 0,
      }
      assert.deepStrictEqual(
        yield* Schema.decodeUnknownEffect(FinancialStagingEvidence)(evidence),
        evidence,
      )
      assert.strictEqual(
        yield* hashFinancialStagingEvidence(evidence),
        yield* hashFinancialStagingEvidence({
          ...evidence,
          cohort: {
            ...evidence.cohort,
            abortAuthorityRef: "abort-role",
            approvalAuthorityRef: "approval-role",
          },
          watermarks: [target, source],
        }),
      )
      assert.strictEqual(
        yield* hashFinancialStagingEvidence(evidence),
        yield* hashFinancialStagingEvidence({
          ...evidence,
          cohort: {
            deploymentRevision: "revision",
            abortAuthorityRef: "abort-role",
            approvalAuthorityRef: "approval-role",
            ownerPrincipalId: "owner",
            legalEntityId: evidence.legalEntityId,
            tenantId: evidence.tenantId,
            cohortId: "cohort-1",
            plannedScenarioIds: [],
            maxOperationCount: 1,
          },
        }),
      )
      const backup = {
        authority: "postgresql" as const,
        backupId: "backup-1",
        backupSourceRef: "postgresql/backup-1",
        restoreId: "restore-1",
        restoreTargetRef: "postgresql/restore-1",
        sourceWatermark: source,
        restoredWatermark: { ...source, value: "restored", snapshotRef: "sha256:restored" },
        comparison: "match" as const,
        startedAt: "2026-08-30T00:00:00.000Z",
        completedAt: "2026-08-30T00:01:00.000Z",
      }
      assert.deepStrictEqual(
        yield* Schema.decodeUnknownEffect(FinancialBackupRestoreEvidence)(backup),
        backup,
      )
      const telemetryInput = {
        tenantId: evidence.tenantId,
        legalEntityId: evidence.legalEntityId,
        cohortId: evidence.cohort.cohortId,
        gateId: evidence.gateId,
        deploymentRevision: evidence.deploymentRevision,
      }
      assert.deepStrictEqual(
        yield* Schema.decodeUnknownEffect(FinancialStagingTelemetryInput)(telemetryInput),
        telemetryInput,
      )
      assert.deepStrictEqual(
        yield* Schema.decodeUnknownEffect(FinancialStagingTelemetrySnapshot)({
          metrics: evidence.metrics,
          alerts: evidence.alerts,
        }),
        { metrics: [], alerts: [] },
      )
      const invalidEvidence = yield* Effect.flip(
        Schema.decodeUnknownEffect(FinancialStagingEvidence)({
          ...evidence,
          mismatchCount: 1,
        }),
      )
      assert.strictEqual(invalidEvidence._tag, "SchemaError")
    }),
  )
})
