/**
 * A view over stock events keyed by warehouse (the pilot's tenant), so one key folds a tenant's
 * whole history. A factory, so the third model can bump its `version` to ask the host for a rebuild.
 */
import * as Domain from "@alchemy.run/domain"
import * as Schema from "effect/Schema"

import { StockItem } from "../../../../foundation/domain-model/tests/delivery-model.ts"

export const WarehouseId = Schema.String.pipe(Schema.brand("WarehouseId"))

const warehouseOf = (stockItemId: string) => WarehouseId.make(stockItemId.split("/")[0]!)

/** What one warehouse has issued and had returned, over its whole history. */
export const warehouseMovements = (version: number) =>
  class WarehouseMovements extends Domain.View("WarehouseMovements", {
    from: [StockItem],
    key: WarehouseId,
    version,
    keyOf: {
      StockIssued: ({ source }) => warehouseOf(source.id),
      StockReturned: ({ source }) => warehouseOf(source.id),
    },
    state: Schema.Struct({ issued: Schema.Int, returned: Schema.Int }),
    initial: { issued: 0, returned: 0 },
    evolve: {
      StockIssued: (view) => ({ ...view, issued: view.issued + 1 }),
      StockReturned: (view) => ({ ...view, returned: view.returned + 1 }),
    },
  }) {}
