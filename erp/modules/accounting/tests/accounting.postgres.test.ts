import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"

import { Database, DatabaseFailure, uuidv7 } from "../../../../framework/foundation/mod.ts"
import { makePostgresDatabase, runMigrations } from "../../../../framework/platform/mod.ts"
import { withTemporaryDatabase } from "../../../../tests/support/postgres-database.ts"
import {
  AuthorizationService,
  makeAuthorizationTestLayer,
} from "../../../../framework/modules/authorization/mod.ts"
import {
  makeMessagingService,
  MessagingService,
} from "../../../../framework/modules/messaging/mod.ts"
import { SalesService } from "../../sales/mod.ts"
import {
  AccountingCapabilities,
  AccountingPeriodNotOpen,
  AccountingRevenuePostedEvent,
  AccountNotFound,
  JournalIdempotencyConflict,
  makeAccountingService,
} from "../mod.ts"
import { partial } from "../../../../tests/support/partial.ts"
import { postgresCode, postgresConstraint } from "../../../../tests/support/postgres-error.ts"

const salesFacts = partial<SalesService>()({
  getConfirmedOrderTotal: () => Effect.succeed("10.00"),
})

const databaseUrl = process.env["DATABASE_URL"]

const postgresFailure = <A>(effect: () => Promise<A>) =>
  Effect.tryPromise({ try: effect, catch: (cause) => cause }).pipe(Effect.flip)

it.effect.skipIf(databaseUrl === undefined)(
  "enforces legal entity accounting configuration scope in PostgreSQL",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)

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
              values (${tenant!.id}, 'organization', 'Accounting Organization') returning id
            `,
        )
        const [legalEntity] = yield* Effect.promise(
          () =>
            client<{ id: string }[]>`
              insert into party.legal_entities (tenant_id, organization_party_id)
              values (${tenant!.id}, ${organization!.id}) returning id
            `,
        )

        const [configuration] = yield* Effect.promise(
          () =>
            client<
              {
                tenant_id: string
                legal_entity_id: string
                base_currency: string
                decimal_precision: number
                fiscal_year_start_month: number
                posting_enabled: boolean
              }[]
            >`
              insert into accounting.legal_entity_accounting_configurations
                (tenant_id, legal_entity_id, base_currency, decimal_precision,
                 fiscal_year_start_month, posting_enabled)
              values (${tenant!.id}, ${legalEntity!.id}, 'USD', 2, 1, true)
              returning tenant_id, legal_entity_id, base_currency, decimal_precision,
                fiscal_year_start_month, posting_enabled
            `,
        )
        assert.strictEqual(configuration!.tenant_id, tenant!.id)
        assert.strictEqual(configuration!.legal_entity_id, legalEntity!.id)
        assert.strictEqual(configuration!.base_currency, "USD")
        assert.strictEqual(configuration!.decimal_precision, 2)
        assert.strictEqual(configuration!.fiscal_year_start_month, 1)
        assert.strictEqual(configuration!.posting_enabled, true)

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
              update accounting.legal_entity_accounting_configurations
              set financial_engine = 'tigerbeetle'
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
        const engineDowngrade = yield* postgresFailure(
          () =>
            client`
              update accounting.legal_entity_accounting_configurations
              set financial_engine = 'postgresql'
              where tenant_id = ${tenant!.id} and legal_entity_id = ${legalEntity!.id}
            `,
        )
        assert.strictEqual(postgresCode(engineDowngrade), "23514")
        assert.strictEqual(
          postgresConstraint(engineDowngrade),
          "legal_entity_accounting_engine_downgrade_check",
        )

        const unsupportedPrecision = yield* postgresFailure(
          () =>
            client`
              update accounting.legal_entity_accounting_configurations
              set decimal_precision = 3
              where tenant_id = ${tenant!.id} and legal_entity_id = ${legalEntity!.id}
            `,
        )
        assert.strictEqual(postgresCode(unsupportedPrecision), "23514")
        assert.strictEqual(
          postgresConstraint(unsupportedPrecision),
          "legal_entity_accounting_configurations_precision_check",
        )

        const duplicate = yield* postgresFailure(
          () =>
            client`
              insert into accounting.legal_entity_accounting_configurations
                (tenant_id, legal_entity_id, base_currency, decimal_precision,
                 fiscal_year_start_month, posting_enabled)
              values (${tenant!.id}, ${legalEntity!.id}, 'USD', 2, 1, true)
            `,
        )
        assert.strictEqual(postgresCode(duplicate), "23505")
        assert.strictEqual(
          postgresConstraint(duplicate),
          "legal_entity_accounting_configurations_pkey",
        )

        const [otherTenant] = yield* Effect.promise(
          () =>
            client<{ id: string }[]>`
              insert into auth.tenants (slug) values (${uuidv7()}) returning id
            `,
        )
        const crossTenant = yield* postgresFailure(
          () =>
            client`
              insert into accounting.legal_entity_accounting_configurations
                (tenant_id, legal_entity_id, base_currency, decimal_precision,
                 fiscal_year_start_month, posting_enabled)
              values (${otherTenant!.id}, ${legalEntity!.id}, 'USD', 2, 1, true)
            `,
        )
        assert.strictEqual(postgresCode(crossTenant), "23503")
        assert.strictEqual(
          postgresConstraint(crossTenant),
          "legal_entity_accounting_configurations_legal_entity_fkey",
        )
      }),
    ),
)

it.effect.skipIf(databaseUrl === undefined)(
  "revenue posted atomic publication preserves metadata, replay, and rollback",
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
              values (${tenant!.id}, 'organization', 'Atomic Revenue Organization') returning id
            `,
        )
        const [legalEntity] = yield* Effect.promise(
          () =>
            client<{ id: string }[]>`
              insert into party.legal_entities (tenant_id, organization_party_id)
              values (${tenant!.id}, ${organization!.id}) returning id
            `,
        )
        const [otherTenant] = yield* Effect.promise(
          () =>
            client<{ id: string }[]>`
              insert into auth.tenants (slug) values (${uuidv7()}) returning id
            `,
        )
        const [otherOrganization] = yield* Effect.promise(
          () =>
            client<{ id: string }[]>`
              insert into party.parties (tenant_id, kind, name)
              values (${otherTenant!.id}, 'organization', 'Other Revenue Organization') returning id
            `,
        )
        const [otherLegalEntity] = yield* Effect.promise(
          () =>
            client<{ id: string }[]>`
              insert into party.legal_entities (tenant_id, organization_party_id)
              values (${otherTenant!.id}, ${otherOrganization!.id}) returning id
            `,
        )
        const accounts = yield* Effect.promise(
          () =>
            client<{ id: string }[]>`
              insert into accounting.accounts (tenant_id, code, name, type)
              values
                (${tenant!.id}, 'ATOMIC-RECEIVABLE', 'Receivable', 'asset'),
                (${tenant!.id}, 'ATOMIC-REVENUE', 'Revenue', 'revenue')
              returning id
            `,
        )
        yield* Effect.promise(
          () =>
            client`
              insert into accounting.legal_entity_accounting_configurations
                (tenant_id, legal_entity_id, base_currency, decimal_precision,
                 fiscal_year_start_month, posting_enabled)
              values (${tenant!.id}, ${legalEntity!.id}, 'USD', 2, 1, true)
            `,
        )
        yield* Effect.promise(
          () =>
            client`
              insert into accounting.revenue_posting_profiles
                (tenant_id, legal_entity_id, receivable_account_id, revenue_account_id)
              values (${tenant!.id}, ${legalEntity!.id}, ${accounts[0]!.id}, ${accounts[1]!.id})
            `,
        )
        yield* Effect.promise(
          () =>
            client`
              insert into accounting.accounting_periods
                (tenant_id, legal_entity_id, starts_on, ends_on)
              values (${tenant!.id}, ${legalEntity!.id}, '1900-01-01', '2100-12-31')
            `,
        )
        const otherAccounts = yield* Effect.promise(
          () =>
            client<{ id: string }[]>`
              insert into accounting.accounts (tenant_id, code, name, type)
              values
                (${otherTenant!.id}, 'ATOMIC-RECEIVABLE', 'Receivable', 'asset'),
                (${otherTenant!.id}, 'ATOMIC-REVENUE', 'Revenue', 'revenue')
              returning id
            `,
        )
        yield* Effect.promise(
          () =>
            client`
              insert into accounting.legal_entity_accounting_configurations
                (tenant_id, legal_entity_id, base_currency, decimal_precision,
                 fiscal_year_start_month, posting_enabled)
              values (${otherTenant!.id}, ${otherLegalEntity!.id}, 'USD', 2, 1, true)
            `,
        )
        yield* Effect.promise(
          () =>
            client`
              insert into accounting.revenue_posting_profiles
                (tenant_id, legal_entity_id, receivable_account_id, revenue_account_id)
              values (${otherTenant!.id}, ${otherLegalEntity!.id}, ${otherAccounts[0]!.id}, ${
                otherAccounts[1]!.id
              })
            `,
        )
        yield* Effect.promise(
          () =>
            client`
              insert into accounting.accounting_periods
                (tenant_id, legal_entity_id, starts_on, ends_on)
              values (${otherTenant!.id}, ${otherLegalEntity!.id}, '1900-01-01', '2100-12-31')
            `,
        )
        const principal = { userAccountId: "accounting-atomic", sessionId: "session" }
        const authorizationLayer = makeAuthorizationTestLayer([
          {
            userAccountId: principal.userAccountId,
            tenantId: tenant!.id,
            capability: AccountingCapabilities.revenuePost,
          },
          {
            userAccountId: principal.userAccountId,
            tenantId: otherTenant!.id,
            capability: AccountingCapabilities.revenuePost,
          },
          {
            userAccountId: principal.userAccountId,
            tenantId: otherTenant!.id,
            capability: AccountingCapabilities.revenueConfigure,
          },
          {
            userAccountId: principal.userAccountId,
            tenantId: otherTenant!.id,
            capability: AccountingCapabilities.revenueReverse,
          },
          {
            userAccountId: principal.userAccountId,
            tenantId: tenant!.id,
            capability: AccountingCapabilities.revenueReverse,
          },
        ])

        yield* Effect.gen(function* () {
          const authorization = yield* AuthorizationService
          const messaging = yield* makeMessagingService.pipe(
            Effect.provideService(Database, database),
          )
          const requirements = Layer.mergeAll(
            Layer.succeed(Database, database),
            Layer.succeed(AuthorizationService, authorization),
            Layer.succeed(MessagingService, messaging),
            Layer.succeed(SalesService, salesFacts),
          )
          const accounting = yield* Effect.provide(makeAccountingService, requirements)
          const input = {
            principal,
            tenantId: tenant!.id,
            legalEntityId: legalEntity!.id,
            orderId: uuidv7(),
            amount: "10.00",
            commandId: "revenue-command-atomic",
            correlationId: "revenue-correlation-atomic",
            causationId: "order-confirmed-atomic",
          }
          assert.instanceOf(
            yield* Effect.flip(
              accounting.configureRevenuePosting({
                principal,
                tenantId: otherTenant!.id,
                legalEntityId: otherLegalEntity!.id,
                receivableAccountId: accounts[0]!.id,
                revenueAccountId: accounts[1]!.id,
              }),
            ),
            AccountNotFound,
          )
          const [journal, concurrent] = yield* Effect.all(
            [accounting.postRevenueForOrder(input), accounting.postRevenueForOrder(input)],
            { concurrency: "unbounded" },
          )
          assert.strictEqual(concurrent.id, journal.id)
          const otherJournal = yield* accounting.postRevenueForOrder({
            ...input,
            tenantId: otherTenant!.id,
            legalEntityId: otherLegalEntity!.id,
            commandId: "other-revenue-command-atomic",
            correlationId: "other-revenue-correlation-atomic",
          })
          assert.notStrictEqual(otherJournal.id, journal.id)
          assert.strictEqual(otherJournal.tenantId, otherTenant!.id)
          assert.strictEqual(otherJournal.lines[0]?.accountId, otherAccounts[0]!.id)
          assert.notStrictEqual(otherAccounts[0]!.id, accounts[0]!.id)
          const otherReversal = yield* accounting.reverseRevenueForOrder({
            principal,
            tenantId: otherTenant!.id,
            legalEntityId: otherLegalEntity!.id,
            orderId: input.orderId,
          })
          assert.strictEqual(otherReversal.status, "reversed")
          assert.notStrictEqual(otherReversal.id, otherJournal.id)
          const replay = yield* accounting.postRevenueForOrder({
            ...input,
            commandId: "revenue-command-retry",
            correlationId: "revenue-correlation-retry",
          })
          assert.strictEqual(replay.id, journal.id)
          const [reversal, concurrentReversal] = yield* Effect.all(
            [
              accounting.reverseRevenueForOrder({
                principal,
                tenantId: tenant!.id,
                legalEntityId: legalEntity!.id,
                orderId: input.orderId,
              }),
              accounting.reverseRevenueForOrder({
                principal,
                tenantId: tenant!.id,
                legalEntityId: legalEntity!.id,
                orderId: input.orderId,
              }),
            ],
            { concurrency: "unbounded" },
          )
          assert.strictEqual(concurrentReversal.id, reversal.id)
          assert.strictEqual(reversal.status, "reversed")
          const corruptReversalOrderId = uuidv7()
          const [corruptReversal] = yield* Effect.promise(
            () =>
              client<{ id: string }[]>`
                insert into accounting.journal_entries (tenant_id, reference)
                values (${tenant!.id}, ${`revenue-reversal:${
                  legalEntity!.id
                }:${corruptReversalOrderId}`})
                returning id
              `,
          )
          assert.notStrictEqual(corruptReversal?.id, undefined)
          yield* Effect.promise(
            () =>
              client`
                insert into accounting.journal_lines
                  (tenant_id, entry_id, account_id, debit, credit)
                values
                  (${tenant!.id}, ${corruptReversal!.id}, ${accounts[0]!.id}, 1.00, 0),
                  (${tenant!.id}, ${corruptReversal!.id}, ${accounts[1]!.id}, 0, 1.00)
              `,
          )
          yield* Effect.promise(
            () =>
              client`
                update accounting.journal_entries
                set status = 'reversed', reverses_entry_id = ${journal.id}, posted_at = now()
                where tenant_id = ${tenant!.id} and id = ${corruptReversal!.id}
              `,
          )
          assert.instanceOf(
            yield* Effect.flip(
              accounting.reverseRevenueForOrder({
                principal,
                tenantId: tenant!.id,
                legalEntityId: legalEntity!.id,
                orderId: corruptReversalOrderId,
              }),
            ),
            JournalIdempotencyConflict,
          )
          const mismatchedReversalOrderId = uuidv7()
          const [mismatchedSource] = yield* Effect.promise(
            () =>
              client<{ id: string }[]>`
                insert into accounting.journal_entries (tenant_id, reference)
                values (${tenant!.id}, ${`revenue:${legalEntity!.id}:${mismatchedReversalOrderId}`})
                returning id
              `,
          )
          yield* Effect.promise(
            () =>
              client`
                insert into accounting.journal_lines
                  (tenant_id, entry_id, account_id, debit, credit)
                values
                  (${tenant!.id}, ${mismatchedSource!.id}, ${accounts[0]!.id}, 1.00, 0),
                  (${tenant!.id}, ${mismatchedSource!.id}, ${accounts[1]!.id}, 0, 1.00)
              `,
          )
          yield* Effect.promise(
            () =>
              client`
                update accounting.journal_entries
                set status = 'posted', posted_at = now()
                where tenant_id = ${tenant!.id} and id = ${mismatchedSource!.id}
              `,
          )
          const [mismatchedReversal] = yield* Effect.promise(
            () =>
              client<{ id: string }[]>`
                insert into accounting.journal_entries (tenant_id, reference)
                values (${tenant!.id}, ${`revenue-reversal:${
                  legalEntity!.id
                }:${mismatchedReversalOrderId}`})
                returning id
              `,
          )
          yield* Effect.promise(
            () =>
              client`
                insert into accounting.journal_lines
                  (tenant_id, entry_id, account_id, debit, credit)
                values
                  (${tenant!.id}, ${mismatchedReversal!.id}, ${accounts[0]!.id}, 1.00, 0),
                  (${tenant!.id}, ${mismatchedReversal!.id}, ${accounts[1]!.id}, 0, 1.00)
              `,
          )
          yield* Effect.promise(
            () =>
              client`
                update accounting.journal_entries
                set status = 'reversed', reverses_entry_id = ${
                  mismatchedSource!.id
                }, posted_at = now()
                where tenant_id = ${tenant!.id} and id = ${mismatchedReversal!.id}
              `,
          )
          assert.instanceOf(
            yield* Effect.flip(
              accounting.reverseRevenueForOrder({
                principal,
                tenantId: tenant!.id,
                legalEntityId: legalEntity!.id,
                orderId: mismatchedReversalOrderId,
              }),
            ),
            JournalIdempotencyConflict,
          )
          const draftReversalOrderId = uuidv7()
          yield* Effect.promise(
            () =>
              client`
                insert into accounting.journal_entries (tenant_id, reference)
                values (${tenant!.id}, ${`revenue-reversal:${
                  legalEntity!.id
                }:${draftReversalOrderId}`})
              `,
          )
          assert.instanceOf(
            yield* Effect.flip(
              accounting.reverseRevenueForOrder({
                principal,
                tenantId: tenant!.id,
                legalEntityId: legalEntity!.id,
                orderId: draftReversalOrderId,
              }),
            ),
            JournalIdempotencyConflict,
          )
          const corruptRevenueOrderId = uuidv7()
          const [corruptRevenue] = yield* Effect.promise(
            () =>
              client<{ id: string }[]>`
                insert into accounting.journal_entries (tenant_id, reference)
                values (${tenant!.id}, ${`revenue:${legalEntity!.id}:${corruptRevenueOrderId}`})
                returning id
              `,
          )
          yield* Effect.promise(
            () =>
              client`
                insert into accounting.journal_lines
                  (tenant_id, entry_id, account_id, debit, credit)
                values
                  (${tenant!.id}, ${corruptRevenue!.id}, ${accounts[1]!.id}, 10.00, 0),
                  (${tenant!.id}, ${corruptRevenue!.id}, ${accounts[0]!.id}, 0, 10.00)
              `,
          )
          yield* Effect.promise(
            () =>
              client`
                update accounting.journal_entries
                set status = 'posted', posted_at = now()
                where tenant_id = ${tenant!.id} and id = ${corruptRevenue!.id}
              `,
          )
          assert.instanceOf(
            yield* Effect.flip(
              accounting.postRevenueForOrder({
                ...input,
                orderId: corruptRevenueOrderId,
                commandId: "revenue-corrupt-command",
                correlationId: "revenue-corrupt-correlation",
              }),
            ),
            JournalIdempotencyConflict,
          )
          const draftOrderId = uuidv7()
          yield* Effect.promise(
            () =>
              client`
                insert into accounting.journal_entries (tenant_id, reference)
                values (${tenant!.id}, ${`revenue:${legalEntity!.id}:${draftOrderId}`})
              `,
          )
          assert.instanceOf(
            yield* Effect.flip(
              accounting.postRevenueForOrder({
                ...input,
                orderId: draftOrderId,
                commandId: "revenue-draft-command",
                correlationId: "revenue-draft-correlation",
              }),
            ),
            JournalIdempotencyConflict,
          )

          const events = yield* Effect.promise(
            () =>
              client<
                {
                  id: string
                  event_type: string
                  event_version: number
                  aggregate_type: string
                  aggregate_id: string
                  command_id: string
                  correlation_id: string
                  causation_id: string | null
                  idempotency_key: string
                  actor_principal_id: string
                  occurred_at: string
                  payload: unknown
                }[]
              >`
                select id, event_type, event_version, aggregate_type, aggregate_id,
                  command_id, correlation_id, causation_id, idempotency_key,
                  actor_principal_id, occurred_at, payload
                from messaging.event_outbox
                where tenant_id = ${tenant!.id}
                  and event_type = ${AccountingRevenuePostedEvent.id}
              `,
          )
          assert.strictEqual(events.length, 1)
          const otherEvents = yield* Effect.promise(
            () =>
              client<{ id: string; idempotency_key: string }[]>`
                select id, idempotency_key
                from messaging.event_outbox
                where tenant_id = ${otherTenant!.id}
                  and event_type = ${AccountingRevenuePostedEvent.id}
              `,
          )
          assert.strictEqual(otherEvents.length, 1)
          assert.strictEqual(otherEvents[0]?.idempotency_key, input.orderId)
          assert.notStrictEqual(otherEvents[0]?.id, events[0]?.id)
          yield* Schema.decodeUnknownEffect(AccountingRevenuePostedEvent.payloadSchema)(
            events[0]?.payload,
          )
          assert.notStrictEqual(events[0]?.id, journal.id)
          assert.deepStrictEqual(events[0], {
            id: events[0]!.id,
            event_type: AccountingRevenuePostedEvent.id,
            event_version: AccountingRevenuePostedEvent.version,
            aggregate_type: AccountingRevenuePostedEvent.aggregateType,
            aggregate_id: journal.id,
            command_id: input.commandId,
            correlation_id: input.correlationId,
            causation_id: input.causationId,
            idempotency_key: input.orderId,
            actor_principal_id: principal.userAccountId,
            occurred_at: events[0]!.occurred_at,
            payload: {
              journalId: journal.id,
              legalEntityId: legalEntity!.id,
              orderId: input.orderId,
            },
          })
          assert.strictEqual(
            new Set([
              events[0]!.command_id,
              events[0]!.correlation_id,
              events[0]!.causation_id,
              events[0]!.idempotency_key,
            ]).size,
            4,
          )
          const replayedWithTamperedAmount = yield* accounting.postRevenueForOrder({
            ...input,
            amount: "99.99",
            commandId: "tampered-replay-command",
            correlationId: "tampered-replay-correlation",
          })
          assert.strictEqual(replayedWithTamperedAmount.id, journal.id)
          assert.strictEqual(replayedWithTamperedAmount.lines[0]?.debit, "10.00")
          assert.strictEqual(replayedWithTamperedAmount.lines[1]?.credit, "10.00")
          const tamperedJournal = yield* accounting.postRevenueForOrder({
            ...input,
            orderId: uuidv7(),
            amount: "99.99",
            commandId: "tampered-revenue-command",
            correlationId: "tampered-revenue-correlation",
          })
          assert.deepStrictEqual(
            tamperedJournal.lines.map(({ debit, credit }) => ({ debit, credit })),
            [
              { debit: "10.00", credit: "0" },
              { debit: "0", credit: "10.00" },
            ],
          )

          const failingAccounting = yield* Effect.provide(
            makeAccountingService,
            Layer.mergeAll(
              Layer.succeed(Database, database),
              Layer.succeed(AuthorizationService, authorization),
              Layer.succeed(MessagingService, {
                ...messaging,
                append: () =>
                  Effect.fail(
                    new DatabaseFailure({ operation: "messaging.test.append", cause: null }),
                  ),
              }),
              Layer.succeed(SalesService, salesFacts),
            ),
          )
          assert.instanceOf(
            yield* Effect.flip(
              failingAccounting.postRevenueForOrder({
                ...input,
                orderId: uuidv7(),
                commandId: "revenue-command-rollback",
                correlationId: "revenue-correlation-rollback",
              }),
            ),
            DatabaseFailure,
          )
          const [rolledBack] = yield* Effect.promise(
            () =>
              client<{ journals: string; lines: string; events: string }[]>`
                select
                  (select count(*)::text from accounting.journal_entries
                    where tenant_id = ${tenant!.id}
                      and reference = ${`revenue:${
                        legalEntity!.id
                      }:revenue-order-rollback`}) as journals,
                  (select count(*)::text from accounting.journal_lines l
                    join accounting.journal_entries j on j.id = l.entry_id
                    where j.tenant_id = ${tenant!.id}
                      and j.reference = ${`revenue:${
                        legalEntity!.id
                      }:revenue-order-rollback`}) as lines,
                  (select count(*)::text from messaging.event_outbox
                    where tenant_id = ${tenant!.id}
                      and idempotency_key = 'revenue-order-rollback') as events
              `,
          )
          assert.deepStrictEqual(rolledBack, { journals: "0", lines: "0", events: "0" })
        }).pipe(Effect.provide(authorizationLayer))
      }),
    ),
)

it.effect.skipIf(databaseUrl === undefined)(
  "serializes period close with revenue posting and rejects later closed period posting",
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
              values (${tenant!.id}, 'organization', 'Accounting Service Organization') returning id
            `,
        )
        const [legalEntity] = yield* Effect.promise(
          () =>
            client<{ id: string }[]>`
              insert into party.legal_entities (tenant_id, organization_party_id)
              values (${tenant!.id}, ${organization!.id}) returning id
            `,
        )
        const accounts = yield* Effect.promise(
          () =>
            client<{ id: string }[]>`
              insert into accounting.accounts (tenant_id, code, name, type)
              values
                (${tenant!.id}, 'RECEIVABLE', 'Receivable', 'asset'),
                (${tenant!.id}, 'REVENUE', 'Revenue', 'revenue')
              returning id
            `,
        )
        yield* Effect.promise(
          () =>
            client`
              insert into accounting.legal_entity_accounting_configurations
                (tenant_id, legal_entity_id, base_currency, decimal_precision,
                 fiscal_year_start_month, posting_enabled)
              values (${tenant!.id}, ${legalEntity!.id}, 'USD', 2, 1, true)
            `,
        )
        yield* Effect.promise(
          () =>
            client`
              insert into accounting.revenue_posting_profiles
                (tenant_id, legal_entity_id, receivable_account_id, revenue_account_id)
              values (${tenant!.id}, ${legalEntity!.id}, ${accounts[0]!.id}, ${accounts[1]!.id})
            `,
        )
        const [period] = yield* Effect.promise(
          () =>
            client<{ id: string }[]>`
              insert into accounting.accounting_periods
                (tenant_id, legal_entity_id, starts_on, ends_on)
              values (${tenant!.id}, ${legalEntity!.id}, '1900-01-01', '2100-12-31')
              returning id
            `,
        )
        const principal = { userAccountId: "accounting-service", sessionId: "session" }
        const authorizationLayer = makeAuthorizationTestLayer(
          [AccountingCapabilities.periodClose, AccountingCapabilities.revenuePost].map(
            (capability) => ({
              userAccountId: principal.userAccountId,
              tenantId: tenant!.id,
              capability,
            }),
          ),
        )

        yield* Effect.gen(function* () {
          const authorization = yield* AuthorizationService
          const messaging = yield* makeMessagingService.pipe(
            Effect.provideService(Database, database),
          )
          const accounting = yield* Effect.provide(
            makeAccountingService,
            Layer.mergeAll(
              Layer.succeed(Database, database),
              Layer.succeed(AuthorizationService, authorization),
              Layer.succeed(MessagingService, messaging),
              Layer.succeed(SalesService, salesFacts),
            ),
          )
          const [closeResult, postResult] = yield* Effect.all(
            [
              accounting
                .closePeriod({
                  principal,
                  tenantId: tenant!.id,
                  legalEntityId: legalEntity!.id,
                  periodId: period!.id,
                })
                .pipe(Effect.result),
              accounting
                .postRevenueForOrder({
                  principal,
                  tenantId: tenant!.id,
                  legalEntityId: legalEntity!.id,
                  orderId: uuidv7(),
                  amount: "10.00",
                  commandId: "concurrent-command",
                  correlationId: "concurrent-correlation",
                  causationId: null,
                })
                .pipe(Effect.result),
            ],
            { concurrency: "unbounded" },
          )

          assert.isTrue(Result.isSuccess(closeResult))
          if (Result.isFailure(postResult)) {
            assert.instanceOf(postResult.failure, AccountingPeriodNotOpen)
          } else {
            assert.strictEqual(postResult.success.status, "posted")
          }
          assert.instanceOf(
            yield* Effect.flip(
              accounting.postRevenueForOrder({
                principal,
                tenantId: tenant!.id,
                legalEntityId: legalEntity!.id,
                orderId: uuidv7(),
                amount: "10.00",
                commandId: "after-close-command",
                correlationId: "after-close-correlation",
                causationId: null,
              }),
            ),
            AccountingPeriodNotOpen,
          )
        }).pipe(Effect.provide(authorizationLayer))
      }),
    ),
)

it.effect.skipIf(databaseUrl === undefined)(
  "enforces balanced and immutable posted journals in PostgreSQL",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)

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
              values (${tenant!.id}, 'organization', 'Accounting State Organization') returning id
            `,
        )
        const [legalEntity] = yield* Effect.promise(
          () =>
            client<{ id: string }[]>`
              insert into party.legal_entities (tenant_id, organization_party_id)
              values (${tenant!.id}, ${organization!.id}) returning id
            `,
        )
        const invalidPeriodInsert = yield* postgresFailure(
          () =>
            client`
              insert into accounting.accounting_periods
                (tenant_id, legal_entity_id, starts_on, ends_on, status)
              values (${tenant!.id}, ${legalEntity!.id}, '2026-01-01', '2026-12-31', 'closed')
            `,
        )
        assert.strictEqual(postgresCode(invalidPeriodInsert), "23514")
        assert.strictEqual(
          postgresConstraint(invalidPeriodInsert),
          "accounting_period_state_transition_check",
        )
        const [period] = yield* Effect.promise(
          () =>
            client<{ id: string }[]>`
              insert into accounting.accounting_periods
                (tenant_id, legal_entity_id, starts_on, ends_on)
              values (${tenant!.id}, ${legalEntity!.id}, '2026-01-01', '2026-12-31')
              returning id
            `,
        )
        yield* Effect.promise(
          () =>
            client`
              update accounting.accounting_periods set status = 'closed'
              where id = ${period!.id}
            `,
        )
        const reopenedPeriod = yield* postgresFailure(
          () =>
            client`
              update accounting.accounting_periods set status = 'open'
              where id = ${period!.id}
            `,
        )
        assert.strictEqual(postgresCode(reopenedPeriod), "23514")
        assert.strictEqual(
          postgresConstraint(reopenedPeriod),
          "accounting_period_state_transition_check",
        )
        const accounts = yield* Effect.promise(
          () =>
            client<{ id: string }[]>`
              insert into accounting.accounts (tenant_id, code, name, type)
              values
                (${tenant!.id}, 'CASH', 'Cash', 'asset'),
                (${tenant!.id}, 'REVENUE', 'Revenue', 'revenue')
              returning id
            `,
        )
        const invalidJournalInsert = yield* postgresFailure(
          () =>
            client`
              insert into accounting.journal_entries
                (tenant_id, reference, status, posted_at)
              values (${tenant!.id}, 'INVALID-INITIAL-JOURNAL', 'posted', now())
            `,
        )
        assert.strictEqual(postgresCode(invalidJournalInsert), "23514")
        assert.strictEqual(
          postgresConstraint(invalidJournalInsert),
          "accounting_journal_state_transition_check",
        )
        const blankReference = yield* postgresFailure(
          () =>
            client`
              insert into accounting.journal_entries (tenant_id, reference)
              values (${tenant!.id}, '   ')
            `,
        )
        assert.strictEqual(postgresCode(blankReference), "23514")
        assert.strictEqual(postgresConstraint(blankReference), "journal_entries_reference_check")
        const [source] = yield* Effect.promise(
          () =>
            client<{ id: string }[]>`
              insert into accounting.journal_entries (tenant_id, reference)
              values (${tenant!.id}, 'REVERSAL-SOURCE') returning id
            `,
        )
        const invalidReversalState = yield* postgresFailure(
          () =>
            client`
              insert into accounting.journal_entries
                (tenant_id, reference, reverses_entry_id)
              values (${tenant!.id}, 'INVALID-REVERSAL-STATE', ${source!.id})
            `,
        )
        assert.strictEqual(postgresCode(invalidReversalState), "23514")
        assert.strictEqual(
          postgresConstraint(invalidReversalState),
          "journal_entries_reversal_state_check",
        )
        const [unpostedReversal] = yield* Effect.promise(
          () =>
            client<{ id: string }[]>`
              insert into accounting.journal_entries (tenant_id, reference)
              values (${tenant!.id}, 'UNPOSTED-REVERSAL') returning id
            `,
        )
        const unpostedSourceReversal = yield* postgresFailure(
          () =>
            client`
              update accounting.journal_entries
              set status = 'reversed', posted_at = now(), reverses_entry_id = ${source!.id}
              where tenant_id = ${tenant!.id} and id = ${unpostedReversal!.id}
            `,
        )
        assert.strictEqual(postgresCode(unpostedSourceReversal), "23514")
        assert.strictEqual(
          postgresConstraint(unpostedSourceReversal),
          "journal_entries_reversal_source_check",
        )
        const selfReversalState = yield* postgresFailure(
          () =>
            client`
              update accounting.journal_entries
              set status = 'reversed', posted_at = now(), reverses_entry_id = ${source!.id}
              where tenant_id = ${tenant!.id} and id = ${source!.id}
            `,
        )
        assert.strictEqual(postgresCode(selfReversalState), "23514")
        assert.strictEqual(
          postgresConstraint(selfReversalState),
          "journal_entries_reversal_state_check",
        )

        const unbalanced = yield* postgresFailure(() =>
          client.begin(async (transaction) => {
            const [entry] = await transaction<{ id: string }[]>`
                insert into accounting.journal_entries (tenant_id, reference)
                values (${tenant!.id}, 'UNBALANCED') returning id
              `
            await transaction`
                insert into accounting.journal_lines
                  (tenant_id, entry_id, account_id, debit, credit)
                values (${tenant!.id}, ${entry!.id}, ${accounts[0]!.id}, 10, 0)
              `
            await transaction`
                update accounting.journal_entries
                set status = 'posted', posted_at = now()
                where id = ${entry!.id}
              `
          }),
        )
        assert.strictEqual(postgresCode(unbalanced), "23514")
        assert.strictEqual(postgresConstraint(unbalanced), "journal_entries_balanced_check")

        const [posted] = yield* Effect.promise(() =>
          client.begin(async (transaction) => {
            const [entry] = await transaction<{ id: string }[]>`
                insert into accounting.journal_entries (tenant_id, reference)
                values (${tenant!.id}, 'POSTED') returning id
              `
            await transaction`
                insert into accounting.journal_lines
                  (tenant_id, entry_id, account_id, debit, credit)
                values
                  (${tenant!.id}, ${entry!.id}, ${accounts[0]!.id}, 10, 0),
                  (${tenant!.id}, ${entry!.id}, ${accounts[1]!.id}, 0, 10)
              `
            await transaction`
                update accounting.journal_entries
                set status = 'posted', posted_at = now()
                where id = ${entry!.id}
              `
            return [entry]
          }),
        )
        const immutable = yield* postgresFailure(
          () =>
            client`
              update accounting.journal_lines
              set debit = 20
              where entry_id = ${posted!.id} and debit > 0
            `,
        )
        assert.strictEqual(postgresCode(immutable), "55000")
        assert.strictEqual(
          postgresConstraint(immutable),
          "accounting_posted_journal_lines_immutable",
        )

        const [draft] = yield* Effect.promise(
          () =>
            client<{ id: string }[]>`
              insert into accounting.journal_entries (tenant_id, reference)
              values (${tenant!.id}, 'DRAFT-LINE') returning id
            `,
        )
        yield* Effect.promise(
          () =>
            client`
              insert into accounting.journal_lines
                (tenant_id, entry_id, account_id, debit, credit)
              values (${tenant!.id}, ${draft!.id}, ${accounts[0]!.id}, 1, 0)
            `,
        )
        const reparented = yield* postgresFailure(
          () =>
            client`
              update accounting.journal_lines
              set entry_id = ${posted!.id}
              where entry_id = ${draft!.id}
            `,
        )
        assert.strictEqual(postgresCode(reparented), "55000")
        assert.strictEqual(
          postgresConstraint(reparented),
          "accounting_posted_journal_lines_immutable",
        )

        const inserted = yield* postgresFailure(
          () =>
            client`
              insert into accounting.journal_lines
                (tenant_id, entry_id, account_id, debit, credit)
              values (${tenant!.id}, ${posted!.id}, ${accounts[0]!.id}, 1, 0)
            `,
        )
        assert.strictEqual(postgresCode(inserted), "55000")
        assert.strictEqual(
          postgresConstraint(inserted),
          "accounting_posted_journal_lines_immutable",
        )

        const entryMutation = yield* postgresFailure(
          () =>
            client`
              update accounting.journal_entries
              set reference = 'POSTED-CHANGED'
              where id = ${posted!.id}
            `,
        )
        assert.strictEqual(postgresCode(entryMutation), "55000")
        assert.strictEqual(postgresConstraint(entryMutation), "accounting_posted_journal_immutable")
      }),
    ),
)

it.effect.skipIf(databaseUrl === undefined)("rejects journal reversal cycles in PostgreSQL", () =>
  withTemporaryDatabase(databaseUrl!, (client) =>
    Effect.gen(function* () {
      yield* runMigrations(client)

      const [tenant] = yield* Effect.promise(
        () =>
          client<{ id: string }[]>`
              insert into auth.tenants (slug) values (${uuidv7()}) returning id
            `,
      )
      const accounts = yield* Effect.promise(
        () =>
          client<{ id: string }[]>`
              insert into accounting.accounts (tenant_id, code, name, type)
              values
                (${tenant!.id}, 'CYCLE-DEBIT', 'Cycle Debit', 'asset'),
                (${tenant!.id}, 'CYCLE-CREDIT', 'Cycle Credit', 'revenue')
              returning id
            `,
      )
      const entries = yield* Effect.promise(() =>
        client.begin(async (transaction) => {
          const [first] = await transaction<{ id: string }[]>`
                insert into accounting.journal_entries (tenant_id, reference)
                values (${tenant!.id}, 'REVERSAL-CYCLE-A') returning id
              `
          const [second] = await transaction<{ id: string }[]>`
                insert into accounting.journal_entries (tenant_id, reference)
                values (${tenant!.id}, 'REVERSAL-CYCLE-B') returning id
              `
          await transaction`
                insert into accounting.journal_lines
                  (tenant_id, entry_id, account_id, debit, credit)
                values
                  (${tenant!.id}, ${first!.id}, ${accounts[0]!.id}, 1, 0),
                  (${tenant!.id}, ${first!.id}, ${accounts[1]!.id}, 0, 1),
                  (${tenant!.id}, ${second!.id}, ${accounts[0]!.id}, 1, 0),
                  (${tenant!.id}, ${second!.id}, ${accounts[1]!.id}, 0, 1)
              `
          await transaction`
                update accounting.journal_entries
                set status = 'posted', posted_at = now()
                where tenant_id = ${tenant!.id} and id = ${second!.id}
              `
          return { reversalId: first!.id, sourceId: second!.id }
        }),
      )

      yield* Effect.promise(
        () =>
          client`
              update accounting.journal_entries
              set status = 'reversed', posted_at = now(), reverses_entry_id = ${entries.sourceId}
              where tenant_id = ${tenant!.id} and id = ${entries.reversalId}
            `,
      )

      const [reversalState] = yield* Effect.promise(
        () =>
          client<{ status: string; reverses_entry_id: string | null }[]>`
              select status, reverses_entry_id
              from accounting.journal_entries
              where tenant_id = ${tenant!.id} and id = ${entries.reversalId}
            `,
      )
      assert.deepStrictEqual(reversalState, {
        status: "reversed",
        reverses_entry_id: entries.sourceId,
      })

      const cycle = yield* postgresFailure(
        () =>
          client`
              update accounting.journal_entries
              set status = 'reversed', posted_at = now(), reverses_entry_id = ${entries.reversalId}
              where tenant_id = ${tenant!.id} and id = ${entries.sourceId}
            `,
      )
      assert.strictEqual(postgresCode(cycle), "23514")
      assert.strictEqual(postgresConstraint(cycle), "journal_entries_reversal_source_check")

      const [state] = yield* Effect.promise(
        () =>
          client<{ status: string; reverses_entry_id: string | null }[]>`
              select status, reverses_entry_id
              from accounting.journal_entries
              where tenant_id = ${tenant!.id} and id = ${entries.sourceId}
            `,
      )
      assert.deepStrictEqual(state, { status: "posted", reverses_entry_id: null })
    }),
  ),
)
