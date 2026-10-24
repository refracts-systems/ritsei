import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { ProductService } from "./contract.ts"
import { makeProductMemoryStore } from "./memory.ts"
import { makeProductPostgresStore } from "./postgres.ts"
import { makeProductServiceFromStore } from "./service.ts"

export const makeProductService = makeProductServiceFromStore(makeProductPostgresStore())
export const ProductLive = Layer.effect(ProductService, makeProductService)

export const makeProductTestLayer = () =>
  Layer.effect(ProductService, makeProductServiceFromStore(Effect.sync(makeProductMemoryStore)))
