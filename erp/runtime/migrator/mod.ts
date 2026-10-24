import "../../../tooling/load-env.ts"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import postgres from "postgres"

import { runMigrations } from "../../../framework/platform/mod.ts"
import { isMain } from "../../../tooling/entrypoint.ts"

export const migrate = (url: string) => {
  const client = postgres(url)

  return Effect.acquireUseRelease(
    Effect.succeed(client),
    (connection) => runMigrations(connection),
    (connection) => Effect.promise(() => connection.end()),
  )
}

if (isMain(import.meta.url)) {
  const url = process.env["DATABASE_URL"]

  if (url === undefined || url.trim() === "") {
    console.error("DATABASE_URL is required")
    process.exit(1)
  }

  const result = await Effect.runPromiseExit(migrate(url))

  if (Exit.isFailure(result)) {
    console.error(result.cause)
    process.exit(1)
  }

  console.log("Database migrations are up to date")
}
