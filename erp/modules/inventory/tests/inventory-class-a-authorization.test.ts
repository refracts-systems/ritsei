import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Result from "effect/Result"

import { Database, uuidv7 } from "../../../../framework/foundation/mod.ts"
import {
  AuthorizationDenied,
  makeAuthorizationTestLayer,
} from "../../../../framework/modules/authorization/mod.ts"
import { makeMessagingTestLayer } from "../../../../framework/modules/messaging/mod.ts"
import { GeneralLedgerService } from "../../accounting/mod.ts"
import { ProductService } from "../../product/mod.ts"
import {
  InventoryCapabilities,
  InventoryService,
  type InventoryServiceContract,
  makeInventoryTestLayer,
  StockKeepingLive,
  StockKeepingService,
  type StockKeepingServiceContract,
} from "../mod.ts"

const principal = { userAccountId: "keeper", sessionId: "session" }
const tenantId = uuidv7()
const otherTenantId = uuidv7()
const warehouseId = uuidv7()
const itemId = uuidv7()
const legalEntityId = uuidv7()

type Capability = (typeof InventoryCapabilities)[keyof typeof InventoryCapabilities]

const allCapabilities = Object.values(InventoryCapabilities)

const grantsOf = (grants: ReadonlyArray<{ tenantId: string; capability: Capability }>) =>
  grants.map((grant) => ({ userAccountId: principal.userAccountId, ...grant }))

const scope = { principal, tenantId }

const correction = {
  commandId: "command-1",
  correlationId: "correlation-1",
  causationId: null,
} as const

// Every call carries input that decodes and names records that need not exist: a denied call fails
// before any lookup, and a granted call is only used to show the grant is what lets it through.
const inventoryCalls: ReadonlyArray<
  readonly [
    Capability,
    string,
    (service: InventoryServiceContract) => Effect.Effect<unknown, unknown>,
  ]
> = [
  [
    InventoryCapabilities.warehouseRead,
    "listWarehouses",
    (service) => service.listWarehouses(scope),
  ],
  [
    InventoryCapabilities.warehouseCreate,
    "createWarehouse",
    (service) => service.createWarehouse({ ...scope, legalEntityId, name: "Main" }),
  ],
  [InventoryCapabilities.itemRead, "listItems", (service) => service.listItems(scope)],
  [
    InventoryCapabilities.itemCreate,
    "createItem",
    (service) => service.createItem({ ...scope, sku: "sku-1", name: "Widget" }),
  ],
  [
    InventoryCapabilities.stockRead,
    "listStockBalances",
    (service) => service.listStockBalances(scope),
  ],
  [
    InventoryCapabilities.stockRead,
    "listStockReservations",
    (service) => service.listStockReservations(scope),
  ],
  [
    InventoryCapabilities.stockRead,
    "listStockTransfers",
    (service) => service.listStockTransfers(scope),
  ],
  [
    InventoryCapabilities.stockRead,
    "listStockMovements",
    (service) => service.listStockMovements(scope),
  ],
  [
    InventoryCapabilities.stockReceive,
    "receiveStock",
    (service) => service.receiveStock({ ...scope, warehouseId, itemId, quantity: "1" }),
  ],
  [
    InventoryCapabilities.stockAdjust,
    "adjustStock",
    (service) =>
      service.adjustStock({
        ...scope,
        warehouseId,
        itemId,
        adjustment: "1",
        unitOfMeasure: "EA",
        reason: "count",
        ...correction,
        idempotencyKey: "correction-1",
      }),
  ],
  [
    InventoryCapabilities.stockReserve,
    "reserveStock",
    (service) => service.reserveStock({ ...scope, warehouseId, itemId, quantity: "1" }),
  ],
  [
    InventoryCapabilities.stockRelease,
    "releaseReservation",
    (service) => service.releaseReservation({ ...scope, reservationId: uuidv7() }),
  ],
  [
    InventoryCapabilities.stockFulfill,
    "fulfillReservation",
    (service) => service.fulfillReservation({ ...scope, reservationId: uuidv7() }),
  ],
  [
    InventoryCapabilities.stockTransferCreate,
    "createTransfer",
    (service) =>
      service.createTransfer({
        ...scope,
        sourceWarehouseId: warehouseId,
        destinationWarehouseId: uuidv7(),
        lines: [{ itemId, quantity: "1" }],
      }),
  ],
  [
    InventoryCapabilities.stockTransferConfirm,
    "confirmTransfer",
    (service) => service.confirmTransfer({ ...scope, transferId: uuidv7() }),
  ],
  [
    InventoryCapabilities.stockTransferComplete,
    "completeTransfer",
    (service) => service.completeTransfer({ ...scope, transferId: uuidv7() }),
  ],
]

const inventoryWith = (grants: ReadonlyArray<{ tenantId: string; capability: Capability }>) =>
  makeInventoryTestLayer().pipe(
    Layer.provide(
      Layer.merge(makeAuthorizationTestLayer(grantsOf(grants)), makeMessagingTestLayer()),
    ),
  )

// SAFETY: a call that is not denied would reach these and fail the test with a defect.
const unused = {} as never

const stockKeepingWith = (grants: ReadonlyArray<{ tenantId: string; capability: Capability }>) =>
  StockKeepingLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        makeAuthorizationTestLayer(grantsOf(grants)),
        Layer.succeed(Database, unused),
        Layer.succeed(GeneralLedgerService, unused),
        Layer.succeed(ProductService, unused),
      ),
    ),
  )

const source = { type: "inventory.test_document", id: uuidv7() }

const stockKeepingCalls: ReadonlyArray<
  readonly [
    Capability,
    string,
    (service: StockKeepingServiceContract) => Effect.Effect<unknown, unknown>,
  ]
> = [
  [
    InventoryCapabilities.itemCreate,
    "registerProductItem",
    (service) => service.registerProductItem({ ...scope, productId: uuidv7() }),
  ],
  [
    InventoryCapabilities.stockReceive,
    "receiveValued",
    (service) =>
      service.receiveValued({
        ...scope,
        warehouseId,
        postingDate: "2026-12-31",
        source,
        counterRole: "goods_received_not_invoiced",
        lines: [{ itemId, quantity: "1", unitCost: "10.00" }],
      }),
  ],
  [
    InventoryCapabilities.stockIssue,
    "issueValued",
    (service) =>
      service.issueValued({
        ...scope,
        warehouseId,
        postingDate: "2026-12-31",
        source,
        counterRole: "cost_of_goods_sold",
        lines: [{ itemId, quantity: "1" }],
      }),
  ],
  [
    InventoryCapabilities.stockCount,
    "countStock",
    (service) =>
      service.countStock({
        ...scope,
        warehouseId,
        postingDate: "2026-12-31",
        countId: uuidv7(),
        lines: [{ itemId, countedQuantity: "1" }],
      }),
  ],
  [
    InventoryCapabilities.openingStockLoad,
    "loadOpeningStock",
    (service) =>
      service.loadOpeningStock({
        ...scope,
        warehouseId,
        openingId: uuidv7(),
        cutoffDate: "2026-12-31",
        lines: [
          {
            itemId,
            quantity: "1",
            sourceValue: "10.00",
            tracking: "none",
            reservedQuantity: "0",
            inTransitQuantity: "0",
          },
        ],
      }),
  ],
  [
    InventoryCapabilities.valuationRead,
    "valuation",
    (service) => service.valuation({ ...scope, legalEntityId }),
  ],
]

describe("Inventory authorization is denied by default", () => {
  // [INV-AUTH-1]
  it.effect("every inventory call is denied without its capability in the tenant", () =>
    Effect.gen(function* () {
      for (const [capability, name, call] of inventoryCalls) {
        const grantSets = [
          // No grant at all.
          [],
          // The capability in another tenant only.
          [{ tenantId: otherTenantId, capability }],
          // Every other capability in this tenant.
          allCapabilities
            .filter((other) => other !== capability)
            .map((other) => ({ tenantId, capability: other })),
        ]

        for (const grants of grantSets) {
          const denied = yield* Effect.flip(
            Effect.gen(function* () {
              return yield* call(yield* InventoryService)
            }).pipe(Effect.provide(inventoryWith(grants))),
          )

          assert.instanceOf(denied, AuthorizationDenied, `${name} was not denied`)
        }
      }
    }),
  )

  // [INV-AUTH-1]
  it.effect("the capability in the tenant lets the call through to its own checks", () =>
    Effect.gen(function* () {
      for (const [capability, name, call] of inventoryCalls) {
        const result = yield* Effect.result(
          Effect.gen(function* () {
            return yield* call(yield* InventoryService)
          }).pipe(Effect.provide(inventoryWith([{ tenantId, capability }]))),
        )

        if (Result.isFailure(result)) {
          assert.notInstanceOf(result.failure, AuthorizationDenied, `${name} was denied`)
        }
      }
    }),
  )

  // [INV-AUTH-1]
  it.effect("adjusting stock needs its own capability, not the capability to receive", () =>
    Effect.gen(function* () {
      const everythingButAdjust = allCapabilities
        .filter((capability) => capability !== InventoryCapabilities.stockAdjust)
        .map((capability) => ({ tenantId, capability }))

      const denied = yield* Effect.flip(
        Effect.gen(function* () {
          const inventory = yield* InventoryService
          const [, , adjust] = inventoryCalls.find(([, name]) => name === "adjustStock")!

          return yield* adjust(inventory)
        }).pipe(Effect.provide(inventoryWith(everythingButAdjust))),
      )

      assert.instanceOf(denied, AuthorizationDenied)
    }),
  )

  // [INV-AUTH-1] [INV-OPEN-1]
  it.effect("every valued stock call, and the opening load, is denied without its capability", () =>
    Effect.gen(function* () {
      for (const [capability, name, call] of stockKeepingCalls) {
        const grantSets = [
          [],
          [{ tenantId: otherTenantId, capability }],
          allCapabilities
            .filter((other) => other !== capability)
            .map((other) => ({ tenantId, capability: other })),
        ]

        for (const grants of grantSets) {
          const denied = yield* Effect.flip(
            Effect.gen(function* () {
              return yield* call(yield* StockKeepingService)
            }).pipe(Effect.provide(stockKeepingWith(grants))),
          )

          assert.instanceOf(denied, AuthorizationDenied, `${name} was not denied`)
        }
      }
    }),
  )
})
