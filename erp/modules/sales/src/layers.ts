import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { SalesService } from "./contract.ts"
import { makeSalesMemoryStore } from "./memory.ts"
import { makeSalesPostgresStore } from "./postgres.ts"
import { makeSalesServiceFromStore } from "./service.ts"

export const makeSalesService = makeSalesServiceFromStore(makeSalesPostgresStore)
export const SalesLive = Layer.effect(SalesService, makeSalesService)
export const makeSalesTestLayer = () =>
  Layer.effect(SalesService, makeSalesServiceFromStore(Effect.succeed(makeSalesMemoryStore())))
