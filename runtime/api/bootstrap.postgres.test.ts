import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { Database, uuidv7 } from "../../foundation/mod.ts"
import { AccountingService, makeAccountingService } from "../../modules/accounting/mod.ts"
import { AuthService, makeAuthService, TenantAlreadyExists } from "../../modules/auth/mod.ts"
import { AuthorizationService, makeAuthorizationService } from "../../modules/authorization/mod.ts"
import { makeUserAccountService, UserAccountService } from "../../modules/identity/mod.ts"
import { InventoryService, makeInventoryService } from "../../modules/inventory/mod.ts"
import { makeMessagingService, MessagingService } from "../../modules/messaging/mod.ts"
import { makePartyService, PartyService } from "../../modules/party/mod.ts"
import { makeSalesService, SalesService } from "../../modules/sales/mod.ts"
import { makePostgresDatabase, runMigrations, WebCryptoLive } from "../../platform/mod.ts"
import { withTemporaryDatabase } from "../../tests/support/postgres-database.ts"
import { bootstrapTenant } from "./bootstrap.ts"

const databaseUrl = process.env["DATABASE_URL"]

it.effect.skipIf(databaseUrl === undefined)(
  "bootstraps the tenant scope vertical slice against PostgreSQL",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const database = makePostgresDatabase(client)
        const databaseLayer = Layer.succeed(Database, database)
        const userAccountService = yield* Effect.provide(makeUserAccountService, databaseLayer)
        const userAccountRecord = yield* userAccountService.create({
          email: `bootstrap-${uuidv7()}@example.test`,
        })
        const principal = { userAccountId: userAccountRecord.id, sessionId: "bootstrap-session" }
        const authorization = yield* Effect.provide(makeAuthorizationService, databaseLayer)
        const authorizationLayer = Layer.succeed(AuthorizationService, authorization)
        const businessRequirements = Layer.merge(databaseLayer, authorizationLayer)
        const auth = yield* Effect.provide(
          makeAuthService,
          Layer.mergeAll(
            databaseLayer,
            WebCryptoLive,
            Layer.succeed(UserAccountService, userAccountService),
          ),
        )
        const party = yield* Effect.provide(makePartyService, businessRequirements)
        const messaging = yield* Effect.provide(makeMessagingService, databaseLayer)
        const messagingRequirements = Layer.merge(
          businessRequirements,
          Layer.succeed(MessagingService, messaging),
        )
        const sales = yield* Effect.provide(makeSalesService, messagingRequirements)
        const accounting = yield* Effect.provide(
          makeAccountingService,
          Layer.merge(messagingRequirements, Layer.succeed(SalesService, sales)),
        )
        const inventory = yield* Effect.provide(makeInventoryService, messagingRequirements)
        const services = Layer.mergeAll(
          Layer.succeed(AuthService, auth),
          authorizationLayer,
          Layer.succeed(PartyService, party),
          Layer.succeed(AccountingService, accounting),
          Layer.succeed(InventoryService, inventory),
        )
        const input = {
          principal,
          slug: `bootstrap-${uuidv7()}`,
          timezone: "UTC",
          organizationName: "Bootstrap Organization",
          branchName: "Main Branch",
          branchTimezone: "UTC",
          localTaxRegistration: "TAX-MAIN-001",
          dedicatedJournalCode: "MAIN-OPS",
          warehouseName: "Main Warehouse",
          baseCurrency: "USD",
          precision: 2,
          fiscalYearStartMonth: 1,
          postingEnabled: true,
        }

        const result = yield* Effect.provide(bootstrapTenant(input), services)

        assert.strictEqual(result.tenant.slug, input.slug)
        assert.strictEqual(result.organization.kind, "organization")
        assert.strictEqual(result.legalEntity.organizationId, result.organization.id)
        assert.strictEqual(result.branch.legalEntityId, result.legalEntity.id)
        assert.strictEqual(result.branch.localTaxRegistration, "TAX-MAIN-001")
        assert.strictEqual(result.branch.dedicatedJournalCode, "MAIN-OPS")
        assert.strictEqual(result.accountingConfiguration.legalEntityId, result.legalEntity.id)
        assert.strictEqual(result.warehouse.legalEntityId, result.legalEntity.id)
        assert.strictEqual(result.warehouse.primaryBranchId, result.branch.id)
        assert.instanceOf(
          yield* Effect.flip(Effect.provide(bootstrapTenant(input), services)),
          TenantAlreadyExists,
        )
      }),
    ),
)
