import type { PostgresJsDatabase, PostgresJsTransaction } from "drizzle-orm/postgres-js"
import type { AnyRelations, EmptyRelations } from "drizzle-orm/relations"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

export interface PostgresTransaction {
  readonly unsafe: <Row extends Record<string, unknown>>(
    query: string,
    parameters?: readonly unknown[],
  ) => Promise<readonly Row[]>
}

export interface PostgresClient {
  readonly begin: <A>(callback: (transaction: PostgresTransaction) => Promise<A>) => Promise<A>
}

export type DrizzleDatabase = PostgresJsDatabase<EmptyRelations>
export type DrizzleTransaction = PostgresJsTransaction<AnyRelations>

export const CurrentDatabaseTransaction = Context.Reference<DrizzleTransaction | undefined>(
  "RITSEI/CurrentDatabaseTransaction",
  { defaultValue: () => undefined },
)

export class DatabaseFailure extends Schema.TaggedError<DatabaseFailure>()("DatabaseFailure", {
  operation: Schema.String,
  cause: Schema.Unknown,
}) {}

const unwrapCause = (cause: unknown): unknown =>
  typeof cause === "object" && cause !== null && "cause" in cause && cause.cause !== undefined
    ? unwrapCause(cause.cause)
    : cause

export const isDatabaseConstraint = (error: unknown, constraint: string, code = "23505") => {
  if (!(error instanceof DatabaseFailure)) return false
  const cause = unwrapCause(error.cause)
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    cause.code === code &&
    (("constraint" in cause && cause.constraint === constraint) ||
      ("constraint_name" in cause && cause.constraint_name === constraint))
  )
}

export class UnsupportedPostgresVersion extends Schema.TaggedError<UnsupportedPostgresVersion>()(
  "UnsupportedPostgresVersion",
  {
    serverVersionNum: Schema.String,
  },
) {
  override get message() {
    return `PostgreSQL 19 or newer is required; server_version_num is ${this.serverVersionNum}.`
  }
}

export interface DatabaseService {
  readonly query: <A>(
    operation: (database: DrizzleDatabase) => Promise<A>,
    operationName?: string,
  ) => Effect.Effect<A, DatabaseFailure>
  readonly transaction: <A>(
    operation: (transaction: DrizzleTransaction) => Promise<A>,
    operationName?: string,
  ) => Effect.Effect<A, DatabaseFailure>
  readonly withTransaction: <A, E, R>(
    operation: Effect.Effect<A, E, R>,
    operationName?: string,
  ) => Effect.Effect<A, E | DatabaseFailure, R>
}

export const Database = Context.Service<DatabaseService>("RITSEI/Database")
