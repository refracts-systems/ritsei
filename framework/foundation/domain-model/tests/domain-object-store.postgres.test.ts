import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import type { Sql } from "postgres"

import { postgresCode, postgresConstraint } from "../../../../tests/support/postgres-error.ts"
import { withTemporaryDatabase } from "../../../../tests/support/postgres-database.ts"
import { runMigrations } from "../../../platform/mod.ts"

const databaseUrl = process.env["DATABASE_URL"]

const immutable = "domain_model_recorded_events_immutable"

// The host's own statements, copied from @alchemy.run/domain 2.0.0-beta.87 (EffectCluster/index.ts),
// run with the table name unqualified as the host sends it.
const hostCreate = `CREATE TABLE IF NOT EXISTS alchemy_domain_objects (
  object TEXT COLLATE "C" NOT NULL,
  key TEXT COLLATE "C" NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (object, key)
)`

const hostPut = `INSERT INTO alchemy_domain_objects (object, key, value) VALUES ($1, $2, $3)
  ON CONFLICT (object, key) DO UPDATE SET value = excluded.value`

const object = "Bank/Account/a-1"

const put = (sql: Sql, key: string, value: string) =>
  Effect.promise(() => sql.unsafe(hostPut, [object, key, JSON.stringify(value)]))

/** The SQLSTATE and constraint of the failure a statement raises. */
const refusal = <A>(run: () => PromiseLike<A>) =>
  Effect.flip(
    Effect.tryPromise({
      try: run,
      catch: (cause) => ({
        code: String(postgresCode(cause)),
        constraint: String(postgresConstraint(cause)),
      }),
    }),
  )

const hostSession = <A, E>(
  client: Sql,
  use: (sql: Sql) => Effect.Effect<A, E>,
): Effect.Effect<A, E> =>
  Effect.acquireUseRelease(
    Effect.promise(async () => {
      const sql = await client.reserve()
      await sql.unsafe("SET search_path = domain_model")

      return sql
    }),
    use,
    (sql) => Effect.sync(() => sql.release()),
  )

it.effect.skipIf(databaseUrl === undefined)(
  "keeps recorded events unchangeable while the host's state rows stay writable",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)

        yield* hostSession(client, (sql) =>
          Effect.gen(function* () {
            // The migration made the table the host expects, so its own create is a no-op.
            const columns = yield* Effect.promise(
              () => sql<{ column_name: string; collation_name: string | null }[]>`
                select column_name, collation_name from information_schema.columns
                where table_schema = 'domain_model' and table_name = 'alchemy_domain_objects'
                order by ordinal_position`,
            )

            assert.deepStrictEqual(
              columns.map(({ column_name, collation_name }) => [column_name, collation_name]),
              [
                ["object", "C"],
                ["key", "C"],
                ["value", null],
              ],
            )
            yield* Effect.promise(() => sql.unsafe(hostCreate))

            // Appending an event, the host's only write to an event key, works.
            yield* put(sql, "event:000000000001", "opened")
            yield* put(sql, "event:000000000002", "deposited")

            // Rewriting, deleting, renaming into, or truncating the events is refused.
            const rewrite = yield* refusal(() =>
              sql.unsafe(hostPut, [object, "event:000000000001", JSON.stringify("changed")]),
            )

            assert.strictEqual(rewrite.code, "55000")
            assert.strictEqual(rewrite.constraint, immutable)

            const remove = yield* refusal(
              () => sql`delete from alchemy_domain_objects where key = 'event:000000000002'`,
            )

            assert.strictEqual(remove.constraint, immutable)

            yield* put(sql, "snapshot", "state")

            const rename = yield* refusal(
              () =>
                sql`update alchemy_domain_objects set key = 'event:000000000003' where key = 'snapshot'`,
            )

            assert.strictEqual(rename.constraint, immutable)

            const truncate = yield* refusal(() => sql`truncate alchemy_domain_objects`)
            assert.strictEqual(truncate.constraint, immutable)

            // State, receipts, and outbox rows keep changing and being deleted, as the host does.
            yield* put(sql, "meta", "v1")
            yield* put(sql, "meta", "v2")
            yield* put(sql, "outbox:000000000001", "pending")
            yield* Effect.promise(
              () => sql`delete from alchemy_domain_objects where key = 'outbox:000000000001'`,
            )

            const rows = yield* Effect.promise(
              () => sql<{ key: string; value: string }[]>`
                select key, value from alchemy_domain_objects where object = ${object} order by key`,
            )

            assert.deepStrictEqual(
              rows.map(({ key, value }) => [key, JSON.parse(value)]),
              [
                ["event:000000000001", "opened"],
                ["event:000000000002", "deposited"],
                ["meta", "v2"],
                ["snapshot", "state"],
              ],
            )
          }),
        )
      }),
    ),
)

it.effect.skipIf(databaseUrl === undefined)(
  "lets the host run its table creation only where its role holds CREATE on the schema",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const role = `domain_host_${Date.now()}`

        yield* Effect.acquireUseRelease(
          Effect.promise(async () => {
            await client.unsafe(`create role ${role} nologin`)
            await client.unsafe(`grant ${role} to current_user with set true`)
            await client.unsafe(`grant usage on schema domain_model to ${role}`)
            await client.unsafe(
              `grant select, insert, update, delete on domain_model.alchemy_domain_objects to ${role}`,
            )
          }),
          () =>
            hostSession(client, (sql) =>
              Effect.gen(function* () {
                const asHost = (statement: string) => async () => {
                  try {
                    await sql.unsafe(`begin; set local role ${role}; ${statement}; commit`).simple()
                  } catch (cause) {
                    await sql.unsafe("rollback")
                    throw cause
                  }
                }

                // The table exists, yet PostgreSQL checks CREATE on the schema before it looks.
                const denied = yield* refusal(asHost(hostCreate))
                assert.strictEqual(denied.code, "42501")

                yield* Effect.promise(() =>
                  sql.unsafe(`grant create on schema domain_model to ${role}`),
                )
                yield* Effect.promise(asHost(hostCreate))
              }),
            ),
          () =>
            Effect.promise(async () => {
              await client.unsafe(`drop owned by ${role}`)
              await client.unsafe(`drop role ${role}`)
            }),
        )
      }),
    ),
)
