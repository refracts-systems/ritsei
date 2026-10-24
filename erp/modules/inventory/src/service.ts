import * as Effect from "effect/Effect"

import type { InventoryService } from "./contract.ts"
import { makeInventoryPostgresService } from "./postgres.ts"

export const makeInventoryServiceFromStore = <R>(
  store: Effect.Effect<InventoryService, never, R>,
): Effect.Effect<InventoryService, never, R> =>
  Effect.gen(function* () {
    const implementation = yield* store

    return {
      listWarehouses: Effect.fn("InventoryService.listWarehouses")(
        (input: Parameters<typeof implementation.listWarehouses>[0]) =>
          implementation.listWarehouses(input),
      ),
      listItems: Effect.fn("InventoryService.listItems")(
        (input: Parameters<typeof implementation.listItems>[0]) => implementation.listItems(input),
      ),
      listStockBalances: Effect.fn("InventoryService.listStockBalances")(
        (input: Parameters<typeof implementation.listStockBalances>[0]) =>
          implementation.listStockBalances(input),
      ),
      listStockReservations: Effect.fn("InventoryService.listStockReservations")(
        (input: Parameters<typeof implementation.listStockReservations>[0]) =>
          implementation.listStockReservations(input),
      ),
      listStockTransfers: Effect.fn("InventoryService.listStockTransfers")(
        (input: Parameters<typeof implementation.listStockTransfers>[0]) =>
          implementation.listStockTransfers(input),
      ),
      listStockMovements: Effect.fn("InventoryService.listStockMovements")(
        (input: Parameters<typeof implementation.listStockMovements>[0]) =>
          implementation.listStockMovements(input),
      ),
      createWarehouse: Effect.fn("InventoryService.createWarehouse")(
        (input: Parameters<typeof implementation.createWarehouse>[0]) =>
          implementation.createWarehouse(input),
      ),
      createItem: Effect.fn("InventoryService.createItem")(
        (input: Parameters<typeof implementation.createItem>[0]) =>
          implementation.createItem(input),
      ),
      receiveStock: Effect.fn("InventoryService.receiveStock")(
        (input: Parameters<typeof implementation.receiveStock>[0]) =>
          implementation.receiveStock(input),
      ),
      adjustStock: Effect.fn("InventoryService.adjustStock")(
        (input: Parameters<typeof implementation.adjustStock>[0]) =>
          implementation.adjustStock(input),
      ),
      reserveStock: Effect.fn("InventoryService.reserveStock")(
        (input: Parameters<typeof implementation.reserveStock>[0]) =>
          implementation.reserveStock(input),
      ),
      releaseReservation: Effect.fn("InventoryService.releaseReservation")(
        (input: Parameters<typeof implementation.releaseReservation>[0]) =>
          implementation.releaseReservation(input),
      ),
      fulfillReservation: Effect.fn("InventoryService.fulfillReservation")(
        (input: Parameters<typeof implementation.fulfillReservation>[0]) =>
          implementation.fulfillReservation(input),
      ),
      createTransfer: Effect.fn("InventoryService.createTransfer")(
        (input: Parameters<typeof implementation.createTransfer>[0]) =>
          implementation.createTransfer(input),
      ),
      confirmTransfer: Effect.fn("InventoryService.confirmTransfer")(
        (input: Parameters<typeof implementation.confirmTransfer>[0]) =>
          implementation.confirmTransfer(input),
      ),
      completeTransfer: Effect.fn("InventoryService.completeTransfer")(
        (input: Parameters<typeof implementation.completeTransfer>[0]) =>
          implementation.completeTransfer(input),
      ),
    } satisfies InventoryService
  })

export const makeInventoryService = makeInventoryServiceFromStore(makeInventoryPostgresService)
