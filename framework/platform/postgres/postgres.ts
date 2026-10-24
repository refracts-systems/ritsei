import { drizzle } from "drizzle-orm/postgres-js"
import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import type { Sql } from "postgres"

import {
  CurrentDatabaseTransaction,
  DatabaseFailure,
  type DatabaseService,
  type DrizzleDatabase,
  type PostgresClient,
  type PostgresTransaction,
  UnsupportedPostgresVersion,
} from "../../foundation/database/mod.ts"

/** Presents a postgres.js client through the narrow client interface the version check needs. */
export const asPostgresClient = (client: Sql): PostgresClient => ({
  begin: <A>(callback: (transaction: PostgresTransaction) => Promise<A>) =>
    // SAFETY: begin resolves with the callback's result; postgres.js types it through UnwrapPromiseArray.
    client.begin((transaction) => {
      const adapted: PostgresTransaction = {
        // SAFETY: postgres.js types parameters as its own union; any readonly array of bindable values works.
        unsafe: <Row extends Record<string, unknown>>(
          query: string,
          parameters?: readonly unknown[],
        ) => transaction.unsafe<Row[]>(query, parameters as never[] | undefined),
      }

      return callback(adapted)
    }) as Promise<A>,
})

class TransactionEffectFailure<E> extends Error {
  constructor(readonly failure: E) {
    super("transaction effect failed")
  }
}

const makeVersionValidation = (
  client: PostgresClient,
): Effect.Effect<void, DatabaseFailure | UnsupportedPostgresVersion> => {
  let validated = false
  let validationPromise: Promise<void> | undefined

  return Effect.tryPromise({
    try: async () => {
      if (validated) return
      validationPromise ??= client.begin(async (connection) => {
        const rows = await connection.unsafe<{ server_version_num: string }>(
          "show server_version_num",
        )

        const serverVersionNum = rows[0]?.server_version_num ?? "unknown"
        const version = Number.parseInt(serverVersionNum, 10)

        if (!Number.isInteger(version) || version < 190000) {
          throw new UnsupportedPostgresVersion({ serverVersionNum })
        }
      })
      await validationPromise
      validated = true
    },
    catch: (cause) =>
      cause instanceof UnsupportedPostgresVersion
        ? cause
        : new DatabaseFailure({ operation: "version-check", cause }),
  })
}

export const validatePostgresVersion = (client: PostgresClient) => makeVersionValidation(client)

export const makePostgresDatabase = (client: Sql): DatabaseService => {
  const validateVersion = makeVersionValidation(asPostgresClient(client))
  const database = drizzle({ client })

  const validate = validateVersion.pipe(
    Effect.mapError((cause) =>
      cause instanceof DatabaseFailure
        ? cause
        : new DatabaseFailure({ operation: "version-check", cause }),
    ),
  )

  return {
    query: (operation, operationName = "query") =>
      Effect.andThen(
        validate,
        Effect.gen(function* () {
          const transaction = yield* CurrentDatabaseTransaction

          return yield* Effect.tryPromise({
            try: () =>
              transaction === undefined
                ? operation(database)
                : // SAFETY: a drizzle transaction exposes the query surface that operations use on DrizzleDatabase.
                  operation(transaction as DrizzleDatabase),
            catch: (cause) => new DatabaseFailure({ operation: operationName, cause }),
          })
        }),
      ),
    transaction: (operation, operationName = "transaction") =>
      Effect.andThen(
        validate,
        Effect.gen(function* () {
          const transaction = yield* CurrentDatabaseTransaction

          return yield* Effect.tryPromise({
            try: () =>
              transaction === undefined ? database.transaction(operation) : operation(transaction),
            catch: (cause) => new DatabaseFailure({ operation: operationName, cause }),
          })
        }),
      ),
    withTransaction: <A, E, R>(operation: Effect.Effect<A, E, R>, operationName = "transaction") =>
      Effect.andThen(
        validate,
        Effect.gen(function* () {
          const current = yield* CurrentDatabaseTransaction

          if (current !== undefined) return yield* operation

          const context = yield* Effect.context<R>()

          const outcome = yield* Effect.tryPromise({
            try: () =>
              database.transaction(async (transaction) => {
                const result = await Effect.runPromise(
                  Effect.provideService(
                    Effect.provideContext(Effect.result(operation), context),
                    CurrentDatabaseTransaction,
                    transaction,
                  ),
                )

                if (Result.isFailure(result)) {
                  throw new TransactionEffectFailure(result.failure)
                }

                return result.success
              }),
            catch: (cause) =>
              cause instanceof TransactionEffectFailure
                ? // SAFETY: TransactionEffectFailure is thrown only with the failure of this transaction's effect.
                  { _tag: "effect-failure" as const, error: cause.failure as E }
                : {
                    _tag: "database-failure" as const,
                    error: new DatabaseFailure({ operation: operationName, cause }),
                  },
          }).pipe(Effect.result)

          if (Result.isFailure(outcome)) return yield* Effect.fail(outcome.failure.error)

          return outcome.success
        }),
      ),
  }
}
