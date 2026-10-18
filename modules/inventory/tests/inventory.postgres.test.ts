import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import type { Sql } from "postgres"

import { Database, DatabaseFailure, uuidv7 } from "../../../foundation/mod.ts"
import { makePostgresDatabase, runMigrations, WebCryptoLive } from "../../../platform/mod.ts"
import { withTemporaryDatabase } from "../../../tests/support/postgres-database.ts"
import { makeAuthService } from "../../auth/mod.ts"
import { AuthorizationService, makeAuthorizationTestLayer } from "../../authorization/mod.ts"
import { makeUserAccountService, UserAccountService } from "../../identity/mod.ts"
import { makeMessagingService, MessagingService } from "../../messaging/mod.ts"
import { makePartyService, PartyCapabilities, PartyService } from "../../party/mod.ts"
import {
  InventoryCapabilities,
  InventoryStockCorrectedEvent,
  makeInventoryService,
  StockCorrectionIdempotencyConflict,
  StockReservationIdempotencyConflict,
  StockReservationLegalEntityMismatch,
  StockReservationNotFound,
  StockTransferDifferentLegalEntity,
  StockTransferItemNotFound,
  StockTransferNotFound,
  StockTransferWarehouseNotFound,
  StockUnavailable,
  WarehouseBranchNotFound,
} from "../mod.ts"

const databaseUrl = process.env["DATABASE_URL"]
const postgresFailure = (effect: () => Promise<unknown>) =>
  Effect.tryPromise({ try: effect, catch: (cause) => cause }).pipe(Effect.flip)
const principal = { userAccountId: "inventory-transfer-integration", sessionId: "session" }
const capabilities = [
  PartyCapabilities.partyCreate,
  PartyCapabilities.legalEntityCreate,
  PartyCapabilities.branchCreate,
  InventoryCapabilities.warehouseCreate,
  InventoryCapabilities.itemCreate,
  InventoryCapabilities.stockReceive,
  InventoryCapabilities.stockAdjust,
  InventoryCapabilities.stockReserve,
  InventoryCapabilities.stockRelease,
  InventoryCapabilities.stockFulfill,
  InventoryCapabilities.stockTransferCreate,
  InventoryCapabilities.stockTransferConfirm,
  InventoryCapabilities.stockTransferComplete,
] as const

type BalanceRow = {
  readonly warehouse_id: string
  readonly item_id: string
  readonly on_hand: string
  readonly reserved: string
}

const readBalances = (client: Sql, tenantId: string) =>
  client<BalanceRow[]>`
    select warehouse_id, item_id, on_hand::text, reserved::text
    from inventory.stock_balances
    where tenant_id = ${tenantId}
    order by warehouse_id, item_id
  `

const createLegalEntityScope = (tenantId: string, name: string) =>
  Effect.gen(function* () {
    const party = yield* PartyService
    const organization = yield* party.create({
      principal,
      tenantId,
      kind: "organization",
      name: `${name} Organization`,
    })
    const legalEntity = yield* party.createLegalEntity({
      principal,
      tenantId,
      organizationId: organization.id,
    })
    const branch = yield* party.createBranch({
      principal,
      tenantId,
      legalEntityId: legalEntity.id,
      name: `${name} Branch`,
      timezone: "Asia/Jakarta",
    })
    return { legalEntity, branch }
  })

it.effect.skipIf(databaseUrl === undefined)(
  "stock corrected atomic publication stays idempotent and rolls back messaging failures",
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
        const tenant = yield* auth.createTenant({ slug: `adjust-${uuidv7()}` })
        const otherTenant = yield* auth.createTenant({
          slug: `adjust-other-${uuidv7()}`,
        })
        const messaging = yield* makeMessagingService.pipe(
          Effect.provideService(Database, database),
        )
        const authorizationLayer = makeAuthorizationTestLayer(
          [tenant.id, otherTenant.id].flatMap((tenantId) =>
            capabilities.map((capability) => ({
              userAccountId: principal.userAccountId,
              tenantId,
              capability,
            })),
          ),
        )
        yield* Effect.gen(function* () {
          const authorization = yield* AuthorizationService
          const requirements = Layer.mergeAll(
            Layer.succeed(Database, database),
            Layer.succeed(AuthorizationService, authorization),
            Layer.succeed(MessagingService, messaging),
          )
          const party = yield* Effect.provide(makePartyService, requirements)
          const scope = yield* Effect.provideService(
            createLegalEntityScope(tenant.id, "Adjustment"),
            PartyService,
            party,
          )
          const inventory = yield* Effect.provide(makeInventoryService, requirements)
          const otherScope = yield* Effect.provideService(
            createLegalEntityScope(otherTenant.id, "Other Adjustment"),
            PartyService,
            party,
          )
          const otherWarehouse = yield* inventory.createWarehouse({
            principal,
            tenantId: otherTenant.id,
            legalEntityId: otherScope.legalEntity.id,
            name: "Adjustment Warehouse",
          })
          const otherItem = yield* inventory.createItem({
            principal,
            tenantId: otherTenant.id,
            sku: "ADJUSTMENT",
            name: "Other Adjustment Item",
            unitOfMeasure: "box",
          })
          yield* inventory.receiveStock({
            principal,
            tenantId: otherTenant.id,
            warehouseId: otherWarehouse.id,
            itemId: otherItem.id,
            quantity: "10",
          })
          const warehouse = yield* inventory.createWarehouse({
            principal,
            tenantId: tenant.id,
            legalEntityId: scope.legalEntity.id,
            name: "Adjustment Warehouse",
          })
          const transferDestination = yield* inventory.createWarehouse({
            principal,
            tenantId: tenant.id,
            legalEntityId: scope.legalEntity.id,
            name: "Adjustment Destination",
          })
          assert.notStrictEqual(otherWarehouse.id, warehouse.id)
          const item = yield* inventory.createItem({
            principal,
            tenantId: tenant.id,
            sku: "ADJUSTMENT",
            name: "Adjustment Item",
            unitOfMeasure: "box",
          })
          assert.notStrictEqual(otherItem.id, item.id)
          const invalidItemUnitOfMeasure = yield* postgresFailure(
            () =>
              client`
              update inventory.items
              set unit_of_measure = 'A B'
              where tenant_id = ${tenant.id} and id = ${item.id}
            `,
          )
          assert.strictEqual((invalidItemUnitOfMeasure as { code?: string }).code, "23514")
          assert.strictEqual(
            (invalidItemUnitOfMeasure as { constraint_name?: string }).constraint_name,
            "items_unit_of_measure_check",
          )
          yield* inventory.receiveStock({
            principal,
            tenantId: tenant.id,
            warehouseId: warehouse.id,
            itemId: item.id,
            quantity: "10",
          })
          const sameTenantOtherScope = yield* Effect.provideService(
            createLegalEntityScope(tenant.id, "Other Adjustment"),
            PartyService,
            party,
          )
          const otherWarehouseSameTenant = yield* inventory.createWarehouse({
            principal,
            tenantId: tenant.id,
            legalEntityId: sameTenantOtherScope.legalEntity.id,
            name: "Other Adjustment Warehouse",
          })
          assert.instanceOf(
            yield* Effect.flip(
              inventory.reserveStock({
                principal,
                tenantId: tenant.id,
                warehouseId: otherWarehouseSameTenant.id,
                legalEntityId: scope.legalEntity.id,
                itemId: item.id,
                quantity: "1",
              }),
            ),
            StockReservationLegalEntityMismatch,
          )
          const reservationInput = {
            principal,
            tenantId: tenant.id,
            warehouseId: warehouse.id,
            itemId: item.id,
            quantity: "1",
            idempotencyKey: "reservation-1",
          }
          const duplicateReservations = yield* Effect.all(
            [inventory.reserveStock(reservationInput), inventory.reserveStock(reservationInput)],
            { concurrency: "unbounded" },
          )
          assert.strictEqual(duplicateReservations[0].id, duplicateReservations[1].id)
          const invalidReservationInsert = yield* postgresFailure(
            () =>
              client`
              insert into inventory.reservations
                (tenant_id, warehouse_id, item_id, quantity, idempotency_key, status)
              values
                (${tenant.id}, ${warehouse.id}, ${item.id}, 1, 'invalid-initial-reservation', 'fulfilled')
            `,
          )
          assert.strictEqual((invalidReservationInsert as { code?: string }).code, "23514")
          assert.strictEqual(
            (invalidReservationInsert as { constraint_name?: string }).constraint_name,
            "inventory_reservation_state_transition_check",
          )
          const invalidReservationTransition = yield* postgresFailure(() =>
            client.begin(async (transaction) => {
              await transaction`
                update inventory.reservations set status = 'fulfilled'
                where id = ${duplicateReservations[0].id}
              `
              await transaction`
                update inventory.reservations set status = 'released'
                where id = ${duplicateReservations[0].id}
              `
            }),
          )
          assert.strictEqual((invalidReservationTransition as { code?: string }).code, "23514")
          assert.strictEqual(
            (invalidReservationTransition as { constraint_name?: string }).constraint_name,
            "inventory_reservation_state_transition_check",
          )
          const invalidReservationStatus = yield* postgresFailure(() =>
            client.begin(async (transaction) => {
              await transaction`
                update inventory.reservations
                set status = 'fulfilled'
                where tenant_id = ${tenant.id} and id = ${duplicateReservations[0].id}
              `
            }),
          )
          assert.strictEqual((invalidReservationStatus as { code?: string }).code, "23514")
          assert.strictEqual(
            (invalidReservationStatus as { constraint_name?: string }).constraint_name,
            "inventory_reservation_balance_consistency_check",
          )
          const invalidReservedBalance = yield* postgresFailure(() =>
            client.begin(async (transaction) => {
              await transaction`
                update inventory.stock_balances
                set reserved = reserved + 1
                where tenant_id = ${tenant.id}
                  and warehouse_id = ${warehouse.id}
                  and item_id = ${item.id}
              `
            }),
          )
          assert.strictEqual((invalidReservedBalance as { code?: string }).code, "23514")
          assert.strictEqual(
            (invalidReservedBalance as { constraint_name?: string }).constraint_name,
            "inventory_reservation_balance_consistency_check",
          )
          const changedReservationQuantity = yield* postgresFailure(
            () =>
              client`
              update inventory.reservations
              set quantity = 2
              where tenant_id = ${tenant.id} and id = ${duplicateReservations[0].id}
            `,
          )
          assert.strictEqual((changedReservationQuantity as { code?: string }).code, "23514")
          assert.strictEqual(
            (changedReservationQuantity as { constraint_name?: string }).constraint_name,
            "inventory_reservation_identity_immutable",
          )
          const deletedReservation = yield* postgresFailure(
            () =>
              client`
              delete from inventory.reservations
              where tenant_id = ${tenant.id} and id = ${duplicateReservations[0].id}
            `,
          )
          assert.strictEqual((deletedReservation as { code?: string }).code, "23514")
          assert.strictEqual(
            (deletedReservation as { constraint_name?: string }).constraint_name,
            "inventory_reservation_identity_immutable",
          )
          const orphanReservationMovement = yield* postgresFailure(
            () =>
              client`
              insert into inventory.movements
                (tenant_id, warehouse_id, item_id, quantity, kind, reference_id)
              values
                (${tenant.id}, ${warehouse.id}, ${item.id}, 1, 'reservation', ${uuidv7()})
            `,
          )
          assert.strictEqual((orphanReservationMovement as { code?: string }).code, "23514")
          assert.strictEqual(
            (orphanReservationMovement as { constraint_name?: string }).constraint_name,
            "inventory_movement_reservation_reference_check",
          )
          const mismatchedReservationMovement = yield* postgresFailure(
            () =>
              client`
              insert into inventory.movements
                (tenant_id, warehouse_id, item_id, quantity, kind, reference_id)
              values
                (${tenant.id}, ${warehouse.id}, ${item.id}, 2, 'reservation',
                 ${duplicateReservations[0].id})
            `,
          )
          assert.strictEqual((mismatchedReservationMovement as { code?: string }).code, "23514")
          assert.strictEqual(
            (mismatchedReservationMovement as { constraint_name?: string }).constraint_name,
            "inventory_movement_reservation_reference_check",
          )
          const issueForActiveReservation = yield* postgresFailure(
            () =>
              client`
              insert into inventory.movements
                (tenant_id, warehouse_id, item_id, quantity, kind, reference_id)
              values
                (${tenant.id}, ${warehouse.id}, ${item.id}, -1, 'issue',
                 ${duplicateReservations[0].id})
            `,
          )
          assert.strictEqual((issueForActiveReservation as { code?: string }).code, "23514")
          assert.strictEqual(
            (issueForActiveReservation as { constraint_name?: string }).constraint_name,
            "inventory_movement_reservation_reference_check",
          )
          const invalidTransferInsert = yield* postgresFailure(
            () =>
              client`
              insert into inventory.stock_transfers
                (tenant_id, legal_entity_id, source_warehouse_id, destination_warehouse_id,
                 status, confirmed_at)
              values
                (${tenant.id}, ${scope.legalEntity.id}, ${warehouse.id},
                 ${transferDestination.id}, 'confirmed', now())
            `,
          )
          assert.strictEqual((invalidTransferInsert as { code?: string }).code, "23514")
          assert.strictEqual(
            (invalidTransferInsert as { constraint_name?: string }).constraint_name,
            "inventory_stock_transfer_state_transition_check",
          )
          const invalidTransferTransition = yield* postgresFailure(() =>
            client.begin(async (transaction) => {
              const [transfer] = await transaction<{ id: string }[]>`
                insert into inventory.stock_transfers
                  (tenant_id, legal_entity_id, source_warehouse_id, destination_warehouse_id)
                values
                  (${tenant.id}, ${scope.legalEntity.id}, ${warehouse.id},
                   ${transferDestination.id})
                returning id
              `
              await transaction`
                update inventory.stock_transfers
                set status = 'completed', confirmed_at = now(), completed_at = now()
                where id = ${transfer!.id}
              `
            }),
          )
          assert.strictEqual((invalidTransferTransition as { code?: string }).code, "23514")
          assert.strictEqual(
            (invalidTransferTransition as { constraint_name?: string }).constraint_name,
            "inventory_stock_transfer_state_transition_check",
          )
          const otherReservation = yield* inventory.reserveStock({
            principal,
            tenantId: otherTenant.id,
            warehouseId: otherWarehouse.id,
            itemId: otherItem.id,
            quantity: "1",
            idempotencyKey: reservationInput.idempotencyKey,
          })
          assert.notStrictEqual(otherReservation.id, duplicateReservations[0].id)
          assert.strictEqual(otherReservation.tenantId, otherTenant.id)
          assert.deepStrictEqual(
            (yield* Effect.promise(() => readBalances(client, otherTenant.id)))[0],
            {
              warehouse_id: otherWarehouse.id,
              item_id: otherItem.id,
              on_hand: "10",
              reserved: "1",
            },
          )
          assert.instanceOf(
            yield* Effect.flip(
              inventory.releaseReservation({
                principal,
                tenantId: otherTenant.id,
                reservationId: duplicateReservations[0].id,
              }),
            ),
            StockReservationNotFound,
          )
          assert.instanceOf(
            yield* Effect.flip(
              inventory.fulfillReservation({
                principal,
                tenantId: otherTenant.id,
                reservationId: duplicateReservations[0].id,
              }),
            ),
            StockReservationNotFound,
          )
          assert.instanceOf(
            yield* Effect.flip(
              inventory.reserveStock({
                ...reservationInput,
                quantity: "2",
              }),
            ),
            StockReservationIdempotencyConflict,
          )
          yield* inventory.reserveStock({
            principal,
            tenantId: tenant.id,
            warehouseId: warehouse.id,
            itemId: item.id,
            quantity: "4",
          })
          const [beforeCorrection] = yield* Effect.promise(() => readBalances(client, tenant.id))
          assert.deepStrictEqual(beforeCorrection, {
            warehouse_id: warehouse.id,
            item_id: item.id,
            on_hand: "10",
            reserved: "5",
          })
          const correctionInput = {
            principal,
            tenantId: tenant.id,
            warehouseId: warehouse.id,
            itemId: item.id,
            adjustment: "-3",
            unitOfMeasure: "BOX",
            reason: "Count correction",
            commandId: "correction-command-1",
            correlationId: "correction-correlation-1",
            causationId: null,
            idempotencyKey: "correction-1",
          }
          const duplicates = yield* Effect.all(
            [inventory.adjustStock(correctionInput), inventory.adjustStock(correctionInput)],
            { concurrency: "unbounded" },
          )
          assert.strictEqual(duplicates[0].id, duplicates[1].id)
          const changedMovement = yield* postgresFailure(
            () =>
              client`
              update inventory.movements
              set reason = 'edited correction'
              where tenant_id = ${tenant.id} and id = ${duplicates[0].id}
            `,
          )
          assert.strictEqual((changedMovement as { code?: string }).code, "23514")
          assert.strictEqual(
            (changedMovement as { constraint_name?: string }).constraint_name,
            "inventory_movements_immutable",
          )
          const deletedMovement = yield* postgresFailure(
            () =>
              client`
              delete from inventory.movements
              where tenant_id = ${tenant.id} and id = ${duplicates[0].id}
            `,
          )
          assert.strictEqual((deletedMovement as { code?: string }).code, "23514")
          assert.strictEqual(
            (deletedMovement as { constraint_name?: string }).constraint_name,
            "inventory_movements_immutable",
          )
          const invalidUnitOfMeasure = yield* postgresFailure(
            () =>
              client`
              insert into inventory.movements
                (tenant_id, warehouse_id, item_id, quantity, kind,
                 unit_of_measure, reason, idempotency_key)
              values
                (${tenant.id}, ${warehouse.id}, ${item.id}, 1, 'receipt',
                 'box', 'manual correction', ${`invalid-uom-${uuidv7()}`})
            `,
          )
          assert.strictEqual((invalidUnitOfMeasure as { code?: string }).code, "23514")
          assert.strictEqual(
            (invalidUnitOfMeasure as { constraint_name?: string }).constraint_name,
            "movements_correction_metadata_check",
          )
          for (const [kind, quantity] of [
            ["issue", 1],
            ["receipt", -1],
          ] as const) {
            const invalidSign = yield* postgresFailure(
              () =>
                client`
                insert into inventory.movements
                  (tenant_id, warehouse_id, item_id, quantity, kind)
                values (${tenant.id}, ${warehouse.id}, ${item.id}, ${quantity}, ${kind})
              `,
            )
            assert.strictEqual((invalidSign as { code?: string }).code, "23514")
            assert.strictEqual(
              (invalidSign as { constraint_name?: string }).constraint_name,
              "movements_kind_quantity_sign_check",
            )
          }
          const invalidReleaseReference = yield* postgresFailure(
            () =>
              client`
              insert into inventory.movements
                (tenant_id, warehouse_id, item_id, quantity, kind)
              values
                (${tenant.id}, ${warehouse.id}, ${item.id}, 1, 'release')
            `,
          )
          assert.strictEqual((invalidReleaseReference as { code?: string }).code, "23514")
          assert.strictEqual(
            (invalidReleaseReference as { constraint_name?: string }).constraint_name,
            "inventory_movement_reservation_reference_check",
          )
          const otherCorrection = yield* inventory.adjustStock({
            ...correctionInput,
            tenantId: otherTenant.id,
            warehouseId: otherWarehouse.id,
            itemId: otherItem.id,
            commandId: "other-correction-command-1",
            correlationId: "other-correction-correlation-1",
          })
          assert.notStrictEqual(otherCorrection.id, duplicates[0].id)
          assert.strictEqual(otherCorrection.tenantId, otherTenant.id)
          assert.deepStrictEqual(
            (yield* Effect.promise(() => readBalances(client, otherTenant.id)))[0],
            {
              warehouse_id: otherWarehouse.id,
              item_id: otherItem.id,
              on_hand: "7",
              reserved: "1",
            },
          )
          assert.instanceOf(
            yield* Effect.flip(
              inventory.adjustStock({
                ...correctionInput,
                adjustment: "1",
              }),
            ),
            StockCorrectionIdempotencyConflict,
          )
          const competing = yield* Effect.all(
            [
              Effect.result(
                inventory.adjustStock({
                  ...correctionInput,
                  adjustment: "-2",
                  idempotencyKey: "correction-2",
                }),
              ),
              Effect.result(
                inventory.adjustStock({
                  ...correctionInput,
                  adjustment: "-2",
                  idempotencyKey: "correction-3",
                }),
              ),
            ],
            { concurrency: "unbounded" },
          )
          assert.strictEqual(competing.filter((result) => result._tag === "Success").length, 1)
          assert.strictEqual(competing.filter((result) => result._tag === "Failure").length, 1)
          const [balance] = yield* Effect.promise(() => readBalances(client, tenant.id))
          assert.deepStrictEqual(balance, {
            warehouse_id: warehouse.id,
            item_id: item.id,
            on_hand: "5",
            reserved: "5",
          })
          const [movementCount] = yield* Effect.promise(
            () =>
              client<{ count: string }[]>`
              select count(*)::text as count
              from inventory.movements
              where tenant_id = ${tenant.id} and idempotency_key = 'correction-1'
            `,
          )
          assert.strictEqual(movementCount?.count, "1")

          const [event] = yield* Effect.promise(
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
              where tenant_id = ${tenant.id} and idempotency_key = 'correction-1'
            `,
          )
          yield* Schema.decodeUnknownEffect(InventoryStockCorrectedEvent.payloadSchema)(
            event?.payload,
          )
          assert.notStrictEqual(event?.id, duplicates[0].id)
          assert.deepStrictEqual(event, {
            id: event!.id,
            event_type: InventoryStockCorrectedEvent.id,
            event_version: InventoryStockCorrectedEvent.version,
            aggregate_type: InventoryStockCorrectedEvent.aggregateType,
            aggregate_id: duplicates[0].id,
            command_id: correctionInput.commandId,
            correlation_id: correctionInput.correlationId,
            causation_id: null,
            idempotency_key: correctionInput.idempotencyKey,
            actor_principal_id: principal.userAccountId,
            occurred_at: event!.occurred_at,
            payload: {
              correctionId: duplicates[0].id,
              warehouseId: warehouse.id,
              itemId: item.id,
            },
          })
          assert.ok(Number.isFinite(new Date(event!.occurred_at).getTime()))

          const failingInventory = yield* Effect.provide(
            makeInventoryService,
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
            ),
          )
          assert.instanceOf(
            yield* Effect.flip(
              failingInventory.adjustStock({
                ...correctionInput,
                adjustment: "2",
                commandId: "correction-rollback-command",
                correlationId: "correction-rollback-correlation",
                idempotencyKey: "correction-rollback",
              }),
            ),
            DatabaseFailure,
          )
          const [rolledBackBalance] = yield* Effect.promise(() => readBalances(client, tenant.id))
          assert.strictEqual(rolledBackBalance?.on_hand, "5")
          const [rolledBackCounts] = yield* Effect.promise(
            () =>
              client<{ movements: string; events: string }[]>`
              select
                (select count(*)::text from inventory.movements
                  where tenant_id = ${tenant.id} and idempotency_key = 'correction-rollback') as movements,
                (select count(*)::text from messaging.event_outbox
                  where tenant_id = ${tenant.id} and idempotency_key = 'correction-rollback') as events
            `,
          )
          assert.deepStrictEqual(rolledBackCounts, { movements: "0", events: "0" })

          const guardedItem = yield* inventory.createItem({
            principal,
            tenantId: tenant.id,
            sku: "RESERVATION-BALANCE-GUARD",
            name: "Reservation Balance Guard Item",
            unitOfMeasure: "box",
          })
          yield* inventory.receiveStock({
            principal,
            tenantId: tenant.id,
            warehouseId: warehouse.id,
            itemId: guardedItem.id,
            quantity: "1",
          })
          const guardedReservation = yield* inventory.reserveStock({
            principal,
            tenantId: tenant.id,
            warehouseId: warehouse.id,
            itemId: guardedItem.id,
            quantity: "1",
          })
          const invalidGuardedBalance = yield* postgresFailure(() =>
            client.begin(async (transaction) => {
              await transaction`
                update inventory.stock_balances
                set on_hand = 0, reserved = 0
                where tenant_id = ${tenant.id}
                  and warehouse_id = ${warehouse.id}
                  and item_id = ${guardedItem.id}
              `
            }),
          )
          assert.strictEqual((invalidGuardedBalance as { code?: string }).code, "23514")
          assert.strictEqual(
            (invalidGuardedBalance as { constraint_name?: string }).constraint_name,
            "inventory_on_hand_movement_consistency_check",
          )
          const [guardedReservationRow] = yield* Effect.promise(
            () =>
              client<{ status: string }[]>`
              select status
              from inventory.reservations
              where tenant_id = ${tenant.id} and id = ${guardedReservation.id}
            `,
          )
          assert.strictEqual(guardedReservationRow?.status, "active")
        }).pipe(Effect.provide(authorizationLayer))
      }),
    ),
)

it.effect.skipIf(databaseUrl === undefined)(
  "moves transfer lines only at confirmation and completion",
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
        const tenant = yield* auth.createTenant({ slug: `transfer-${uuidv7()}` })
        const otherTenant = yield* auth.createTenant({
          slug: `transfer-other-${uuidv7()}`,
        })
        const authorizationLayer = makeAuthorizationTestLayer(
          [tenant.id, otherTenant.id].flatMap((tenantId) =>
            capabilities.map((capability) => ({
              userAccountId: principal.userAccountId,
              tenantId,
              capability,
            })),
          ),
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
          const scope = yield* Effect.provideService(
            createLegalEntityScope(tenant.id, "Transfer"),
            PartyService,
            party,
          )
          const inventory = yield* Effect.provide(makeInventoryService, requirements)
          const otherScope = yield* Effect.provideService(
            createLegalEntityScope(otherTenant.id, "Other Transfer"),
            PartyService,
            party,
          )
          const source = yield* inventory.createWarehouse({
            principal,
            tenantId: tenant.id,
            legalEntityId: scope.legalEntity.id,
            primaryBranchId: scope.branch.id,
            name: "Source",
          })
          const destination = yield* inventory.createWarehouse({
            principal,
            tenantId: tenant.id,
            legalEntityId: scope.legalEntity.id,
            name: "Destination",
          })
          const otherSource = yield* inventory.createWarehouse({
            principal,
            tenantId: otherTenant.id,
            legalEntityId: otherScope.legalEntity.id,
            primaryBranchId: otherScope.branch.id,
            name: "Source",
          })
          const otherDestination = yield* inventory.createWarehouse({
            principal,
            tenantId: otherTenant.id,
            legalEntityId: otherScope.legalEntity.id,
            name: "Destination",
          })
          const widget = yield* inventory.createItem({
            principal,
            tenantId: tenant.id,
            sku: "WIDGET",
            name: "Widget",
          })
          const cable = yield* inventory.createItem({
            principal,
            tenantId: tenant.id,
            sku: "CABLE",
            name: "Cable",
          })
          yield* inventory.receiveStock({
            principal,
            tenantId: tenant.id,
            warehouseId: source.id,
            itemId: widget.id,
            quantity: "10",
          })
          yield* inventory.receiveStock({
            principal,
            tenantId: tenant.id,
            warehouseId: source.id,
            itemId: cable.id,
            quantity: "8",
          })
          assert.instanceOf(
            yield* Effect.flip(
              inventory.createTransfer({
                principal,
                tenantId: otherTenant.id,
                sourceWarehouseId: source.id,
                destinationWarehouseId: destination.id,
                lines: [{ itemId: widget.id, quantity: "1" }],
              }),
            ),
            StockTransferWarehouseNotFound,
          )
          assert.instanceOf(
            yield* Effect.flip(
              inventory.createTransfer({
                principal,
                tenantId: otherTenant.id,
                sourceWarehouseId: otherSource.id,
                destinationWarehouseId: otherDestination.id,
                lines: [{ itemId: widget.id, quantity: "1" }],
              }),
            ),
            StockTransferItemNotFound,
          )

          const transfer = yield* inventory.createTransfer({
            principal,
            tenantId: tenant.id,
            sourceWarehouseId: source.id,
            destinationWarehouseId: destination.id,
            lines: [
              { itemId: widget.id, quantity: "4" },
              { itemId: cable.id, quantity: "3" },
            ],
          })
          assert.instanceOf(
            yield* Effect.flip(
              inventory.confirmTransfer({
                principal,
                tenantId: otherTenant.id,
                transferId: transfer.id,
              }),
            ),
            StockTransferNotFound,
          )
          const beforeConfirm = yield* Effect.promise(() => readBalances(client, tenant.id))
          assert.deepStrictEqual(
            beforeConfirm.map(({ warehouse_id, item_id, on_hand }) => ({
              warehouse_id,
              item_id,
              on_hand,
            })),
            [
              { warehouse_id: source.id, item_id: cable.id, on_hand: "8" },
              { warehouse_id: source.id, item_id: widget.id, on_hand: "10" },
            ].toSorted((a, b) =>
              `${a.warehouse_id}:${a.item_id}`.localeCompare(`${b.warehouse_id}:${b.item_id}`),
            ),
          )

          yield* inventory.confirmTransfer({
            principal,
            tenantId: tenant.id,
            transferId: transfer.id,
          })
          yield* inventory.confirmTransfer({
            principal,
            tenantId: tenant.id,
            transferId: transfer.id,
          })
          const afterConfirm = yield* Effect.promise(() => readBalances(client, tenant.id))
          assert.deepStrictEqual(
            afterConfirm.map(({ warehouse_id, item_id, on_hand }) => ({
              warehouse_id,
              item_id,
              on_hand,
            })),
            [
              { warehouse_id: source.id, item_id: cable.id, on_hand: "5" },
              { warehouse_id: source.id, item_id: widget.id, on_hand: "6" },
            ].toSorted((a, b) =>
              `${a.warehouse_id}:${a.item_id}`.localeCompare(`${b.warehouse_id}:${b.item_id}`),
            ),
          )
          const changedConfirmedLine = yield* postgresFailure(
            () =>
              client`
              update inventory.stock_transfer_lines
              set quantity = 5
              where tenant_id = ${tenant.id} and transfer_id = ${transfer.id}
                and item_id = ${widget.id}
            `,
          )
          assert.strictEqual((changedConfirmedLine as { code?: string }).code, "23514")
          assert.strictEqual(
            (changedConfirmedLine as { constraint_name?: string }).constraint_name,
            "inventory_stock_transfer_lines_immutable",
          )
          const deletedConfirmedLine = yield* postgresFailure(
            () =>
              client`
              delete from inventory.stock_transfer_lines
              where tenant_id = ${tenant.id} and transfer_id = ${transfer.id}
                and item_id = ${cable.id}
            `,
          )
          assert.strictEqual((deletedConfirmedLine as { code?: string }).code, "23514")
          assert.strictEqual(
            (deletedConfirmedLine as { constraint_name?: string }).constraint_name,
            "inventory_stock_transfer_lines_immutable",
          )
          assert.instanceOf(
            yield* Effect.flip(
              inventory.completeTransfer({
                principal,
                tenantId: otherTenant.id,
                transferId: transfer.id,
              }),
            ),
            StockTransferNotFound,
          )
          const incompleteTransfer = yield* postgresFailure(() =>
            client.begin(async (transaction) => {
              await transaction`
                update inventory.stock_transfers
                set status = 'completed', completed_at = now()
                where tenant_id = ${tenant.id} and id = ${transfer.id}
              `
            }),
          )
          assert.strictEqual((incompleteTransfer as { code?: string }).code, "23514")
          assert.strictEqual(
            (incompleteTransfer as { constraint_name?: string }).constraint_name,
            "inventory_completed_transfer_receipts_check",
          )

          yield* inventory.completeTransfer({
            principal,
            tenantId: tenant.id,
            transferId: transfer.id,
          })
          yield* inventory.completeTransfer({
            principal,
            tenantId: tenant.id,
            transferId: transfer.id,
          })
          const afterComplete = yield* Effect.promise(() => readBalances(client, tenant.id))
          assert.deepStrictEqual(
            afterComplete
              .map(({ warehouse_id, item_id, on_hand }) => ({
                warehouse_id,
                item_id,
                on_hand,
              }))
              .toSorted((a, b) =>
                `${a.warehouse_id}:${a.item_id}`.localeCompare(`${b.warehouse_id}:${b.item_id}`),
              ),
            [
              { warehouse_id: destination.id, item_id: cable.id, on_hand: "3" },
              { warehouse_id: destination.id, item_id: widget.id, on_hand: "4" },
              { warehouse_id: source.id, item_id: cable.id, on_hand: "5" },
              { warehouse_id: source.id, item_id: widget.id, on_hand: "6" },
            ].toSorted((a, b) =>
              `${a.warehouse_id}:${a.item_id}`.localeCompare(`${b.warehouse_id}:${b.item_id}`),
            ),
          )
          const movements = yield* Effect.promise(
            () =>
              client<
                {
                  warehouse_id: string
                  item_id: string
                  kind: string
                  quantity: string
                  reference_id: string
                }[]
              >`
              select warehouse_id, item_id, kind, quantity::text, reference_id
              from inventory.movements
              where tenant_id = ${tenant.id} and reference_id = ${transfer.id}
              order by warehouse_id, item_id, kind
            `,
          )
          assert.deepStrictEqual(
            movements,
            [
              {
                warehouse_id: destination.id,
                item_id: cable.id,
                kind: "receipt",
                quantity: "3",
                reference_id: transfer.id,
              },
              {
                warehouse_id: destination.id,
                item_id: widget.id,
                kind: "receipt",
                quantity: "4",
                reference_id: transfer.id,
              },
              {
                warehouse_id: source.id,
                item_id: cable.id,
                kind: "issue",
                quantity: "-3",
                reference_id: transfer.id,
              },
              {
                warehouse_id: source.id,
                item_id: widget.id,
                kind: "issue",
                quantity: "-4",
                reference_id: transfer.id,
              },
            ].toSorted((a, b) =>
              `${a.warehouse_id}:${a.item_id}:${a.kind}`.localeCompare(
                `${b.warehouse_id}:${b.item_id}:${b.kind}`,
              ),
            ),
          )
        }).pipe(Effect.provide(authorizationLayer))
      }),
    ),
)

it.effect.skipIf(databaseUrl === undefined)(
  "rolls back every source deduction when one transfer line is unavailable",
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
        const tenant = yield* auth.createTenant({ slug: `transfer-${uuidv7()}` })
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
          const scope = yield* Effect.provideService(
            createLegalEntityScope(tenant.id, "Rollback"),
            PartyService,
            party,
          )
          const inventory = yield* Effect.provide(makeInventoryService, requirements)
          const source = yield* inventory.createWarehouse({
            principal,
            tenantId: tenant.id,
            legalEntityId: scope.legalEntity.id,
            primaryBranchId: scope.branch.id,
            name: "Source",
          })
          const destination = yield* inventory.createWarehouse({
            principal,
            tenantId: tenant.id,
            legalEntityId: scope.legalEntity.id,
            name: "Destination",
          })
          const widget = yield* inventory.createItem({
            principal,
            tenantId: tenant.id,
            sku: "WIDGET",
            name: "Widget",
          })
          const cable = yield* inventory.createItem({
            principal,
            tenantId: tenant.id,
            sku: "CABLE",
            name: "Cable",
          })
          yield* inventory.receiveStock({
            principal,
            tenantId: tenant.id,
            warehouseId: source.id,
            itemId: widget.id,
            quantity: "10",
          })
          yield* inventory.receiveStock({
            principal,
            tenantId: tenant.id,
            warehouseId: source.id,
            itemId: cable.id,
            quantity: "1",
          })
          const transfer = yield* inventory.createTransfer({
            principal,
            tenantId: tenant.id,
            sourceWarehouseId: source.id,
            destinationWarehouseId: destination.id,
            lines: [
              { itemId: widget.id, quantity: "2" },
              { itemId: cable.id, quantity: "2" },
            ],
          })

          const error = yield* Effect.flip(
            inventory.confirmTransfer({
              principal,
              tenantId: tenant.id,
              transferId: transfer.id,
            }),
          )
          assert.instanceOf(error, StockUnavailable)
          const balances = yield* Effect.promise(() => readBalances(client, tenant.id))
          assert.deepStrictEqual(
            balances
              .map(({ warehouse_id, item_id, on_hand }) => ({
                warehouse_id,
                item_id,
                on_hand,
              }))
              .toSorted((a, b) =>
                `${a.warehouse_id}:${a.item_id}`.localeCompare(`${b.warehouse_id}:${b.item_id}`),
              ),
            [
              { warehouse_id: source.id, item_id: cable.id, on_hand: "1" },
              { warehouse_id: source.id, item_id: widget.id, on_hand: "10" },
            ].toSorted((a, b) =>
              `${a.warehouse_id}:${a.item_id}`.localeCompare(`${b.warehouse_id}:${b.item_id}`),
            ),
          )
        }).pipe(Effect.provide(authorizationLayer))
      }),
    ),
)

it.effect.skipIf(databaseUrl === undefined)(
  "enforces warehouse legal entity and branch scope",
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
        const tenant = yield* auth.createTenant({ slug: `warehouse-${uuidv7()}` })
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
          const sourceScope = yield* Effect.provideService(
            createLegalEntityScope(tenant.id, "Source"),
            PartyService,
            party,
          )
          const destinationScope = yield* Effect.provideService(
            createLegalEntityScope(tenant.id, "Destination"),
            PartyService,
            party,
          )
          const inventory = yield* Effect.provide(makeInventoryService, requirements)

          const invalidWarehouse = yield* Effect.flip(
            inventory.createWarehouse({
              principal,
              tenantId: tenant.id,
              legalEntityId: sourceScope.legalEntity.id,
              primaryBranchId: destinationScope.branch.id,
              name: "Invalid Branch Scope",
            }),
          )
          assert.instanceOf(invalidWarehouse, WarehouseBranchNotFound)

          const source = yield* inventory.createWarehouse({
            principal,
            tenantId: tenant.id,
            legalEntityId: sourceScope.legalEntity.id,
            primaryBranchId: sourceScope.branch.id,
            name: "Source Warehouse",
          })
          const destination = yield* inventory.createWarehouse({
            principal,
            tenantId: tenant.id,
            legalEntityId: destinationScope.legalEntity.id,
            primaryBranchId: destinationScope.branch.id,
            name: "Destination Warehouse",
          })
          const error = yield* Effect.flip(
            inventory.createTransfer({
              principal,
              tenantId: tenant.id,
              sourceWarehouseId: source.id,
              destinationWarehouseId: destination.id,
              lines: [
                {
                  itemId: "00000000-0000-4000-8000-000000000099",
                  quantity: "1",
                },
              ],
            }),
          )
          assert.instanceOf(error, StockTransferDifferentLegalEntity)
        }).pipe(Effect.provide(authorizationLayer))
      }),
    ),
)
