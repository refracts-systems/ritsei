import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { NumberingLive } from "../../../../framework/modules/numbering/mod.ts"
import { SalesService } from "./contract.ts"
import { NoCreditExposureLive } from "./credit.ts"
import { makeSalesMemoryStore } from "./memory.ts"
import { makeSalesPostgresStore } from "./postgres.ts"
import { makeSalesServiceFromStore } from "./service.ts"

const makeServiceWithCredit = makeSalesServiceFromStore(makeSalesPostgresStore)

/**
 * Without a source of what customers owe, so no credit limit is ever reached, and with PostgreSQL
 * numbering on the calendar year; the runtime's `SalesLive` takes its own numbering instead.
 */
export const makeSalesService = makeServiceWithCredit.pipe(
  Effect.provide(NoCreditExposureLive),
  Effect.provide(NumberingLive),
)

/** Needs a `CreditExposure` and a `NumberingService`; the runtime provides Billing's and its own. */
export const SalesLive = Layer.effect(SalesService, makeServiceWithCredit)

export const makeSalesTestLayer = () =>
  Layer.effect(
    SalesService,
    makeSalesServiceFromStore(Effect.succeed(makeSalesMemoryStore())),
  ).pipe(Layer.provide(NoCreditExposureLive))
