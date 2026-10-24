import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { SalesService } from "./contract.ts"
import { NoCreditExposureLive } from "./credit.ts"
import { makeSalesMemoryStore } from "./memory.ts"
import { makeSalesPostgresStore } from "./postgres.ts"
import { makeSalesServiceFromStore } from "./service.ts"

const makeServiceWithCredit = makeSalesServiceFromStore(makeSalesPostgresStore)

/** Without a source of what customers owe, so no credit limit is ever reached. */
export const makeSalesService = makeServiceWithCredit.pipe(Effect.provide(NoCreditExposureLive))

/** Needs a `CreditExposure`; the runtime provides Billing's. */
export const SalesLive = Layer.effect(SalesService, makeServiceWithCredit)

export const makeSalesTestLayer = () =>
  Layer.effect(
    SalesService,
    makeSalesServiceFromStore(Effect.succeed(makeSalesMemoryStore())),
  ).pipe(Layer.provide(NoCreditExposureLive))
