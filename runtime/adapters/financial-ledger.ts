import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import {
  FinancialLedgerPort,
  makePostgresqlFinancialLedgerLayer,
  makePostgresqlFinancialStoreObservation,
} from "../../modules/accounting/mod.ts"
import {
  FinancialStoreObservationRegistry,
  makeFinancialStoreObservationRegistry,
} from "../../modules/accounting/mod.ts"
import {
  makeTigerBeetleFinancialLedger,
  makeTigerBeetleFinancialStoreObservation,
  PostgresDatabaseLive,
} from "../../platform/mod.ts"
import type { RitseiRuntimeConfiguration } from "../config.ts"

export const makeFinancialLedgerLayer = (
  database: ReturnType<typeof PostgresDatabaseLive>,
  configuration: RitseiRuntimeConfiguration,
) => {
  if (configuration.financialAuthority === "postgresql") {
    return makePostgresqlFinancialLedgerLayer.pipe(Layer.provide(database))
  }

  return Layer.effect(
    FinancialLedgerPort,
    makeTigerBeetleFinancialLedger(configuration.tigerBeetle),
  )
}

export const makeFinancialStoreObservationLayer = (
  database: ReturnType<typeof PostgresDatabaseLive>,
  configuration: RitseiRuntimeConfiguration,
) => {
  const postgresql = makePostgresqlFinancialStoreObservation()
  const providers =
    configuration.financialAuthority === "postgresql"
      ? postgresql.pipe(
          Effect.map(({ collector, scanner }) => [
            {
              authority: "postgresql" as const,
              collector,
              scanner,
            },
          ]),
        )
      : Effect.all([
          postgresql,
          makeTigerBeetleFinancialStoreObservation(configuration.tigerBeetle),
        ]).pipe(
          Effect.map(([postgresqlProvider, tigerbeetleProvider]) => [
            {
              authority: "postgresql" as const,
              collector: postgresqlProvider.collector,
              scanner: postgresqlProvider.scanner,
            },
            {
              authority: "tigerbeetle" as const,
              collector: tigerbeetleProvider.collector,
              scanner: tigerbeetleProvider.scanner,
            },
          ]),
        )
  return Layer.effect(
    FinancialStoreObservationRegistry,
    providers.pipe(Effect.map(makeFinancialStoreObservationRegistry)),
  ).pipe(Layer.provide(database))
}
