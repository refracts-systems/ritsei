import { assert, describe, it } from "@effect/vitest"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import {
  AcceptOpening,
  InventoryClassA,
  OpeningAccepted,
  OpeningLoad,
  OpeningStockConflict,
} from "../src/domain-model.ts"
import { openingLoadKey } from "../src/opening-stock-rules.ts"

const { Story } = Domain

const story = Story.make(InventoryClassA)

const load = OpeningLoad.ref(openingLoadKey("tenant-a", "o-1"))
const otherTenant = OpeningLoad.ref(openingLoadKey("tenant-b", "o-1"))

const line = (overrides: Partial<(typeof AcceptOpening.Type)["lines"][number]> = {}) => ({
  itemId: "A",
  quantity: "10",
  sourceValue: "100.00",
  tracking: "none" as const,
  reservedQuantity: "0",
  inTransitQuantity: "0",
  ...overrides,
})

const accept = (
  lines: ReadonlyArray<ReturnType<typeof line>>,
  warehouseId = "w-1",
  cutoffDate = "2026-12-31",
) => new AcceptOpening({ warehouseId, cutoffDate, lines })

const accepted = (
  lines: ReadonlyArray<ReturnType<typeof line>>,
  warehouseId = "w-1",
  cutoffDate = "2026-12-31",
) => new OpeningAccepted({ warehouseId, cutoffDate, lines })

const bundle = [line(), line({ itemId: "B", quantity: "5", sourceValue: "20.00" })]

describe("INV-OPEN-4 on Alchemy: an opening load is an instance keyed by its openingId", () => {
  it("the model is well defined", () => assert.deepStrictEqual(Domain.verify(InventoryClassA), []))

  // [INV-OPEN-4]
  it.effect("a repeat of the same bundle returns the recorded load and records nothing", () =>
    story(
      Story.when(load, accept(bundle)),
      Story.then(load, accepted(bundle)),
      Story.when(load, accept([...bundle].reverse())),
      Story.then(load),
    ),
  )

  // [INV-OPEN-4]
  it.effect("a changed warehouse, cutoff date, or line fails with OpeningStockConflict", () =>
    story(
      Story.given(load, accepted(bundle)),
      Story.when(load, accept(bundle, "w-2")),
      Story.rejected(new OpeningStockConflict()),
      Story.when(load, accept(bundle, "w-1", "2027-01-31")),
      Story.rejected(new OpeningStockConflict()),
      Story.when(load, accept([line({ quantity: "11" }), bundle[1]!])),
      Story.rejected(new OpeningStockConflict()),
      Story.when(
        load,
        new AcceptOpening({
          warehouseId: "w-1",
          cutoffDate: "2026-12-31",
          revaluationApprovedBy: "finance-owner",
          lines: [line({ movingAverageValue: "90.00" }), bundle[1]!],
        }),
      ),
      Story.rejected(new OpeningStockConflict()),
      Story.when(load, accept([bundle[0]!])),
      Story.rejected(new OpeningStockConflict()),
      Story.then(load),
    ),
  )

  // [INV-OPEN-4]
  it.effect("another tenant's load with the same openingId is a different instance", () =>
    story(
      Story.given(load, accepted(bundle)),
      Story.when(otherTenant, accept([line({ quantity: "99" })])),
      Story.then(otherTenant, accepted([line({ quantity: "99" })])),
    ),
  )

  // [INV-OPEN-4]
  it("the key depends on the tenant and on the openingId", () => {
    assert.notStrictEqual(openingLoadKey("tenant-a", "o-1"), openingLoadKey("tenant-b", "o-1"))
    assert.notStrictEqual(openingLoadKey("tenant-a", "o-1"), openingLoadKey("tenant-a", "o-2"))
  })
})
