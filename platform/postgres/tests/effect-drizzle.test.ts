import { PgClient } from "@effect/sql-pg/PgClient"
import { assert, it } from "@effect/vitest"
import { makeWithDefaults } from "drizzle-orm/effect-postgres"
import * as Effect from "effect/Effect"
import * as HttpApi from "effect/http-api/HttpApi"

it("resolves Effect and Drizzle through the npm package topology", () => {
  assert.strictEqual(typeof PgClient, "function")
  assert.strictEqual(typeof makeWithDefaults, "function")
  assert.strictEqual(Effect.isEffect(makeWithDefaults()), true)
  assert.strictEqual(typeof HttpApi.make, "function")
})
