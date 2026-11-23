import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { Database, DurableJobEnqueuer, uuidv7 } from "../../../../framework/foundation/mod.ts"
import { makeAuthorizationTestLayer } from "../../../../framework/modules/authorization/mod.ts"
import {
  makeMessagingService,
  MessagingService,
} from "../../../../framework/modules/messaging/mod.ts"
import { makePostgresDatabase, runMigrations } from "../../../../framework/platform/mod.ts"
import { partial } from "../../../../tests/support/partial.ts"
import { withTemporaryDatabase } from "../../../../tests/support/postgres-database.ts"
import { makeProcessJobEnqueuer } from "../../process/mod.ts"
import { SalesService } from "../../sales/mod.ts"
import {
  AccountingCapabilities,
  FinancialLedgerPort,
  makeFinancialLedgerTestLayer,
  makeFinancialOperationService,
  UnbalancedJournal,
} from "../mod.ts"

const databaseUrl = process.env["DATABASE_URL"]

// RULES.md has no ID for the balanced financial-journal rule yet; this pins it at the one-cent boundary.
it.effect.skipIf(databaseUrl === undefined)(
  "rejects a financial journal intent that is one cent out of balance and records no intent",
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
              values (${tenant!.id}, 'organization', 'Balance Boundary Organization') returning id
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

        const principal = { userAccountId: uuidv7(), sessionId: uuidv7() }

        const authorization = makeAuthorizationTestLayer([
          {
            userAccountId: principal.userAccountId,
            tenantId: tenant!.id,
            capability: AccountingCapabilities.journalPost,
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

        const service = yield* Effect.provide(
          makeFinancialOperationService,
          Layer.mergeAll(
            Layer.succeed(Database, database),
            authorization,
            Layer.succeed(MessagingService, messaging),
            Layer.succeed(DurableJobEnqueuer, jobs),
            Layer.succeed(SalesService, partial<SalesService>()({})),
            Layer.succeed(FinancialLedgerPort, ledger),
          ),
        )

        const intentFor = (operationId: string, credit: string) => ({
          principal,
          tenantId: tenant!.id,
          legalEntityId: legalEntity!.id,
          operationId,
          reference: `balance-boundary-${operationId}`,
          currency: "USD",
          mappingVersion: 1,
          lines: [
            { accountId: debitAccount!.id, debit: "10.00", credit: "0" },
            { accountId: creditAccount!.id, debit: "0", credit },
          ],
          correlationId: `balance-boundary-correlation-${operationId}`,
        })

        const countOperations = (operationId: string) =>
          Effect.promise(
            () =>
              client<{ count: number }[]>`
                select count(*)::int as count from accounting.financial_operations
                where tenant_id = ${tenant!.id} and operation_id = ${operationId}
              `,
          )

        const unbalancedId = `unbalanced-${uuidv7()}`

        const failure = yield* Effect.flip(
          service.createJournalIntent(intentFor(unbalancedId, "9.99")),
        )

        assert.instanceOf(failure, UnbalancedJournal)
        assert.strictEqual((yield* countOperations(unbalancedId))[0]!.count, 0)

        const balancedId = `balanced-${uuidv7()}`
        const balanced = yield* service.createJournalIntent(intentFor(balancedId, "10.00"))

        assert.strictEqual(balanced.status, "intent")
        assert.strictEqual((yield* countOperations(balancedId))[0]!.count, 1)
      }),
    ),
)
