import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { Database, type DatabaseService } from "../../framework/foundation/mod.ts"
import { FinancialLedgerPort } from "../modules/accounting/mod.ts"
import { financialLedgerLayer } from "./adapters/financial-ledger.ts"

// SAFETY: the database is never queried in this test.
const unusedDatabase = Layer.succeed(Database, {
  query: () => Effect.die("database should not be queried while composing the ledger"),
  transaction: () => Effect.die("database should not be queried while composing the ledger"),
  withTransaction: () => Effect.die("database should not be queried while composing the ledger"),
} as DatabaseService)

it.effect("composes the PostgreSQL financial ledger", () =>
  Effect.gen(function* () {
    const ledger = yield* Effect.provide(
      Effect.gen(function* () {
        return yield* FinancialLedgerPort
      }),
      financialLedgerLayer(unusedDatabase),
    )

    assert.strictEqual(ledger.authority, "postgresql")
  }),
)
