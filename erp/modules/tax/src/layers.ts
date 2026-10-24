import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { TaxService } from "./contract.ts"
import { makeTaxMemoryStore } from "./memory.ts"
import { makeTaxPostgresStore } from "./postgres.ts"
import { makeTaxServiceFromStore } from "./service.ts"

export const makeTaxService = makeTaxServiceFromStore(makeTaxPostgresStore())
export const TaxLive = Layer.effect(TaxService, makeTaxService)

export const makeTaxTestLayer = () =>
  Layer.effect(TaxService, makeTaxServiceFromStore(Effect.sync(makeTaxMemoryStore)))
