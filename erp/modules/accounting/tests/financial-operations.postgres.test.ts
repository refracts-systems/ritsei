import { assert, it } from "@effect/vitest"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import {
  Database,
  DatabaseFailure,
  type DatabaseService,
  DurableJobEnqueuer,
  FencingContextService,
  uuidv7,
} from "../../../../framework/foundation/mod.ts"
import { makePostgresDatabase, runMigrations } from "../../../../framework/platform/mod.ts"
import { LARGE_FINANCIAL_MAJOR } from "../../../../tests/support/financial-ledger-conformance.ts"
import { withTemporaryDatabase } from "../../../../tests/support/postgres-database.ts"
import { makeAuthorizationTestLayer } from "../../../../framework/modules/authorization/mod.ts"
import {
  EventIdempotencyConflict,
  makeMessagingService,
  MessagingService,
} from "../../../../framework/modules/messaging/mod.ts"
import { makeProcessJobEnqueuer } from "../../process/mod.ts"
import { SalesService } from "../../sales/mod.ts"
import {
  AccountingCapabilities,
  AccountingFinancialOperationReconciledEvent,
  FinancialLedgerPort,
  type FinancialOperationFailpointNameType,
  FinancialOperationFailpointService,
  FinancialOperationFenceRejected,
  FinancialOperationInjectedFailure,
  FinancialOperationsPending,
  FinancialProjectionRebuildBlocked,
  FinancialReconciliationCheckpointConflict,
  FinancialReversalAlreadyExists,
  makeAccountingService,
  makeFinancialLedgerTestLayer,
  makeFinancialOperationFailpointLayer,
  makeFinancialOperationService,
} from "../mod.ts"
import {
  type FinancialStoreInventoryType,
  FinancialStoreObservationFailure,
  FinancialStoreObservationRegistry,
  type FinancialStoreWatermarkType,
  hashFinancialStoreWatermarks,
} from "../mod.ts"
import { partial } from "../../../../tests/support/partial.ts"
import { postgresConstraint } from "../../../../tests/support/postgres-error.ts"

const databaseUrl = process.env["DATABASE_URL"]
const postgresFailure = <A>(effect: () => Promise<A>) =>
  Effect.tryPromise({ try: effect, catch: (cause) => cause }).pipe(Effect.flip)

const failDatabaseOnceAt = (database: DatabaseService, operationName: string): DatabaseService => {
  let failed = false
  const shouldFail = (name: string | undefined) => !failed && name === operationName
  const failure = (name: string | undefined) => {
    failed = true
    return Effect.fail(new DatabaseFailure({ operation: name ?? operationName, cause: "injected" }))
  }
  // SAFETY: the double implements the database members this test calls.
  return {
    query: (operation, name) =>
      shouldFail(name) ? failure(name) : database.query(operation, name),
    transaction: (operation, name) =>
      shouldFail(name) ? failure(name) : database.transaction(operation, name),
    withTransaction: (operation, name) =>
      shouldFail(name) ? failure(name) : database.withTransaction(operation, name),
  } as DatabaseService
}

it.effect.skipIf(databaseUrl === undefined)(
  "persists a financial intent, submits it once, and projects the receipt",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const database = makePostgresDatabase(client)
        const [tenant] = yield* Effect.promise(
          () =>
            client<{ id: string }[]>`
              insert into auth.tenants (slug) values (${uuidv7()}) returning id
            `,
        )
        const [organization] = yield* Effect.promise(
          () =>
            client<{ id: string }[]>`
              insert into party.parties (tenant_id, kind, name)
              values (${
                tenant!.id
              }, 'organization', 'Financial Operation Organization') returning id
            `,
        )
        const [legalEntity] = yield* Effect.promise(
          () =>
            client<{ id: string }[]>`
              insert into party.legal_entities (tenant_id, organization_party_id)
              values (${tenant!.id}, ${organization!.id}) returning id
            `,
        )
        yield* Effect.promise(
          () =>
            client`
              insert into accounting.legal_entity_accounting_configurations
                (tenant_id, legal_entity_id, base_currency, decimal_precision,
                 fiscal_year_start_month, posting_enabled, financial_engine)
              values (${tenant!.id}, ${legalEntity!.id}, 'USD', 2, 1, true, 'tigerbeetle')
            `,
        )
        yield* Effect.promise(
          () =>
            client`
              update accounting.financial_cutover_controls
              set status = 'preparing_tigerbeetle'
              where tenant_id = ${tenant!.id} and legal_entity_id = ${legalEntity!.id}
            `,
        )
        const [evidenceArtifact] = yield* Effect.promise(
          () =>
            client<{ id: string }[]>`
              insert into accounting.financial_verification_artifacts (
                tenant_id, legal_entity_id, kind, status, completeness, scope,
                schema_version, mapping_version, currency, source_watermark, target_watermark,
                source_snapshot_ref, target_snapshot_ref, artifact_hash, signature_algorithm,
                signing_key_id, signature, operation_set_hash, account_balance_hash,
                transfer_set_hash, source_debit_minor, source_credit_minor, target_debit_minor,
                target_credit_minor, account_count, operation_count, transfer_count,
                mismatch_count, producer_principal_id, started_at, completed_at
              ) values (
                ${tenant!.id}, ${
                  legalEntity!.id
                }, 'cutover_rehearsal', 'verified', 'bounded', 'test',
                1, 1, 'USD', 'test-watermark', 'test-watermark', 'test-source', 'test-target',
                repeat('0', 64), 'Ed25519', 'test-key', 'test-signature', repeat('0', 64),
                repeat('1', 64), repeat('2', 64), '0', '0', '0', '0', 0, 0, 0, 0,
                'test-operator', now(), now()
              ) returning id
            `,
        )
        const blankApproval = yield* Effect.flip(
          Effect.tryPromise({
            try: () =>
              client`
              update accounting.financial_cutover_controls
              set status = 'approved', cutover_watermark = ' ',
                verification_hash = 'test-hash', opening_balance_verified = true,
                historical_boundary_verified = true, reconciliation_healthy = true,
                backup_recovery_verified = true, evidence_artifact_id = ${evidenceArtifact!.id},
                approved_by = 'test-operator', approved_at = now()
              where tenant_id = ${tenant!.id} and legal_entity_id = ${legalEntity!.id}
            `,
            catch: (cause) => cause,
          }),
        )
        assert.strictEqual(
          postgresConstraint(blankApproval),
          "financial_cutover_controls_approval_check",
        )
        yield* Effect.promise(
          () =>
            client`
              update accounting.financial_cutover_controls
              set status = 'approved', cutover_watermark = 'test-watermark',
                verification_hash = 'test-hash', opening_balance_verified = true,
                historical_boundary_verified = true, reconciliation_healthy = true,
                backup_recovery_verified = true, evidence_artifact_id = ${evidenceArtifact!.id},
                approved_by = 'test-operator', approved_at = now()
              where tenant_id = ${tenant!.id} and legal_entity_id = ${legalEntity!.id}
            `,
        )
        yield* Effect.promise(
          () =>
            client`
              update accounting.financial_cutover_controls
              set status = 'activating'
              where tenant_id = ${tenant!.id} and legal_entity_id = ${legalEntity!.id}
            `,
        )
        yield* Effect.promise(
          () =>
            client`
              update accounting.legal_entity_accounting_configurations
              set financial_engine = 'tigerbeetle'
              where tenant_id = ${tenant!.id} and legal_entity_id = ${legalEntity!.id}
            `,
        )
        const blankActivation = yield* Effect.flip(
          Effect.tryPromise({
            try: () =>
              client`
              update accounting.financial_cutover_controls
              set status = 'tigerbeetle', activated_by = ' ', activated_at = now()
              where tenant_id = ${tenant!.id} and legal_entity_id = ${legalEntity!.id}
            `,
            catch: (cause) => cause,
          }),
        )
        assert.strictEqual(
          postgresConstraint(blankActivation),
          "financial_cutover_controls_activation_check",
        )
        yield* Effect.promise(
          () =>
            client`
              update accounting.financial_cutover_controls
              set status = 'tigerbeetle', activated_by = 'test-operator', activated_at = now()
              where tenant_id = ${tenant!.id} and legal_entity_id = ${legalEntity!.id}
            `,
        )
        yield* Effect.promise(
          () =>
            client`
              insert into accounting.accounting_periods
                (tenant_id, legal_entity_id, starts_on, ends_on, status)
              values (${tenant!.id}, ${legalEntity!.id}, '1900-01-01', '2100-12-31', 'open')
            `,
        )
        const [debitAccount] = yield* Effect.promise(
          () =>
            client<{ id: string }[]>`
              insert into accounting.accounts (tenant_id, code, name, type)
              values (${tenant!.id}, '1000', 'Cash', 'asset') returning id
            `,
        )
        const [creditAccount] = yield* Effect.promise(
          () =>
            client<{ id: string }[]>`
              insert into accounting.accounts (tenant_id, code, name, type)
              values (${tenant!.id}, '4000', 'Revenue', 'revenue') returning id
            `,
        )

        yield* Effect.promise(
          () =>
            client`
              insert into accounting.revenue_posting_profiles
                (tenant_id, legal_entity_id, receivable_account_id, revenue_account_id)
              values (${tenant!.id}, ${legalEntity!.id}, ${debitAccount!.id}, ${creditAccount!.id})
            `,
        )
        const principal = {
          userAccountId: uuidv7(),
          sessionId: uuidv7(),
        }
        const authorization = makeAuthorizationTestLayer([
          {
            userAccountId: principal.userAccountId,
            tenantId: tenant!.id,
            capability: AccountingCapabilities.journalPost,
          },
          {
            userAccountId: principal.userAccountId,
            tenantId: tenant!.id,
            capability: AccountingCapabilities.revenuePost,
          },
          {
            userAccountId: principal.userAccountId,
            tenantId: tenant!.id,
            capability: AccountingCapabilities.periodClose,
          },
          {
            userAccountId: principal.userAccountId,
            tenantId: tenant!.id,
            capability: AccountingCapabilities.financialProjectionRebuild,
          },
          {
            userAccountId: principal.userAccountId,
            tenantId: tenant!.id,
            capability: AccountingCapabilities.financialReconciliationCheckpoint,
          },
        ])
        const messaging = yield* makeMessagingService.pipe(
          Effect.provideService(Database, database),
        )
        const jobs = yield* makeProcessJobEnqueuer.pipe(Effect.provideService(Database, database))
        const ledger = yield* Effect.provide(
          Effect.service(FinancialLedgerPort),
          makeFinancialLedgerTestLayer(),
        )
        const sales = partial<SalesService>({
          getConfirmedOrderTotal: () => Effect.succeed(LARGE_FINANCIAL_MAJOR),
        })
        const observationScope = `tenant:${tenant!.id}/legal-entity:${legalEntity!.id}`
        const observedSourceWatermark = {
          authority: "postgresql" as const,
          scope: observationScope,
          value: "postgres:test-watermark",
          snapshotRef: "postgres:test-snapshot",
          consistency: "bounded" as const,
          capturedAt: "2026-08-30T00:00:00.000Z",
        } satisfies FinancialStoreWatermarkType
        const observedTargetWatermark = {
          authority: "tigerbeetle" as const,
          scope: "provider:tigerbeetle",
          value: "tigerbeetle:test-watermark",
          snapshotRef: "tigerbeetle:test-snapshot",
          consistency: "bounded" as const,
          capturedAt: "2026-08-30T00:00:00.000Z",
        } satisfies FinancialStoreWatermarkType
        const observationRecoveryWatermark = `observation:${yield* hashFinancialStoreWatermarks(
          observedSourceWatermark,
          observedTargetWatermark,
        )}`
        const makeObservationRegistry = (
          sourceWatermark: FinancialStoreWatermarkType,
          targetWatermark: FinancialStoreWatermarkType,
        ) =>
          Layer.succeed(FinancialStoreObservationRegistry, {
            collect: (authority) =>
              Effect.succeed(authority === "postgresql" ? sourceWatermark : targetWatermark),
            scan: (authority, input) => {
              // SAFETY: the test calls this double only with inputs of the shape it reads.
              const request = input as {
                readonly scope: string
                readonly watermark: FinancialStoreWatermarkType
              }
              return Effect.succeed({
                authority,
                scope: request.scope,
                watermark: request.watermark,
                accounts: [],
                transfers: [],
              } satisfies FinancialStoreInventoryType)
            },
          })
        const observationRegistry = makeObservationRegistry(
          observedSourceWatermark,
          observedTargetWatermark,
        )
        const service = yield* Effect.provide(
          makeFinancialOperationService,
          Layer.mergeAll(
            Layer.succeed(Database, database),
            authorization,
            Layer.succeed(MessagingService, messaging),
            Layer.succeed(DurableJobEnqueuer, jobs),
            Layer.succeed(SalesService, sales),
            Layer.succeed(FinancialLedgerPort, ledger),
            observationRegistry,
          ),
        )
        const unobservedService = yield* Effect.provide(
          makeFinancialOperationService,
          Layer.mergeAll(
            Layer.succeed(Database, database),
            authorization,
            Layer.succeed(MessagingService, messaging),
            Layer.succeed(DurableJobEnqueuer, jobs),
            Layer.succeed(SalesService, sales),
            Layer.succeed(FinancialLedgerPort, ledger),
          ),
        )
        const unobservedFailure = yield* Effect.flip(
          unobservedService.reconcileFinancialCheckpoint({
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity!.id,
            recoveryWatermark: "caller-supplied",
            sourceWatermark: "caller-source",
            targetWatermark: "caller-target",
            sourceSnapshotRef: "caller-source-snapshot",
            targetSnapshotRef: "caller-target-snapshot",
            evidenceArtifactId: null,
          }),
        )
        assert.instanceOf(unobservedFailure, FinancialStoreObservationFailure)
        assert.strictEqual(unobservedFailure.reason, "unavailable")

        const revenueMismatch = yield* Effect.flip(
          service.createRevenueIntent({
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity!.id,
            orderId: uuidv7(),
            commandId: `revenue-mismatch-${uuidv7()}`,
            correlationId: `revenue-mismatch-correlation-${uuidv7()}`,
            currency: "USD",
            mappingVersion: 1,
            amount: "6.50",
          }),
        )
        assert.strictEqual(revenueMismatch._tag, "FinancialRevenueAmountMismatch")

        const revenue = yield* service.createRevenueIntent({
          principal,
          tenantId: tenant!.id,
          legalEntityId: legalEntity!.id,
          orderId: uuidv7(),
          commandId: `revenue-${uuidv7()}`,
          correlationId: `revenue-correlation-${uuidv7()}`,
          currency: "USD",
          mappingVersion: 1,
        })
        assert.strictEqual(revenue.status, "intent")
        yield* Effect.promise(
          () =>
            client`
              update accounting.financial_operations
              set accepted_fence_generation = 2
              where tenant_id = ${tenant!.id} and operation_id = ${revenue.operationId}
            `,
        )
        const staleFence = yield* Effect.flip(
          service
            .submitFinancialOperation({
              tenantId: tenant!.id,
              operationId: revenue.operationId,
            })
            .pipe(
              Effect.provideService(FencingContextService, {
                scope: `accounting.financial_operation:${tenant!.id}:${revenue.operationId}`,
                generation: "1",
              }),
            ),
        )
        assert.instanceOf(staleFence, FinancialOperationFenceRejected)

        const postedRevenue = yield* service.submitFinancialOperation({
          tenantId: tenant!.id,
          operationId: revenue.operationId,
        })
        assert.strictEqual(postedRevenue.status, "reconciled")
        const [reconciledEvent] = yield* Effect.promise(
          () =>
            client<
              {
                operation_id: string
                journal_id: string
                mapping_version: number
                reconciled_event_id: string
                event_id: string
                aggregate_id: string
                payload: unknown
                command_id: string
                correlation_id: string
                causation_id: string
                idempotency_key: string
              }[]
            >`
              select f.operation_id, f.journal_id, f.mapping_version,
                f.reconciled_event_id, e.id as event_id, e.aggregate_id, e.payload,
                e.command_id, e.correlation_id, e.causation_id, e.idempotency_key
              from messaging.event_outbox e
              join accounting.financial_operations f
                on f.tenant_id = e.tenant_id and f.reconciled_event_id = e.id
              where e.tenant_id = ${tenant!.id} and f.id = ${revenue.id}
            `,
        )
        assert.isDefined(reconciledEvent)
        const eventPayload = yield* Schema.decodeUnknownEffect(
          AccountingFinancialOperationReconciledEvent.payloadSchema,
        )(reconciledEvent!.payload)
        assert.strictEqual(eventPayload.operationId, reconciledEvent!.operation_id)
        assert.strictEqual(eventPayload.journalId, reconciledEvent!.journal_id)
        assert.strictEqual(eventPayload.mappingVersion, reconciledEvent!.mapping_version)
        assert.strictEqual(reconciledEvent!.event_id, reconciledEvent!.reconciled_event_id)
        assert.notStrictEqual(reconciledEvent!.event_id, revenue.id)
        assert.strictEqual(reconciledEvent!.aggregate_id, revenue.id)
        assert.notStrictEqual(reconciledEvent!.event_id, reconciledEvent!.aggregate_id)
        assert.notStrictEqual(reconciledEvent?.command_id, reconciledEvent?.correlation_id)
        assert.notStrictEqual(reconciledEvent?.command_id, reconciledEvent?.causation_id)
        assert.notStrictEqual(reconciledEvent?.command_id, reconciledEvent?.idempotency_key)
        assert.notStrictEqual(reconciledEvent?.correlation_id, reconciledEvent?.causation_id)
        assert.notStrictEqual(reconciledEvent?.correlation_id, reconciledEvent?.idempotency_key)
        assert.notStrictEqual(reconciledEvent?.causation_id, reconciledEvent?.idempotency_key)

        yield* Effect.promise(
          () =>
            client`
              delete from accounting.financial_operation_transfers
              where tenant_id = ${tenant!.id} and operation_id = ${revenue.id}
            `,
        )
        const reconciledEventId = reconciledEvent!.event_id
        yield* Effect.promise(
          () =>
            client`
              delete from messaging.event_outbox
              where tenant_id = ${tenant!.id} and id = ${reconciledEventId}
            `,
        )
        const rebuiltProjection = yield* service.rebuildFinancialProjections({
          principal,
          tenantId: tenant!.id,
          legalEntityId: legalEntity!.id,
        })
        assert.isAtLeast(rebuiltProjection.checkedOperations, 1)
        assert.isAtLeast(rebuiltProjection.rebuiltOperations, 1)
        const rebuiltRevenueTransfers = yield* Effect.promise(
          () =>
            client<{ status: string; engine_transfer_id: string | null }[]>`
              select status, engine_transfer_id
              from accounting.financial_operation_transfers
              where tenant_id = ${tenant!.id} and operation_id = ${revenue.id}
            `,
        )
        assert.strictEqual(rebuiltRevenueTransfers.length, 1)
        assert.strictEqual(rebuiltRevenueTransfers[0]!.status, "accepted")
        assert.isNotNull(rebuiltRevenueTransfers[0]!.engine_transfer_id)
        const [rebuiltReconciledEvent] = yield* Effect.promise(
          () =>
            client<{ id: string; aggregate_id: string }[]>`
              select id, aggregate_id
              from messaging.event_outbox
              where tenant_id = ${tenant!.id} and id = ${reconciledEventId}
            `,
        )
        assert.isDefined(rebuiltReconciledEvent)
        assert.strictEqual(rebuiltReconciledEvent!.id, reconciledEventId)
        assert.strictEqual(rebuiltReconciledEvent!.aggregate_id, revenue.id)
        const [beforeFailedRebuild] = yield* Effect.promise(
          () =>
            client<
              {
                status: string
                engine_accepted_at: string | null
                observed_engine: string | null
              }[]
            >`
              select status, engine_accepted_at, observed_engine
              from accounting.financial_operations
              where tenant_id = ${tenant!.id} and id = ${revenue.id}
            `,
        )
        yield* Effect.promise(
          () =>
            client`
              delete from accounting.financial_operation_transfers
              where tenant_id = ${tenant!.id} and operation_id = ${revenue.id}
            `,
        )
        yield* Effect.promise(
          () =>
            client`
              delete from messaging.event_outbox
              where tenant_id = ${tenant!.id} and id = ${reconciledEventId}
            `,
        )
        // SAFETY: the double keeps the real messaging members and replaces only append.
        const failingRebuildMessaging = {
          ...messaging,
          append: (_event: unknown) =>
            Effect.fail(
              new DatabaseFailure({
                operation: "financial-operation.test.rebuild-append",
                cause: null,
              }),
            ),
        } as typeof messaging
        const failingRebuildService = yield* Effect.provide(
          makeFinancialOperationService,
          Layer.mergeAll(
            Layer.succeed(Database, database),
            authorization,
            Layer.succeed(MessagingService, failingRebuildMessaging),
            Layer.succeed(DurableJobEnqueuer, jobs),
            Layer.succeed(SalesService, sales),
            Layer.succeed(FinancialLedgerPort, ledger),
          ),
        )
        const failedRebuild = yield* Effect.flip(
          failingRebuildService.rebuildFinancialProjections({
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity!.id,
          }),
        )
        assert.instanceOf(failedRebuild, DatabaseFailure)
        const [afterFailedRebuild] = yield* Effect.promise(
          () =>
            client<
              {
                status: string
                engine_accepted_at: string | null
                observed_engine: string | null
              }[]
            >`
              select status, engine_accepted_at, observed_engine
              from accounting.financial_operations
              where tenant_id = ${tenant!.id} and id = ${revenue.id}
            `,
        )
        assert.deepStrictEqual(afterFailedRebuild, beforeFailedRebuild)
        const [failedTransfers] = yield* Effect.promise(
          () =>
            client<{ count: number }[]>`
              select count(*)::integer as count
              from accounting.financial_operation_transfers
              where tenant_id = ${tenant!.id} and operation_id = ${revenue.id}
            `,
        )
        assert.strictEqual(failedTransfers!.count, 0)
        const [failedEvents] = yield* Effect.promise(
          () =>
            client<{ count: number }[]>`
              select count(*)::integer as count
              from messaging.event_outbox
              where tenant_id = ${tenant!.id} and id = ${reconciledEventId}
            `,
        )
        assert.strictEqual(failedEvents!.count, 0)
        const retriedRebuild = yield* service.rebuildFinancialProjections({
          principal,
          tenantId: tenant!.id,
          legalEntityId: legalEntity!.id,
        })
        assert.strictEqual(retriedRebuild.rebuiltOperations, 1)
        const [retriedTransfer] = yield* Effect.promise(
          () =>
            client<{ count: number }[]>`
              select count(*)::integer as count
              from accounting.financial_operation_transfers
              where tenant_id = ${tenant!.id} and operation_id = ${revenue.id}
            `,
        )
        assert.strictEqual(retriedTransfer!.count, 1)
        const [retriedEvent] = yield* Effect.promise(
          () =>
            client<{ id: string }[]>`
              select id
              from messaging.event_outbox
              where tenant_id = ${tenant!.id} and id = ${reconciledEventId}
            `,
        )
        assert.strictEqual(retriedEvent!.id, reconciledEventId)

        yield* Effect.promise(
          () =>
            client`
              update messaging.event_outbox
              set payload = jsonb_set(payload, '{mappingVersion}', '2'::jsonb)
              where tenant_id = ${tenant!.id} and id = ${reconciledEventId}
            `,
        )
        const quarantinedProjection = yield* service.rebuildFinancialProjections({
          principal,
          tenantId: tenant!.id,
          legalEntityId: legalEntity!.id,
        })
        assert.strictEqual(quarantinedProjection.rebuiltOperations, 0)
        assert.strictEqual(quarantinedProjection.quarantinedOperations, 1)
        const [quarantinedOperation] = yield* Effect.promise(
          () =>
            client<
              { status: string; recovery_reason: string | null; reconciled_at: Date | null }[]
            >`
              select status, recovery_reason, reconciled_at
              from accounting.financial_operations
              where tenant_id = ${tenant!.id} and id = ${revenue.id}
            `,
        )
        assert.strictEqual(quarantinedOperation!.status, "manual_recovery")
        assert.strictEqual(quarantinedOperation!.recovery_reason, "mapping_mismatch")
        assert.isNull(quarantinedOperation!.reconciled_at)
        const [corruptReconciledEvent] = yield* Effect.promise(
          () =>
            client<{ id: string; payload: unknown }[]>`
              select id, payload
              from messaging.event_outbox
              where tenant_id = ${tenant!.id} and id = ${reconciledEventId}
            `,
        )
        assert.strictEqual(corruptReconciledEvent!.id, reconciledEventId)
        const corruptPayload = yield* Schema.decodeUnknownEffect(
          AccountingFinancialOperationReconciledEvent.payloadSchema,
        )(corruptReconciledEvent!.payload)
        assert.strictEqual(corruptPayload.mappingVersion, 2)

        const submissionIdentityOperationId = `submission-identity-${uuidv7()}`
        const submissionIdentityIntent = yield* service.createJournalIntent({
          principal,
          tenantId: tenant!.id,
          legalEntityId: legalEntity!.id,
          operationId: submissionIdentityOperationId,
          reference: `submission-identity-${uuidv7()}`,
          currency: "USD",
          mappingVersion: 1,
          lines: [
            { accountId: debitAccount!.id, debit: "12.50", credit: "0" },
            { accountId: creditAccount!.id, debit: "0", credit: "12.50" },
          ],
          correlationId: `submission-identity-correlation-${uuidv7()}`,
        })
        const submissionIdentityLedger = {
          ...ledger,
          postJournal: (input: unknown) =>
            ledger
              .postJournal(input)
              .pipe(
                Effect.map((outcome) =>
                  outcome._tag === "accepted" &&
                  outcome.operationId === submissionIdentityOperationId
                    ? { ...outcome, operationId: `foreign-${uuidv7()}` }
                    : outcome,
                ),
              ),
        }
        const submissionIdentityService = yield* Effect.provide(
          makeFinancialOperationService,
          Layer.mergeAll(
            Layer.succeed(Database, database),
            authorization,
            Layer.succeed(MessagingService, messaging),
            Layer.succeed(DurableJobEnqueuer, jobs),
            Layer.succeed(SalesService, sales),
            Layer.succeed(FinancialLedgerPort, submissionIdentityLedger),
          ),
        )
        const submissionIdentityPosted = yield* submissionIdentityService.submitFinancialOperation({
          tenantId: tenant!.id,
          operationId: submissionIdentityIntent.operationId,
        })
        assert.strictEqual(submissionIdentityPosted.status, "manual_recovery")
        const [submissionIdentityTransfer] = yield* Effect.promise(
          () =>
            client<{ status: string }[]>`
              select status
              from accounting.financial_operation_transfers
              where tenant_id = ${tenant!.id} and operation_id = ${submissionIdentityPosted.id}
            `,
        )
        assert.strictEqual(submissionIdentityTransfer!.status, "manual_recovery")
        const [submissionIdentityEvents] = yield* Effect.promise(
          () =>
            client<{ events: number }[]>`
              select count(*)::integer as events
              from messaging.event_outbox
              where tenant_id = ${tenant!.id}
                and event_type = ${AccountingFinancialOperationReconciledEvent.id}
                and payload ->> 'operationId' = ${submissionIdentityOperationId}
            `,
        )
        assert.strictEqual(submissionIdentityEvents!.events, 0)

        const corruptMappingVersionOperationId = `mapping-version-${uuidv7()}`
        const mappingMismatchIntent = yield* service.createJournalIntent({
          principal,
          tenantId: tenant!.id,
          legalEntityId: legalEntity!.id,
          operationId: corruptMappingVersionOperationId,
          reference: `mapping-version-${uuidv7()}`,
          currency: "USD",
          mappingVersion: 1,
          lines: [
            { accountId: debitAccount!.id, debit: "12.50", credit: "0" },
            { accountId: creditAccount!.id, debit: "0", credit: "12.50" },
          ],
          correlationId: `mapping-version-correlation-${uuidv7()}`,
        })
        const mappingMismatchPosted = yield* service.submitFinancialOperation({
          tenantId: tenant!.id,
          operationId: mappingMismatchIntent.operationId,
        })
        assert.strictEqual(mappingMismatchPosted.status, "reconciled")
        const rebuildIdentityOperationId = `rebuild-identity-${uuidv7()}`
        const rebuildIdentityIntent = yield* service.createJournalIntent({
          principal,
          tenantId: tenant!.id,
          legalEntityId: legalEntity!.id,
          operationId: rebuildIdentityOperationId,
          reference: `rebuild-identity-${uuidv7()}`,
          currency: "USD",
          mappingVersion: 1,
          lines: [
            { accountId: debitAccount!.id, debit: "12.50", credit: "0" },
            { accountId: creditAccount!.id, debit: "0", credit: "12.50" },
          ],
          correlationId: `rebuild-identity-correlation-${uuidv7()}`,
        })
        const rebuildIdentityPosted = yield* service.submitFinancialOperation({
          tenantId: tenant!.id,
          operationId: rebuildIdentityIntent.operationId,
        })
        assert.strictEqual(rebuildIdentityPosted.status, "reconciled")
        const mappingMismatchLedger = {
          ...ledger,
          reconcileJournal: (input: unknown) =>
            ledger.reconcileJournal(input).pipe(
              Effect.map((outcome) => {
                if (outcome._tag !== "accepted") return outcome
                if (outcome.operationId === corruptMappingVersionOperationId) {
                  return { ...outcome, mappingVersion: outcome.mappingVersion + 1 }
                }
                if (outcome.operationId === rebuildIdentityOperationId) {
                  return { ...outcome, operationId: `foreign-${uuidv7()}` }
                }
                return outcome
              }),
            ),
        }
        const mappingMismatchService = yield* Effect.provide(
          makeFinancialOperationService,
          Layer.mergeAll(
            Layer.succeed(Database, database),
            authorization,
            Layer.succeed(MessagingService, messaging),
            Layer.succeed(DurableJobEnqueuer, jobs),
            Layer.succeed(SalesService, sales),
            Layer.succeed(FinancialLedgerPort, mappingMismatchLedger),
          ),
        )
        const mappingMismatchProjection = yield* mappingMismatchService.rebuildFinancialProjections(
          {
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity!.id,
          },
        )
        assert.strictEqual(mappingMismatchProjection.rebuiltOperations, 0)
        assert.strictEqual(mappingMismatchProjection.quarantinedOperations, 2)
        const [mappingMismatchOperation] = yield* Effect.promise(
          () =>
            client<{ status: string; recovery_reason: string | null }[]>`
              select status, recovery_reason
              from accounting.financial_operations
              where tenant_id = ${tenant!.id} and operation_id = ${corruptMappingVersionOperationId}
            `,
        )
        assert.strictEqual(mappingMismatchOperation!.status, "manual_recovery")
        assert.strictEqual(mappingMismatchOperation!.recovery_reason, "mapping_mismatch")
        const [rebuildIdentityOperation] = yield* Effect.promise(
          () =>
            client<{ status: string; recovery_reason: string | null }[]>`
              select status, recovery_reason
              from accounting.financial_operations
              where tenant_id = ${tenant!.id} and operation_id = ${rebuildIdentityOperationId}
            `,
        )
        assert.strictEqual(rebuildIdentityOperation!.status, "manual_recovery")
        assert.strictEqual(rebuildIdentityOperation!.recovery_reason, "mapping_mismatch")
        const [mappingMismatchEvents] = yield* Effect.promise(
          () =>
            client<{ events: number }[]>`
              select count(*)::integer as events
              from messaging.event_outbox
              where tenant_id = ${tenant!.id}
                and event_type = ${AccountingFinancialOperationReconciledEvent.id}
                and payload ->> 'operationId' = ${corruptMappingVersionOperationId}
            `,
        )
        assert.strictEqual(mappingMismatchEvents!.events, 1)
        const [rebuildIdentityEvents] = yield* Effect.promise(
          () =>
            client<{ events: number }[]>`
              select count(*)::integer as events
              from messaging.event_outbox
              where tenant_id = ${tenant!.id}
                and event_type = ${AccountingFinancialOperationReconciledEvent.id}
                and payload ->> 'operationId' = ${rebuildIdentityOperationId}
            `,
        )
        assert.strictEqual(rebuildIdentityEvents!.events, 1)

        const revenuePrincipal = {
          userAccountId: uuidv7(),
          sessionId: uuidv7(),
        }
        const revenueOnlyService = yield* Effect.provide(
          makeFinancialOperationService,
          Layer.mergeAll(
            Layer.succeed(Database, database),
            makeAuthorizationTestLayer([
              {
                userAccountId: revenuePrincipal.userAccountId,
                tenantId: tenant!.id,
                capability: AccountingCapabilities.revenuePost,
              },
            ]),
            Layer.succeed(MessagingService, messaging),
            Layer.succeed(DurableJobEnqueuer, jobs),
            Layer.succeed(SalesService, sales),
            Layer.succeed(FinancialLedgerPort, ledger),
          ),
        )
        const revenueOnlyIntent = yield* revenueOnlyService.createRevenueIntent({
          principal: revenuePrincipal,
          tenantId: tenant!.id,
          legalEntityId: legalEntity!.id,
          orderId: uuidv7(),
          commandId: `revenue-only-${uuidv7()}`,
          correlationId: `revenue-only-correlation-${uuidv7()}`,
          currency: "USD",
          mappingVersion: 1,
        })
        const revenueOnlyPosted = yield* revenueOnlyService.submitFinancialOperation({
          tenantId: tenant!.id,
          operationId: revenueOnlyIntent.operationId,
        })
        assert.strictEqual(revenueOnlyPosted.status, "reconciled")

        const lostLedger = makeFinancialLedgerTestLayer({ loseResponseFor: "lost-operation" })
        const lostService = yield* Effect.provide(
          makeFinancialOperationService,
          Layer.mergeAll(
            Layer.succeed(Database, database),
            authorization,
            Layer.succeed(MessagingService, messaging),
            Layer.succeed(DurableJobEnqueuer, jobs),
            Layer.succeed(SalesService, sales),
            lostLedger,
          ),
        )

        const input = {
          principal,
          tenantId: tenant!.id,
          legalEntityId: legalEntity!.id,
          operationId: `operation-${uuidv7()}`,
          reference: `financial-${uuidv7()}`,
          currency: "USD",
          mappingVersion: 1,
          lines: [
            { accountId: debitAccount!.id, debit: "12.50", credit: "0" },
            { accountId: creditAccount!.id, debit: "0", credit: "12.50" },
          ],
          correlationId: ` correlation-${uuidv7()} `,
        }
        const concurrentInput = {
          ...input,
          operationId: `concurrent-${uuidv7()}`,
          reference: `concurrent-${uuidv7()}`,
        }
        const paddedInput = {
          ...input,
          operationId: ` ${input.operationId} `,
        }
        const concurrentIntents = yield* Effect.all(
          [
            service.createJournalIntent(concurrentInput),
            service.createJournalIntent(concurrentInput),
          ],
          { concurrency: "unbounded" },
        )
        assert.strictEqual(concurrentIntents[0]!.id, concurrentIntents[1]!.id)
        const concurrentPosted = yield* service.submitFinancialOperation({
          tenantId: tenant!.id,
          operationId: concurrentInput.operationId,
        })
        assert.strictEqual(concurrentPosted.status, "reconciled")

        const intent = yield* service.createJournalIntent(paddedInput)
        assert.strictEqual(intent.status, "intent")
        assert.strictEqual(intent.operationId, input.operationId)

        const [queued] = yield* Effect.promise(
          () =>
            client<{ job_type: string; idempotency_key: string; correlation_id: string }[]>`
              select job_type, idempotency_key, correlation_id from process.jobs
              where tenant_id = ${
                tenant!.id
              } and idempotency_key = ${paddedInput.operationId.trim()}
            `,
        )
        assert.strictEqual(queued!.job_type, "accounting.financial_operation.submit")
        assert.strictEqual(queued!.idempotency_key, input.operationId)
        assert.strictEqual(queued!.correlation_id, input.correlationId.trim())

        const posted = yield* service.submitFinancialOperation({
          tenantId: tenant!.id,
          operationId: paddedInput.operationId,
        })
        assert.strictEqual(posted.status, "reconciled")
        const projectedTransfers = yield* Effect.promise(
          () =>
            client<{ position: number; engine_transfer_id: string | null; status: string }[]>`
              select position, engine_transfer_id, status
              from accounting.financial_operation_transfers
              where tenant_id = ${tenant!.id}
                and operation_id = ${posted.id}
              order by position
            `,
        )
        assert.strictEqual(projectedTransfers.length, 1)
        assert.isNotNull(projectedTransfers[0]!.engine_transfer_id)
        assert.strictEqual(projectedTransfers[0]!.status, "accepted")

        const immutableOperation = yield* postgresFailure(
          () =>
            client`
              update accounting.financial_operations
              set mapping_version = 2
              where tenant_id = ${tenant!.id} and id = ${posted.id}
            `,
        )
        assert.strictEqual(
          postgresConstraint(immutableOperation),
          "financial_operations_immutable_fields_check",
        )
        const immutableReconciledEventId = yield* postgresFailure(
          () =>
            client`
              update accounting.financial_operations
              set reconciled_event_id = ${uuidv7()}
              where tenant_id = ${tenant!.id} and id = ${posted.id}
            `,
        )
        assert.strictEqual(
          postgresConstraint(immutableReconciledEventId),
          "financial_operations_immutable_fields_check",
        )
        const [postedEventIdentity] = yield* Effect.promise(
          () =>
            client<{ reconciled_event_id: string }[]>`
              select reconciled_event_id
              from accounting.financial_operations
              where tenant_id = ${tenant!.id} and id = ${posted.id}
            `,
        )
        const [duplicateJournal] = yield* Effect.promise(
          () =>
            client<{ id: string }[]>`
              insert into accounting.journal_entries (tenant_id, reference, status)
              values (${tenant!.id}, ${`duplicate-event-${uuidv7()}`}, 'draft')
              returning id
            `,
        )
        const blankOperationId = yield* postgresFailure(
          () =>
            client`
              insert into accounting.financial_operations (
                tenant_id, legal_entity_id, period_id, operation_id, operation_type,
                journal_id, source_journal_id, reference, currency, mapping_version,
                engine, engine_verified, request_fingerprint, actor_principal_id,
                actor_session_id, status, attempts, scheduled_at, submitted_at,
                engine_accepted_at, rejection_reason, recovery_reason, observed_engine,
                last_error, reconciled_at
              )
              select tenant_id, legal_entity_id, period_id, '   ', operation_type,
                ${duplicateJournal!.id}, source_journal_id,
                ${`blank-operation-reference-${uuidv7()}`}, currency, mapping_version,
                engine, engine_verified, request_fingerprint, actor_principal_id,
                actor_session_id, status, attempts, scheduled_at, submitted_at,
                engine_accepted_at, rejection_reason, recovery_reason, observed_engine,
                last_error, reconciled_at
              from accounting.financial_operations
              where tenant_id = ${tenant!.id} and id = ${posted.id}
            `,
        )
        assert.strictEqual(
          postgresConstraint(blankOperationId),
          "financial_operations_operation_id_check",
        )
        const insertBlankMetadataOperation = (input: {
          readonly operationId: string
          readonly status: "intent" | "accepted" | "rejected" | "manual_recovery"
          readonly engineAcceptedAt: string | null
          readonly rejectionReason: string | null
          readonly recoveryReason: string | null
          readonly lastError: string | null
        }) =>
          postgresFailure(
            () =>
              client`
                with duplicate_journal as (
                  insert into accounting.journal_entries (tenant_id, reference, status)
                  values (${tenant!.id}, ${`blank-metadata-${uuidv7()}`}, 'draft')
                  returning id
                )
                insert into accounting.financial_operations (
                  tenant_id, legal_entity_id, period_id, operation_id, operation_type,
                  journal_id, source_journal_id, reference, currency, mapping_version,
                  engine, engine_verified, request_fingerprint, actor_principal_id,
                  actor_session_id, status, attempts, scheduled_at, submitted_at,
                  engine_accepted_at, rejection_reason, recovery_reason, observed_engine,
                  last_error, reconciled_at
                )
                select f.tenant_id, f.legal_entity_id, f.period_id, ${input.operationId},
                  f.operation_type, duplicate_journal.id, f.source_journal_id,
                  ${`blank-metadata-reference-${uuidv7()}`}, f.currency,
                  f.mapping_version, f.engine, f.engine_verified, f.request_fingerprint,
                  f.actor_principal_id, f.actor_session_id, ${input.status}, f.attempts,
                  f.scheduled_at, f.submitted_at, ${input.engineAcceptedAt},
                  ${input.rejectionReason}, ${input.recoveryReason}, f.observed_engine,
                  ${input.lastError}, null
                from accounting.financial_operations f
                cross join duplicate_journal
                where f.tenant_id = ${tenant!.id} and f.id = ${posted.id}
              `,
          )
        for (const invalid of [
          {
            operationId: `blank-engine-accepted-${uuidv7()}`,
            status: "accepted",
            engineAcceptedAt: "   ",
            rejectionReason: null,
            recoveryReason: null,
            lastError: null,
            constraint: "financial_operations_engine_accepted_at_check",
          },
          {
            operationId: `blank-rejection-reason-${uuidv7()}`,
            status: "rejected",
            engineAcceptedAt: null,
            rejectionReason: "   ",
            recoveryReason: null,
            lastError: null,
            constraint: "financial_operations_rejection_reason_check",
          },
          {
            operationId: `blank-recovery-reason-${uuidv7()}`,
            status: "manual_recovery",
            engineAcceptedAt: null,
            rejectionReason: null,
            recoveryReason: "   ",
            lastError: null,
            constraint: "financial_operations_recovery_reason_check",
          },
          {
            operationId: `blank-last-error-${uuidv7()}`,
            status: "intent",
            engineAcceptedAt: null,
            rejectionReason: null,
            recoveryReason: null,
            lastError: "   ",
            constraint: "financial_operations_last_error_check",
          },
        ] as const) {
          const failure = yield* insertBlankMetadataOperation(invalid)
          assert.strictEqual(postgresConstraint(failure), invalid.constraint)
        }
        const duplicateReconciledEvent = yield* postgresFailure(
          () =>
            client`
              insert into accounting.financial_operations (
                tenant_id, legal_entity_id, period_id, operation_id, operation_type,
                journal_id, source_journal_id, reference, currency, mapping_version,
                engine, engine_verified, request_fingerprint, actor_principal_id,
                actor_session_id, status, attempts, scheduled_at, submitted_at,
                engine_accepted_at, rejection_reason, recovery_reason, observed_engine,
                last_error, reconciled_at, reconciled_event_id
              )
              select tenant_id, legal_entity_id, period_id, ${`duplicate-${uuidv7()}`},
                operation_type, ${duplicateJournal!.id}, source_journal_id,
                ${`duplicate-reference-${uuidv7()}`}, currency, mapping_version,
                engine, engine_verified, request_fingerprint, actor_principal_id,
                actor_session_id, status, attempts, scheduled_at, submitted_at,
                engine_accepted_at, rejection_reason, recovery_reason, observed_engine,
                last_error, reconciled_at, ${postedEventIdentity!.reconciled_event_id}
              from accounting.financial_operations
              where tenant_id = ${tenant!.id} and id = ${posted.id}
            `,
        )
        assert.strictEqual(
          postgresConstraint(duplicateReconciledEvent),
          "financial_operations_tenant_reconciled_event_key",
        )
        const immutableTransfer = yield* postgresFailure(
          () =>
            client`
              update accounting.financial_operation_transfers
              set engine_transfer_id = 'different'
              where tenant_id = ${tenant!.id} and operation_id = ${posted.id}
            `,
        )
        assert.strictEqual(
          postgresConstraint(immutableTransfer),
          "financial_operation_transfers_immutable_fields_check",
        )

        const corruptOperationId = `corrupt-${uuidv7()}`
        const corruptService = yield* Effect.provide(
          makeFinancialOperationService,
          Layer.mergeAll(
            Layer.succeed(Database, database),
            authorization,
            Layer.succeed(MessagingService, messaging),
            Layer.succeed(DurableJobEnqueuer, jobs),
            Layer.succeed(SalesService, sales),
            makeFinancialLedgerTestLayer({ corruptTransferIdsFor: corruptOperationId }),
          ),
        )
        yield* corruptService.createJournalIntent({
          ...input,
          operationId: corruptOperationId,
          reference: `corrupt-${uuidv7()}`,
        })
        const corruptResult = yield* corruptService.submitFinancialOperation({
          tenantId: tenant!.id,
          operationId: corruptOperationId,
        })
        assert.strictEqual(corruptResult.status, "manual_recovery")

        let failReceipt = true
        // SAFETY: the double keeps the real messaging members and replaces only append.
        const failingMessaging = {
          ...messaging,
          append: (event: unknown) =>
            failReceipt
              ? Effect.fail(
                  new DatabaseFailure({
                    operation: "financial-operation.test.receipt",
                    cause: null,
                  }),
                )
              : messaging.append(event),
        } as typeof messaging
        const failingService = yield* Effect.provide(
          makeFinancialOperationService,
          Layer.mergeAll(
            Layer.succeed(Database, database),
            authorization,
            Layer.succeed(MessagingService, failingMessaging),
            Layer.succeed(DurableJobEnqueuer, jobs),
            Layer.succeed(SalesService, sales),
            makeFinancialLedgerTestLayer(),
          ),
        )
        const failedInput = {
          ...input,
          operationId: "postgres-receipt-failure",
          reference: `receipt-failure-${uuidv7()}`,
        }
        yield* failingService.createJournalIntent(failedInput)
        const receiptFailure = yield* Effect.flip(
          failingService.submitFinancialOperation({
            tenantId: tenant!.id,
            operationId: failedInput.operationId,
          }),
        )
        assert.instanceOf(receiptFailure, DatabaseFailure)
        const [failedOperation] = yield* Effect.promise(
          () =>
            client<
              {
                status: string
                journal_status: string
                transfer_status: string
              }[]
            >`
              select operation.status, journal.status as journal_status,
                transfer.status as transfer_status
              from accounting.financial_operations operation
              join accounting.journal_entries journal
                on journal.tenant_id = operation.tenant_id and journal.id = operation.journal_id
              join accounting.financial_operation_transfers transfer
                on transfer.tenant_id = operation.tenant_id and transfer.operation_id = operation.id
              where operation.tenant_id = ${tenant!.id} and operation.operation_id =
                ${failedInput.operationId}
            `,
        )
        assert.deepStrictEqual(failedOperation, {
          status: "accepted",
          journal_status: "draft",
          transfer_status: "unresolved",
        })
        const accounting = yield* Effect.provide(
          makeAccountingService,
          Layer.mergeAll(
            Layer.succeed(Database, database),
            authorization,
            Layer.succeed(MessagingService, messaging),
            Layer.succeed(SalesService, sales),
          ),
        )
        const closeFailure = yield* Effect.flip(
          accounting.closePeriod({
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity!.id,
            periodId: intent.periodId,
          }),
        )
        assert.instanceOf(closeFailure, FinancialOperationsPending)
        failReceipt = false
        const recovered = yield* failingService.submitFinancialOperation({
          tenantId: tenant!.id,
          operationId: failedInput.operationId,
        })
        assert.strictEqual(recovered.status, "reconciled")

        const lostInput = {
          ...input,
          operationId: "lost-operation",
          reference: `lost-${uuidv7()}`,
        }
        yield* lostService.createJournalIntent(lostInput)
        const unknown = yield* lostService.submitFinancialOperation({
          tenantId: tenant!.id,
          operationId: lostInput.operationId,
        })
        assert.strictEqual(unknown.status, "unknown")
        const [reconcileJob] = yield* Effect.promise(
          () =>
            client<{ job_type: string }[]>`
              select job_type from process.jobs
              where tenant_id = ${tenant!.id}
                and idempotency_key = ${`${lostInput.operationId}:reconcile`}
            `,
        )
        assert.strictEqual(reconcileJob!.job_type, "accounting.financial_operation.reconcile")
        const reconciled = yield* lostService.reconcileFinancialOperation({
          tenantId: tenant!.id,
          operationId: lostInput.operationId,
        })
        assert.strictEqual(reconciled.status, "reconciled")
        const reconciledAgain = yield* lostService.reconcileFinancialOperation({
          tenantId: tenant!.id,
          operationId: lostInput.operationId,
        })
        assert.strictEqual(reconciledAgain.status, "reconciled")

        const checkpoint = yield* service.reconcileFinancialCheckpoint({
          principal,
          tenantId: tenant!.id,
          legalEntityId: legalEntity!.id,
          recoveryWatermark: observationRecoveryWatermark,
          sourceWatermark: observedSourceWatermark.value,
          targetWatermark: observedTargetWatermark.value,
          sourceSnapshotRef: observedSourceWatermark.snapshotRef,
          targetSnapshotRef: observedTargetWatermark.snapshotRef,
          evidenceArtifactId: null,
        })
        assert.include(["verified", "blocked"], checkpoint.status)
        assert.strictEqual(checkpoint.sourceWatermark, "postgres:test-watermark")
        assert.strictEqual(checkpoint.targetWatermark, "tigerbeetle:test-watermark")
        assert.strictEqual(checkpoint.sourceSnapshotRef, "postgres:test-snapshot")
        assert.strictEqual(checkpoint.targetSnapshotRef, "tigerbeetle:test-snapshot")
        const checkpointReplay = yield* service.reconcileFinancialCheckpoint({
          principal,
          tenantId: tenant!.id,
          legalEntityId: legalEntity!.id,
          recoveryWatermark: checkpoint.recoveryWatermark,
          sourceWatermark: observedSourceWatermark.value,
          targetWatermark: observedTargetWatermark.value,
          sourceSnapshotRef: observedSourceWatermark.snapshotRef,
          targetSnapshotRef: observedTargetWatermark.snapshotRef,
          evidenceArtifactId: null,
        })
        assert.deepStrictEqual(checkpointReplay, checkpoint)

        const invalidWatermark = yield* Effect.flip(
          service.reconcileFinancialCheckpoint({
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity!.id,
            recoveryWatermark: `invalid-watermark-${uuidv7()}`,
            sourceWatermark: "postgres:unobserved-watermark",
            targetWatermark: observedTargetWatermark.value,
            sourceSnapshotRef: "postgres:unobserved-snapshot",
            targetSnapshotRef: observedTargetWatermark.snapshotRef,
            evidenceArtifactId: null,
          }),
        )
        assert.instanceOf(invalidWatermark, FinancialStoreObservationFailure)
        assert.strictEqual(invalidWatermark.reason, "invalid_watermark")

        const concurrentSourceWatermark = {
          ...observedSourceWatermark,
          value: "postgres:concurrent-checkpoint",
          snapshotRef: "postgres:concurrent-source-snapshot",
        }
        const concurrentTargetWatermark = {
          ...observedTargetWatermark,
          value: "tigerbeetle:concurrent-checkpoint",
          snapshotRef: "tigerbeetle:concurrent-target-snapshot",
        }
        const concurrentRecoveryWatermark = `observation:${yield* hashFinancialStoreWatermarks(
          concurrentSourceWatermark,
          concurrentTargetWatermark,
        )}`
        const concurrentService = yield* Effect.provide(
          makeFinancialOperationService,
          Layer.mergeAll(
            Layer.succeed(Database, database),
            authorization,
            Layer.succeed(MessagingService, messaging),
            Layer.succeed(DurableJobEnqueuer, jobs),
            Layer.succeed(SalesService, sales),
            Layer.succeed(FinancialLedgerPort, ledger),
            makeObservationRegistry(concurrentSourceWatermark, concurrentTargetWatermark),
          ),
        )
        const [concurrentCheckpoint, concurrentCheckpointReplay] = yield* Effect.all(
          [
            concurrentService.reconcileFinancialCheckpoint({
              principal,
              tenantId: tenant!.id,
              legalEntityId: legalEntity!.id,
              recoveryWatermark: concurrentRecoveryWatermark,
              sourceWatermark: concurrentSourceWatermark.value,
              targetWatermark: concurrentTargetWatermark.value,
              sourceSnapshotRef: concurrentSourceWatermark.snapshotRef,
              targetSnapshotRef: concurrentTargetWatermark.snapshotRef,
              evidenceArtifactId: null,
            }),
            concurrentService.reconcileFinancialCheckpoint({
              principal,
              tenantId: tenant!.id,
              legalEntityId: legalEntity!.id,
              recoveryWatermark: concurrentRecoveryWatermark,
              sourceWatermark: concurrentSourceWatermark.value,
              targetWatermark: concurrentTargetWatermark.value,
              sourceSnapshotRef: concurrentSourceWatermark.snapshotRef,
              targetSnapshotRef: concurrentTargetWatermark.snapshotRef,
              evidenceArtifactId: null,
            }),
          ],
          { concurrency: "unbounded" },
        )
        assert.deepStrictEqual(concurrentCheckpointReplay, concurrentCheckpoint)
        const [concurrentRows] = yield* Effect.promise(
          () =>
            client<{ count: string }[]>`
              select count(*)::text as count
              from accounting.financial_reconciliation_checkpoints
              where tenant_id = ${tenant!.id}
                and recovery_watermark = ${concurrentRecoveryWatermark}
            `,
        )
        assert.strictEqual(concurrentRows!.count, "1")

        const [conflictArtifact] = yield* Effect.promise(
          () =>
            client<{ id: string }[]>`
              insert into accounting.financial_verification_artifacts (
                tenant_id, legal_entity_id, kind, status, completeness, scope,
                schema_version, mapping_version, currency, source_watermark, target_watermark,
                source_snapshot_ref, target_snapshot_ref, artifact_hash, signature_algorithm,
                signing_key_id, signature, operation_set_hash, account_balance_hash,
                transfer_set_hash, projection_hash, source_debit_minor, source_credit_minor,
                target_debit_minor, target_credit_minor, account_count, operation_count,
                transfer_count, mismatch_count, producer_principal_id, started_at, completed_at
              ) values (
                ${tenant!.id}, ${legalEntity!.id}, 'observability', 'verified', 'bounded',
                ${observationScope}, 1, 1, 'USD', ${checkpoint.sourceWatermark},
                ${checkpoint.targetWatermark}, ${checkpoint.sourceSnapshotRef},
                ${checkpoint.targetSnapshotRef}, repeat('0', 64), 'Ed25519', 'test-key',
                'test-signature', ${checkpoint.operationSetHash}, ${checkpoint.accountBalanceHash},
                ${checkpoint.transferSetHash}, ${checkpoint.projectionHash}, '0', '0', '0', '0',
                0, 0, 0, 0, ${principal.userAccountId}, now(), now()
              ) returning id
            `,
        )
        const checkpointConflict = yield* Effect.flip(
          service.reconcileFinancialCheckpoint({
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity!.id,
            recoveryWatermark: checkpoint.recoveryWatermark,
            sourceWatermark: observedSourceWatermark.value,
            targetWatermark: observedTargetWatermark.value,
            sourceSnapshotRef: observedSourceWatermark.snapshotRef,
            targetSnapshotRef: observedTargetWatermark.snapshotRef,
            evidenceArtifactId: conflictArtifact!.id,
          }),
        )
        assert.instanceOf(checkpointConflict, FinancialReconciliationCheckpointConflict)
        const checkpointMismatchLedger = {
          ...ledger,
          reconcileJournal: (journalInput: unknown) =>
            ledger.reconcileJournal(journalInput).pipe(
              Effect.map((outcome) => {
                if (outcome._tag !== "accepted") return outcome
                // SAFETY: the test calls this double only with inputs of the shape it reads.
                const operationId = (journalInput as { readonly operationId?: string }).operationId
                return operationId === input.operationId
                  ? {
                      ...outcome,
                      mappingVersion: outcome.mappingVersion + 1,
                      transferCount: outcome.transferCount + 1,
                      transferIds: [...outcome.transferIds, "orphan-transfer"],
                    }
                  : { ...outcome, mappingVersion: outcome.mappingVersion + 1 }
              }),
            ),
        }
        const mismatchSourceWatermark = {
          ...observedSourceWatermark,
          value: "postgres:mismatch-watermark",
          snapshotRef: "postgres:mismatch-snapshot",
        }
        const mismatchTargetWatermark = {
          ...observedTargetWatermark,
          value: "tigerbeetle:mismatch-watermark",
          snapshotRef: "tigerbeetle:mismatch-snapshot",
        }
        const mismatchRecoveryWatermark = `observation:${yield* hashFinancialStoreWatermarks(
          mismatchSourceWatermark,
          mismatchTargetWatermark,
        )}`
        const mismatchObservationRegistry = makeObservationRegistry(
          mismatchSourceWatermark,
          mismatchTargetWatermark,
        )
        const checkpointMismatchService = yield* Effect.provide(
          makeFinancialOperationService,
          Layer.mergeAll(
            Layer.succeed(Database, database),
            authorization,
            Layer.succeed(MessagingService, messaging),
            Layer.succeed(DurableJobEnqueuer, jobs),
            Layer.succeed(SalesService, sales),
            Layer.succeed(FinancialLedgerPort, checkpointMismatchLedger),
            mismatchObservationRegistry,
          ),
        )
        const mismatchedCheckpoint = yield* checkpointMismatchService.reconcileFinancialCheckpoint({
          principal,
          tenantId: tenant!.id,
          legalEntityId: legalEntity!.id,
          recoveryWatermark: mismatchRecoveryWatermark,
          sourceWatermark: mismatchSourceWatermark.value,
          targetWatermark: mismatchTargetWatermark.value,
          sourceSnapshotRef: mismatchSourceWatermark.snapshotRef,
          targetSnapshotRef: mismatchTargetWatermark.snapshotRef,
          evidenceArtifactId: null,
        })
        assert.strictEqual(mismatchedCheckpoint.status, "blocked")
        assert.isAbove(mismatchedCheckpoint.mismatchCount, 0)
        assert.strictEqual(mismatchedCheckpoint.orphanCount, 1)
        const mismatchedCheckpointReplay =
          yield* checkpointMismatchService.reconcileFinancialCheckpoint({
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity!.id,
            recoveryWatermark: mismatchRecoveryWatermark,
            sourceWatermark: mismatchSourceWatermark.value,
            targetWatermark: mismatchTargetWatermark.value,
            sourceSnapshotRef: mismatchSourceWatermark.snapshotRef,
            targetSnapshotRef: mismatchTargetWatermark.snapshotRef,
            evidenceArtifactId: null,
          })
        assert.deepStrictEqual(mismatchedCheckpointReplay, mismatchedCheckpoint)

        const checkpointMutation = yield* postgresFailure(
          () =>
            client`
              update accounting.financial_reconciliation_checkpoints
              set status = 'verified'
              where tenant_id = ${tenant!.id} and id = ${checkpoint.id}
            `,
        )
        assert.strictEqual(
          postgresConstraint(checkpointMutation),
          "financial_reconciliation_checkpoints_immutable",
        )
        const invalidVerifiedCounts = yield* postgresFailure(
          () =>
            client`
              insert into accounting.financial_reconciliation_checkpoints (
                tenant_id, legal_entity_id, engine, status, recovery_watermark,
                source_watermark, target_watermark, source_snapshot_ref, target_snapshot_ref,
                operation_set_hash, account_balance_hash, transfer_set_hash, projection_hash,
                evidence_artifact_id, mismatch_count, orphan_count, checked_by, checked_at
              )
              select tenant_id, legal_entity_id, engine, 'verified',
                ${`invalid-verified-count-${uuidv7()}`},
                source_watermark, target_watermark, source_snapshot_ref, target_snapshot_ref,
                operation_set_hash, account_balance_hash, transfer_set_hash, projection_hash,
                evidence_artifact_id, 1, orphan_count, checked_by, checked_at
              from accounting.financial_reconciliation_checkpoints
              where tenant_id = ${tenant!.id} and id = ${checkpoint.id}
            `,
        )
        assert.strictEqual(
          postgresConstraint(invalidVerifiedCounts),
          "financial_reconciliation_checkpoints_verified_counts_check",
        )

        const makeMatrixService = (
          databaseLayer: Layer.Layer<DatabaseService> = Layer.succeed(Database, database),
          ledgerLayer = makeFinancialLedgerTestLayer(),
          // SAFETY: the failpoint starts unset and is assigned by the test.
          failpoint = undefined as FinancialOperationFailpointNameType | undefined,
        ) =>
          Effect.provide(
            makeFinancialOperationService,
            Layer.mergeAll(
              databaseLayer,
              authorization,
              Layer.succeed(MessagingService, messaging),
              Layer.succeed(DurableJobEnqueuer, jobs),
              Layer.succeed(SalesService, sales),
              ledgerLayer,
              makeFinancialOperationFailpointLayer(failpoint === undefined ? [] : [failpoint]),
            ),
          )
        const failureCases = [
          ["A_before_intent_commit", "before_intent_commit"],
          ["B_after_intent_before_submission", "after_intent_commit"],
          ["E_process_dies_after_acceptance_before_receipt", "after_provider_acceptance"],
          ["F_accepted_before_journal_projection", "before_projection_commit"],
          ["G_projected_before_outbox", "before_outbox_append"],
          ["H_partial_finalization", "before_receipt_commit"],
          ["H_after_receipt_commit", "after_receipt_commit"],
          ["H_after_finalization", "after_finalization"],
          ["B_before_provider_submission", "before_provider_submission"],
        ] as const
        for (const [point, failpoint] of failureCases) {
          const matrixInput = {
            ...input,
            operationId: `matrix-${point}-${uuidv7()}`,
            reference: `matrix-${point}-${uuidv7()}`,
          }
          const matrixService = yield* makeMatrixService(undefined, undefined, failpoint)
          if (point === "A_before_intent_commit" || point === "B_after_intent_before_submission") {
            const failed = yield* Effect.flip(matrixService.createJournalIntent(matrixInput))
            assert.instanceOf(failed, FinancialOperationInjectedFailure)
            assert.strictEqual(failed.point, failpoint)
            const intentAfterRestart = yield* matrixService.createJournalIntent(matrixInput)
            assert.strictEqual(intentAfterRestart.status, "intent")
          } else {
            const intentBeforeFailure = yield* matrixService.createJournalIntent(matrixInput)
            assert.strictEqual(intentBeforeFailure.status, "intent")
            const failed = yield* Effect.flip(
              matrixService.submitFinancialOperation({
                tenantId: tenant!.id,
                operationId: intentBeforeFailure.operationId,
              }),
            )
            assert.instanceOf(failed, FinancialOperationInjectedFailure)
            assert.strictEqual(failed.point, failpoint)
          }
          const recovered = yield* matrixService.submitFinancialOperation({
            tenantId: tenant!.id,
            operationId: matrixInput.operationId,
          })
          assert.strictEqual(recovered.status, "reconciled")
          if (point === "E_process_dies_after_acceptance_before_receipt") {
            const replayed = yield* matrixService.submitFinancialOperation({
              tenantId: tenant!.id,
              operationId: matrixInput.operationId,
            })
            assert.strictEqual(replayed.status, "reconciled")
            const [transferSummary] = yield* Effect.promise(
              () =>
                client<{ total: string; accepted: string; transfer_id: string | null }[]>`
                  select count(*)::text as total,
                    count(*) filter (where status = 'accepted')::text as accepted,
                    min(engine_transfer_id) as transfer_id
                  from accounting.financial_operation_transfers
                  where tenant_id = ${tenant!.id}
                    and operation_id = ${replayed.id}
                `,
            )
            assert.strictEqual(transferSummary!.total, "1")
            assert.strictEqual(transferSummary!.accepted, "1")
            assert.isNotNull(transferSummary!.transfer_id)
          }
        }

        const providerCases = [
          ["C_submission_outcome_unknown", "failBeforeSubmissionFor"],
          ["D_response_lost_after_acceptance", "loseResponseFor"],
          ["L_tigerbeetle_unavailable", "unavailableFor"],
        ] as const
        for (const [point, option] of providerCases) {
          const operationId = `matrix-${point}-${uuidv7()}`
          const providerLedger = makeFinancialLedgerTestLayer({ [option]: operationId })
          const providerService = yield* makeMatrixService(undefined, providerLedger)
          const providerInput = {
            ...input,
            operationId,
            reference: `matrix-${point}-${uuidv7()}`,
          }
          yield* providerService.createJournalIntent(providerInput)
          const unknownProviderOutcome = yield* providerService.submitFinancialOperation({
            tenantId: tenant!.id,
            operationId,
          })
          assert.strictEqual(unknownProviderOutcome.status, "unknown")
          const providerRecovery = yield* providerService.reconcileFinancialOperation({
            tenantId: tenant!.id,
            operationId,
          })
          assert.strictEqual(
            providerRecovery.status,
            point === "L_tigerbeetle_unavailable" ? "unknown" : "reconciled",
          )
        }

        const postgresUnavailableOperation = `matrix-M-${uuidv7()}`
        const postgresUnavailableService = yield* makeMatrixService(
          Layer.succeed(
            Database,
            failDatabaseOnceAt(database, "accounting.financial_operation.receipt"),
          ),
        )
        yield* postgresUnavailableService.createJournalIntent({
          ...input,
          operationId: postgresUnavailableOperation,
          reference: `matrix-M-${uuidv7()}`,
        })
        const postgresFailureResult = yield* Effect.flip(
          postgresUnavailableService.submitFinancialOperation({
            tenantId: tenant!.id,
            operationId: postgresUnavailableOperation,
          }),
        )
        assert.instanceOf(postgresFailureResult, DatabaseFailure)
        const postgresRecovered = yield* postgresUnavailableService.submitFinancialOperation({
          tenantId: tenant!.id,
          operationId: postgresUnavailableOperation,
        })
        assert.strictEqual(postgresRecovered.status, "reconciled")

        const replay = yield* service.createJournalIntent(input)
        assert.strictEqual(replay.id, intent.id)
        const [{ count }] = yield* Effect.promise(
          () =>
            client<{ count: string }[]>`
              select count(*)::text as count from process.jobs
              where tenant_id = ${tenant!.id} and idempotency_key = ${input.operationId}
            `,
        )
        assert.strictEqual(count, "1")

        const [projection] = yield* Effect.promise(
          () =>
            client<{ status: string }[]>`
              select status from accounting.journal_entries where id = ${posted.journalId}
            `,
        )
        assert.strictEqual(projection!.status, "posted")

        const reversalIntent = yield* service.createReversalIntent({
          principal,
          tenantId: tenant!.id,
          legalEntityId: legalEntity!.id,
          sourceJournalId: posted.journalId,
          operationId: `reversal-${uuidv7()}`,
          reference: `reversal-${uuidv7()}`,
          currency: "USD",
          mappingVersion: 1,
          correlationId: `reversal-correlation-${uuidv7()}`,
        })
        assert.strictEqual(reversalIntent.operationType, "journal_reverse")
        const reversed = yield* service.submitFinancialOperation({
          tenantId: tenant!.id,
          operationId: reversalIntent.operationId,
        })
        assert.strictEqual(reversed.status, "reconciled")
        const [reversalProjection] = yield* Effect.promise(
          () =>
            client<{ status: string; reverses_entry_id: string | null }[]>`
              select status, reverses_entry_id
              from accounting.journal_entries where id = ${reversed.journalId}
            `,
        )
        assert.deepStrictEqual(reversalProjection, {
          status: "reversed",
          reverses_entry_id: posted.journalId,
        })
        const duplicateReversal = yield* Effect.flip(
          service.createReversalIntent({
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity!.id,
            sourceJournalId: posted.journalId,
            operationId: `duplicate-reversal-${uuidv7()}`,
            reference: `duplicate-reversal-${uuidv7()}`,
            currency: "USD",
            mappingVersion: 1,
            correlationId: `duplicate-reversal-correlation-${uuidv7()}`,
          }),
        )
        assert.instanceOf(duplicateReversal, FinancialReversalAlreadyExists)

        const blockedRevenue = yield* service.createRevenueIntent({
          principal,
          tenantId: tenant!.id,
          legalEntityId: legalEntity!.id,
          orderId: uuidv7(),
          commandId: `blocked-revenue-${uuidv7()}`,
          correlationId: `blocked-revenue-correlation-${uuidv7()}`,
          currency: "USD",
          mappingVersion: 1,
        })
        const providerEntered = yield* Deferred.make<void>()
        const providerRelease = yield* Deferred.make<void>()
        let providerCalls = 0
        const blockingLedger = {
          ...ledger,
          postJournal: (input: unknown) => {
            providerCalls += 1
            return ledger.postJournal(input)
          },
        }
        const blockedService = yield* Effect.provide(
          makeFinancialOperationService,
          Layer.mergeAll(
            Layer.succeed(Database, database),
            authorization,
            Layer.succeed(MessagingService, messaging),
            Layer.succeed(DurableJobEnqueuer, jobs),
            Layer.succeed(SalesService, sales),
            Layer.succeed(FinancialLedgerPort, blockingLedger),
            Layer.succeed(FinancialOperationFailpointService, {
              hit: (point) =>
                point === "before_provider_submission"
                  ? Deferred.succeed(providerEntered, undefined).pipe(
                      Effect.andThen(Deferred.await(providerRelease)),
                    )
                  : Effect.void,
            }),
          ),
        )
        const blockedFiber = yield* blockedService
          .submitFinancialOperation({
            tenantId: tenant!.id,
            operationId: blockedRevenue.operationId,
          })
          .pipe(
            Effect.provideService(FencingContextService, {
              scope: `accounting.financial_operation:${tenant!.id}:${blockedRevenue.operationId}`,
              generation: "1",
            }),
            Effect.forkChild,
          )
        yield* Deferred.await(providerEntered)
        yield* Effect.promise(
          () =>
            client`
              update accounting.financial_operations
              set accepted_fence_generation = 2
              where tenant_id = ${tenant!.id} and operation_id = ${blockedRevenue.operationId}
            `,
        )
        yield* Deferred.succeed(providerRelease, undefined)
        const blockedError = yield* Effect.flip(Fiber.join(blockedFiber))
        assert.instanceOf(blockedError, FinancialOperationFenceRejected)
        assert.strictEqual(providerCalls, 0)
        const unblockedRevenue = yield* blockedService
          .submitFinancialOperation({
            tenantId: tenant!.id,
            operationId: blockedRevenue.operationId,
          })
          .pipe(
            Effect.provideService(FencingContextService, {
              scope: `accounting.financial_operation:${tenant!.id}:${blockedRevenue.operationId}`,
              generation: "2",
            }),
          )
        assert.strictEqual(unblockedRevenue.status, "reconciled")
        assert.strictEqual(providerCalls, 1)

        const unexpectedOperationDbId = revenueOnlyPosted.id
        const identityOperationDbId = concurrentPosted.id
        const identityOperationId = concurrentPosted.operationId
        const rejectedOperationDbId = unblockedRevenue.id
        const rejectedOperationId = unblockedRevenue.operationId
        const manualRecoveryOperationDbId = reversed.id
        const manualRecoveryOperationId = reversed.operationId
        const eventConflictOperationDbId = posted.id
        const unknownIntent = yield* service.createJournalIntent({
          ...input,
          operationId: `rebuild-unknown-${uuidv7()}`,
          reference: `rebuild-unknown-${uuidv7()}`,
        })
        const unknownPosted = yield* service.submitFinancialOperation({
          tenantId: tenant!.id,
          operationId: unknownIntent.operationId,
        })
        const unknownOperationDbId = unknownPosted.id
        const unknownOperationId = unknownPosted.operationId
        yield* Effect.promise(
          () =>
            client`
              insert into accounting.financial_operation_transfers (
                tenant_id, operation_id, position, debit_account_id, credit_account_id,
                amount_minor, engine_transfer_id, status
              ) values (
                ${tenant!.id}, ${unexpectedOperationDbId}, 1, ${debitAccount!.id},
                ${creditAccount!.id}, '1', 'unexpected-transfer', 'unresolved'
              )
            `,
        )
        type RebuildLedgerBehavior = Readonly<{
          readonly identityOperationId?: string
          readonly rejectedOperationId?: string
          readonly manualRecoveryOperationId?: string
          readonly unknownOperationId?: string
          readonly unknownReason?: "unavailable" | "not_found"
        }>
        const makeRebuildLedger = (behavior: RebuildLedgerBehavior = {}) => {
          const acceptedOutcome = (journalInput: unknown) => {
            // SAFETY: the test calls this double only with inputs of the shape it reads.
            const request = journalInput as {
              readonly operationId: string
              readonly mappingVersion: number
            }
            return ledger.expectedTransferIds(journalInput).pipe(
              Effect.map((transferIds) => ({
                _tag: "accepted" as const,
                operationId: request.operationId,
                mappingVersion: request.mappingVersion,
                acceptedAt: "0",
                transferCount: transferIds.length,
                transferIds,
              })),
            )
          }
          return {
            authority: "tigerbeetle" as const,
            createExecutionAccount: ledger.createExecutionAccount,
            postJournal: ledger.postJournal,
            expectedTransferIds: ledger.expectedTransferIds,
            getBalance: (balanceInput: unknown) => {
              // SAFETY: the test calls this double only with inputs of the shape it reads.
              const target = balanceInput as {
                readonly accountId: string
                readonly mappingVersion: number
              }
              return Effect.succeed({
                _tag: "available" as const,
                accountId: target.accountId,
                mappingVersion: target.mappingVersion,
                debitsPendingMinor: "0",
                debitsPostedMinor: "0",
                creditsPendingMinor: "0",
                creditsPostedMinor: "0",
              })
            },
            reconcileJournal: (journalInput: unknown) => {
              // SAFETY: the test calls this double only with inputs of the shape it reads.
              const operationId = (journalInput as { readonly operationId: string }).operationId
              if (operationId === behavior.identityOperationId) {
                return acceptedOutcome(journalInput).pipe(
                  Effect.map((outcome) => ({
                    ...outcome,
                    transferIds: outcome.transferIds.map((id) => `${id}:identity-mismatch`),
                  })),
                )
              }
              if (operationId === behavior.rejectedOperationId) {
                return Effect.succeed({
                  _tag: "rejected" as const,
                  operationId,
                  reason: "invalid_amount" as const,
                })
              }
              if (operationId === behavior.manualRecoveryOperationId) {
                return Effect.succeed({
                  _tag: "manual_recovery" as const,
                  operationId,
                  reason: "reconciliation_required" as const,
                })
              }
              if (
                operationId === behavior.unknownOperationId &&
                behavior.unknownReason !== undefined
              ) {
                return Effect.succeed({
                  _tag: "unknown" as const,
                  operationId,
                  reason: behavior.unknownReason,
                })
              }
              return acceptedOutcome(journalInput)
            },
          } satisfies FinancialLedgerPort
        }
        const rebuildVariantsLedger = makeRebuildLedger({
          identityOperationId,
          rejectedOperationId,
          manualRecoveryOperationId,
        })
        // SAFETY: the double keeps the real messaging members and replaces only append.
        const eventConflictMessaging = {
          ...messaging,
          append: (event: unknown) => {
            // SAFETY: the test calls this double only with inputs of the shape it reads.
            const candidate = event as {
              readonly aggregateId: string
              readonly eventId: string
              readonly eventType: string
              readonly eventVersion: number
              readonly tenantId: string
              readonly idempotencyKey: string
            }
            if (candidate.aggregateId !== eventConflictOperationDbId) {
              return messaging.append(event)
            }
            return Effect.fail(
              new EventIdempotencyConflict({
                tenantId: candidate.tenantId,
                eventId: candidate.eventId,
                eventType: candidate.eventType,
                eventVersion: candidate.eventVersion,
                idempotencyKey: candidate.idempotencyKey,
              }),
            )
          },
        } as typeof messaging
        const makeRebuildService = (
          rebuildLedger: FinancialLedgerPort,
          rebuildMessaging: typeof messaging = messaging,
        ) =>
          Effect.provide(
            makeFinancialOperationService,
            Layer.mergeAll(
              Layer.succeed(Database, database),
              authorization,
              Layer.succeed(MessagingService, rebuildMessaging),
              Layer.succeed(DurableJobEnqueuer, jobs),
              Layer.succeed(SalesService, sales),
              Layer.succeed(FinancialLedgerPort, rebuildLedger),
            ),
          )
        const rebuildVariantsService = yield* makeRebuildService(
          rebuildVariantsLedger,
          eventConflictMessaging,
        )
        const variantsRebuild = yield* rebuildVariantsService.rebuildFinancialProjections({
          principal,
          tenantId: tenant!.id,
          legalEntityId: legalEntity!.id,
        })
        assert.isAtLeast(variantsRebuild.rebuiltOperations, 1)
        assert.isAtLeast(variantsRebuild.quarantinedOperations, 5)
        const readOperationStatus = (operationId: string) =>
          Effect.promise(
            () =>
              client<{ status: string }[]>`
                select status
                from accounting.financial_operations
                where tenant_id = ${tenant!.id} and id = ${operationId}
              `,
          )
        for (const operationId of [
          unexpectedOperationDbId,
          identityOperationDbId,
          rejectedOperationDbId,
          manualRecoveryOperationDbId,
          eventConflictOperationDbId,
        ]) {
          const [operation] = yield* readOperationStatus(operationId)
          assert.strictEqual(operation!.status, "manual_recovery")
        }
        const [unknownAfterVariants] = yield* readOperationStatus(unknownOperationDbId)
        assert.strictEqual(unknownAfterVariants!.status, "reconciled")

        const notFoundService = yield* makeRebuildService(
          makeRebuildLedger({
            unknownOperationId,
            unknownReason: "not_found",
          }),
        )
        const notFoundRebuild = yield* Effect.flip(
          notFoundService.rebuildFinancialProjections({
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity!.id,
          }),
        )
        assert.instanceOf(notFoundRebuild, FinancialProjectionRebuildBlocked)
        assert.strictEqual(notFoundRebuild.reason, "not_found")
        const unavailableService = yield* makeRebuildService(
          makeRebuildLedger({
            unknownOperationId,
            unknownReason: "unavailable",
          }),
        )
        const unavailableRebuild = yield* Effect.flip(
          unavailableService.rebuildFinancialProjections({
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity!.id,
          }),
        )
        assert.instanceOf(unavailableRebuild, FinancialProjectionRebuildBlocked)
        assert.strictEqual(unavailableRebuild.reason, "unavailable")

        const stableRebuildService = yield* makeRebuildService(makeRebuildLedger())
        const firstRerun = yield* stableRebuildService.rebuildFinancialProjections({
          principal,
          tenantId: tenant!.id,
          legalEntityId: legalEntity!.id,
        })
        const secondRerun = yield* stableRebuildService.rebuildFinancialProjections({
          principal,
          tenantId: tenant!.id,
          legalEntityId: legalEntity!.id,
        })
        assert.strictEqual(firstRerun.reportSnapshotHash, secondRerun.reportSnapshotHash)
        assert.strictEqual(firstRerun.checkedOperations, secondRerun.checkedOperations)
      }),
    ),
)
