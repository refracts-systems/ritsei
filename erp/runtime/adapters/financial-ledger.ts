import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import {
  FinancialStoreObservationRegistry,
  financialStoreObservationRegistry,
  postgresqlFinancialLedgerLayer,
  postgresqlFinancialStoreObservation,
} from "../../modules/accounting/mod.ts"
import { PostgresDatabaseLive } from "../../../framework/platform/mod.ts"

// PostgreSQL is the only financial authority (ADR-0091).
export const financialLedgerLayer = (database: ReturnType<typeof PostgresDatabaseLive>) =>
  postgresqlFinancialLedgerLayer.pipe(Layer.provide(database))

export const financialStoreObservationLayer = (database: ReturnType<typeof PostgresDatabaseLive>) =>
  Layer.effect(
    FinancialStoreObservationRegistry,
    postgresqlFinancialStoreObservation().pipe(
      Effect.map(({ collector, scanner }) =>
        financialStoreObservationRegistry([
          { authority: "postgresql" as const, collector, scanner },
        ]),
      ),
    ),
  ).pipe(Layer.provide(database))
