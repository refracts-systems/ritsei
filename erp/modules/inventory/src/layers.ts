import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { InventoryService } from "./contract.ts"
import { makeInventoryMemoryLayer } from "./memory.ts"
import { makeInventoryService, makeInventoryServiceFromStore } from "./service.ts"

export { makeInventoryService } from "./service.ts"

export const makeInventoryTestLayer = () =>
  Layer.effect(
    InventoryService,
    makeInventoryServiceFromStore(
      Effect.provide(
        Effect.gen(function* () {
          return yield* InventoryService
        }),
        makeInventoryMemoryLayer(),
      ),
    ),
  )

export const makeInventoryPostgresLayer = () => Layer.effect(InventoryService, makeInventoryService)
export const InventoryLive = makeInventoryPostgresLayer()
