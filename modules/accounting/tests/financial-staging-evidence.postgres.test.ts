import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import { Database } from "../../../foundation/database/mod.ts"
import { uuidv7 } from "../../../foundation/ids/mod.ts"
import { makePostgresDatabase, runMigrations } from "../../../platform/mod.ts"
import { withTemporaryDatabase } from "../../../tests/support/postgres-database.ts"
import { FinancialStagingEvidenceInvalid } from "../mod.ts"
import {
  FINANCIAL_STAGING_EVIDENCE_CANONICALIZATION_VERSION,
  hashFinancialStagingEvidence,
} from "../mod.ts"
import { makePostgresFinancialStagingEvidenceStore } from "../src/financial-staging-evidence.ts"

const databaseUrl = process.env["DATABASE_URL"]

it.effect.skipIf(databaseUrl === undefined)(
  "protects append-only staging evidence and verifies persisted reads",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const database = makePostgresDatabase(client)
        const [tenant] = yield* Effect.promise(
          () =>
            client<{ id: string }[]>`
            insert into auth.tenants (slug) values (${`staging-evidence-${uuidv7()}`}) returning id
          `,
        )
        const [party] = yield* Effect.promise(
          () =>
            client<{ id: string }[]>`
            insert into party.parties (tenant_id, kind, name)
            values (${tenant!.id}, 'organization', 'Staging Evidence Test') returning id
          `,
        )
        const [legalEntity] = yield* Effect.promise(
          () =>
            client<{ id: string }[]>`
            insert into party.legal_entities (tenant_id, organization_party_id)
            values (${tenant!.id}, ${party!.id}) returning id
          `,
        )
        const store = yield* makePostgresFinancialStagingEvidenceStore.pipe(
          Effect.provideService(Database, database),
        )
        const evidence = {
          recordId: uuidv7(),
          schemaVersion: 1,
          gateId: "projection_rebuild",
          cohort: {
            cohortId: "cohort-postgres",
            tenantId: tenant!.id,
            legalEntityId: legalEntity!.id,
            ownerPrincipalId: "owner",
            approvalAuthorityRef: "approval-role",
            abortAuthorityRef: "abort-role",
            deploymentRevision: "revision-1",
            plannedScenarioIds: [],
            maxOperationCount: 1,
          },
          tenantId: tenant!.id,
          legalEntityId: legalEntity!.id,
          operatorPrincipalId: "operator",
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
        const evidenceHash = yield* hashFinancialStagingEvidence(evidence)
        const appended = yield* store.append({
          tenantId: tenant!.id,
          evidence,
          canonicalizationVersion: FINANCIAL_STAGING_EVIDENCE_CANONICALIZATION_VERSION,
          evidenceHash,
        })
        assert.deepStrictEqual(yield* store.get(tenant!.id, evidence.recordId), appended.record)

        const mutationFailure = yield* Effect.tryPromise({
          try: () =>
            client`
              update accounting.financial_staging_evidence
              set evidence_hash = ${"0".repeat(64)}
              where tenant_id = ${tenant!.id} and record_id = ${evidence.recordId}
            `,
          catch: (cause) => cause,
        }).pipe(Effect.flip)
        assert.ok(mutationFailure)

        const corruptRecordId = uuidv7()
        const corruptEvidence = { ...evidence, recordId: corruptRecordId }
        yield* Effect.promise(
          () =>
            client`
            insert into accounting.financial_staging_evidence (
              record_id, tenant_id, legal_entity_id, gate_id, cohort_id, deployment_revision,
              schema_version, canonicalization_version, evidence_hash, evidence,
              operator_principal_id, provider_identity_ref, result, mismatch_count, orphan_count,
              started_at, completed_at
            ) values (
              ${corruptRecordId}, ${tenant!.id}, ${legalEntity!.id}, ${corruptEvidence.gateId},
              ${corruptEvidence.cohort.cohortId}, ${corruptEvidence.deploymentRevision},
              1, ${FINANCIAL_STAGING_EVIDENCE_CANONICALIZATION_VERSION}, ${"0".repeat(64)},
              ${JSON.stringify(corruptEvidence)}::jsonb, ${corruptEvidence.operatorPrincipalId},
              ${corruptEvidence.providerIdentityRef}, 'pass', 0, 0,
              ${corruptEvidence.startedAt}, ${corruptEvidence.completedAt}
            )
          `,
        )
        const corrupt = yield* Effect.flip(store.get(tenant!.id, corruptRecordId))
        assert.instanceOf(corrupt, FinancialStagingEvidenceInvalid)
        assert.strictEqual((corrupt as FinancialStagingEvidenceInvalid).reason, "hash_mismatch")
      }),
    ),
)
