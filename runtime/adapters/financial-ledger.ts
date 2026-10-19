import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import {
  FinancialStoreObservationRegistry,
  makeFinancialStoreObservationRegistry,
  makePostgresqlFinancialLedgerLayer,
  makePostgresqlFinancialStoreObservation,
} from "../../modules/accounting/mod.ts"
import { PostgresDatabaseLive } from "../../platform/mod.ts"

// PostgreSQL is the only financial authority (ADR-0091).
export const makeFinancialLedgerLayer = (database: ReturnType<typeof PostgresDatabaseLive>) =>
  makePostgresqlFinancialLedgerLayer.pipe(Layer.provide(database))

export const makeFinancialStoreObservationLayer = (
  database: ReturnType<typeof PostgresDatabaseLive>,
) =>
  Layer.effect(
    FinancialStoreObservationRegistry,
    makePostgresqlFinancialStoreObservation().pipe(
      Effect.map(({ collector, scanner }) =>
        makeFinancialStoreObservationRegistry([
          { authority: "postgresql" as const, collector, scanner },
        ]),
      ),
    ),
  ).pipe(Layer.provide(database))
