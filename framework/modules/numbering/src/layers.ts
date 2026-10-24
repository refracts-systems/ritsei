import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { NumberingService } from "./contract.ts"
import { makeMemoryNumberingService } from "./memory.ts"
import { makePostgresNumberingService } from "./postgres.ts"

export const NumberingLive = Layer.effect(NumberingService, makePostgresNumberingService())

export const makeNumberingTestLayer = () =>
  Layer.effect(NumberingService, Effect.sync(makeMemoryNumberingService))
