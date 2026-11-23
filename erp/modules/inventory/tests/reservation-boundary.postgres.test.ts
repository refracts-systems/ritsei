import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { Database, uuidv7 } from "../../../../framework/foundation/mod.ts"
import {
  makePostgresDatabase,
  runMigrations,
  WebCryptoLive,
} from "../../../../framework/platform/mod.ts"
import { withTemporaryDatabase } from "../../../../tests/support/postgres-database.ts"
import { makeAuthService } from "../../../../framework/modules/auth/mod.ts"
import {
  AuthorizationService,
  makeAuthorizationTestLayer,
} from "../../../../framework/modules/authorization/mod.ts"
import {
  makeUserAccountService,
  UserAccountService,
} from "../../../../framework/modules/identity/mod.ts"
import {
  makeMessagingService,
  MessagingService,
} from "../../../../framework/modules/messaging/mod.ts"
import { makePartyService, PartyCapabilities } from "../../party/mod.ts"
import { InventoryCapabilities, makeInventoryService, StockUnavailable } from "../mod.ts"

const databaseUrl = process.env["DATABASE_URL"]

const principal = { userAccountId: "inventory-reservation-boundary", sessionId: "session" }

const capabilities = [
  PartyCapabilities.partyCreate,
  PartyCapabilities.legalEntityCreate,
  PartyCapabilities.branchCreate,
  InventoryCapabilities.warehouseCreate,
  InventoryCapabilities.itemCreate,
  InventoryCapabilities.stockReceive,
  InventoryCapabilities.stockReserve,
] as const

// [INV-STOCK-1]
it.effect.skipIf(databaseUrl === undefined)(
  "refuses a reservation larger than available stock even when on-hand would cover it",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const database = makePostgresDatabase(client)

        const userAccountService = yield* makeUserAccountService.pipe(
          Effect.provideService(Database, database),
        )

        const auth = yield* makeAuthService.pipe(
          Effect.provideService(Database, database),
          Effect.provide(WebCryptoLive),
          Effect.provideService(UserAccountService, userAccountService),
        )

        const tenant = yield* auth.createTenant({ slug: `reserve-${uuidv7()}` })

        const authorizationLayer = makeAuthorizationTestLayer(
          capabilities.map((capability) => ({
            userAccountId: principal.userAccountId,
            tenantId: tenant.id,
            capability,
          })),
        )

        yield* Effect.gen(function* () {
          const authorization = yield* AuthorizationService

          const requirements = Layer.mergeAll(
            Layer.succeed(Database, database),
            Layer.succeed(AuthorizationService, authorization),
            Layer.effect(MessagingService, makeMessagingService).pipe(
              Layer.provide(Layer.succeed(Database, database)),
            ),
          )

          const party = yield* Effect.provide(makePartyService, requirements)

          const organization = yield* party.create({
            principal,
            tenantId: tenant.id,
            kind: "organization",
            name: "Reservation Organization",
          })

          const legalEntity = yield* party.createLegalEntity({
            principal,
            tenantId: tenant.id,
            organizationId: organization.id,
          })

          const inventory = yield* Effect.provide(makeInventoryService, requirements)

          const warehouse = yield* inventory.createWarehouse({
            principal,
            tenantId: tenant.id,
            legalEntityId: legalEntity.id,
            name: "Reservation Warehouse",
          })

          const item = yield* inventory.createItem({
            principal,
            tenantId: tenant.id,
            sku: "RESERVE",
            name: "Reservation Item",
            unitOfMeasure: "box",
          })

          yield* inventory.receiveStock({
            principal,
            tenantId: tenant.id,
            warehouseId: warehouse.id,
            itemId: item.id,
            quantity: "10",
          })

          const reservation = (quantity: string, idempotencyKey: string) => ({
            principal,
            tenantId: tenant.id,
            warehouseId: warehouse.id,
            itemId: item.id,
            quantity,
            idempotencyKey,
          })

          yield* inventory.reserveStock(reservation("8", "reserve-8"))

          const error = yield* Effect.flip(inventory.reserveStock(reservation("3", "reserve-3")))

          assert.instanceOf(error, StockUnavailable)

          const balances = yield* Effect.promise(
            () => client<{ on_hand: string; reserved: string }[]>`
              select on_hand::text, reserved::text
              from inventory.stock_balances
              where tenant_id = ${tenant.id}
            `,
          )

          assert.deepStrictEqual(balances, [{ on_hand: "10", reserved: "8" }])
        }).pipe(Effect.provide(authorizationLayer))
      }),
    ),
)
