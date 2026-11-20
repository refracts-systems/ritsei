import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import { Database, uuidv7 } from "../../../../framework/foundation/mod.ts"
import {
  AuthorizationDenied,
  makeAuthorizationTestLayer,
} from "../../../../framework/modules/authorization/mod.ts"
import { GeneralLedgerService } from "../../accounting/mod.ts"
import { ProductService } from "../../product/mod.ts"
import {
  InventoryCapabilities,
  OpeningStockInput,
  OpeningStockInTransitNotCarried,
  OpeningStockLotTrackingUnsupported,
  OpeningStockReservationsNotCarried,
  StockKeepingLive,
  StockKeepingService,
} from "../mod.ts"

const principal = { userAccountId: "opening-user", sessionId: "opening-session" }
const tenantId = uuidv7()
const warehouseId = uuidv7()
const itemId = uuidv7()

// SAFETY: every rejection below happens before the service touches the database, the ledger, or
// products, so a call that reaches them fails the test with a defect.
const unused = {} as never

/** The service for a caller granted the capability in `grantedTenantId`, or in none. */
const layer = (grantedTenantId: string | undefined) =>
  StockKeepingLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        makeAuthorizationTestLayer(
          grantedTenantId === undefined
            ? []
            : [
                {
                  userAccountId: principal.userAccountId,
                  tenantId: grantedTenantId,
                  capability: InventoryCapabilities.openingStockLoad,
                },
              ],
        ),
        Layer.succeed(Database, unused),
        Layer.succeed(GeneralLedgerService, unused),
        Layer.succeed(ProductService, unused),
      ),
    ),
  )

const line = {
  itemId,
  quantity: "10",
  sourceValue: "100.00",
  tracking: "none",
  reservedQuantity: "0",
  inTransitQuantity: "0",
} as const

const opening = {
  principal,
  tenantId,
  warehouseId,
  openingId: uuidv7(),
  cutoffDate: "2026-12-31",
  lines: [line],
} as const

describe("StockKeepingService.loadOpeningStock", () => {
  // [INV-OPEN-1]
  it.effect("denies a caller without the capability, or with it in another tenant", () =>
    Effect.gen(function* () {
      for (const grantedTenantId of [undefined, uuidv7()]) {
        const denied = yield* Effect.flip(
          Effect.gen(function* () {
            const stock = yield* StockKeepingService

            return yield* stock.loadOpeningStock(opening)
          }).pipe(Effect.provide(layer(grantedTenantId))),
        )

        assert.instanceOf(denied, AuthorizationDenied)
      }
    }),
  )

  // [INV-OPEN-2]
  it.effect("keeps lot and expiry tracked stock under source authority", () =>
    Effect.gen(function* () {
      const stock = yield* StockKeepingService

      for (const tracking of ["lot", "expiry"] as const) {
        const rejected = yield* Effect.flip(
          stock.loadOpeningStock({ ...opening, lines: [{ ...line, tracking }] }),
        )

        assert.instanceOf(rejected, OpeningStockLotTrackingUnsupported)
        assert.strictEqual(rejected.tracking, tracking)
        assert.strictEqual(rejected.itemId, itemId)
      }
    }).pipe(Effect.provide(layer(tenantId))),
  )

  // [INV-OPEN-2]
  it.effect("rejects declared reservations and goods in transit instead of dropping them", () =>
    Effect.gen(function* () {
      const stock = yield* StockKeepingService

      const reserved = yield* Effect.flip(
        stock.loadOpeningStock({ ...opening, lines: [{ ...line, reservedQuantity: "3" }] }),
      )

      assert.instanceOf(reserved, OpeningStockReservationsNotCarried)
      assert.strictEqual(reserved.reserved, "3")

      const inTransit = yield* Effect.flip(
        stock.loadOpeningStock({ ...opening, lines: [{ ...line, inTransitQuantity: "4" }] }),
      )

      assert.instanceOf(inTransit, OpeningStockInTransitNotCarried)
      assert.strictEqual(inTransit.inTransit, "4")
    }).pipe(Effect.provide(layer(tenantId))),
  )
})

describe("OpeningStockInput", () => {
  const revaluation = {
    name: "FIFO to moving average at cutoff",
    approvedBy: "finance-owner",
    approvedAt: "2026-12-31T23:59:00Z",
    reference: "CUTOVER-2026-12-31",
  }

  const revalued = { ...line, movingAverageValue: "90.00" }

  const decode = (value: Schema.Codec.Encoded<typeof OpeningStockInput>) =>
    Effect.result(Schema.decodeEffect(OpeningStockInput)(value))

  // [INV-OPEN-3]
  it.effect("requires the approval exactly when a line states a moving-average value", () =>
    Effect.gen(function* () {
      const unapproved = yield* decode({ ...opening, lines: [revalued] })
      const unneeded = yield* decode({ ...opening, revaluation })
      const approved = yield* decode({ ...opening, revaluation, lines: [revalued] })

      assert.strictEqual(unapproved._tag, "Failure")
      assert.strictEqual(unneeded._tag, "Failure")
      assert.strictEqual(approved._tag, "Success")
    }),
  )
})
