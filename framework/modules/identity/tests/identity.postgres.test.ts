import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { Database, uuidv7 } from "../../../foundation/mod.ts"
import { makePostgresDatabase, runMigrations } from "../../../platform/mod.ts"
import { withTemporaryDatabase } from "../../../../tests/support/postgres-database.ts"
import { makeMessagingService } from "../../messaging/mod.ts"
import {
  IdentityAccountAuthorizer,
  IdentityEventPublisher,
  makeUserAccountService,
  UserAccountAlreadyExists,
  UserAccountCreatedEvent,
  UserAccountNotFound,
} from "../mod.ts"
import { postgresCode, postgresConstraint } from "../../../../tests/support/postgres-error.ts"

const databaseUrl = process.env["DATABASE_URL"]
const postgresFailure = <A>(effect: () => Promise<A>) =>
  Effect.tryPromise({ try: effect, catch: (cause) => cause }).pipe(Effect.flip)

const makeDatabaseService = (client: Parameters<typeof makePostgresDatabase>[0]) =>
  makeUserAccountService.pipe(Effect.provideService(Database, makePostgresDatabase(client)))

it.effect.skipIf(databaseUrl === undefined)(
  "persists, normalizes, lists, updates, and removes user accounts in PostgreSQL",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const service = yield* makeDatabaseService(client)
        const created = yield* service.create({ email: "  USER@Example.COM " })

        assert.strictEqual(created.email, "user@example.com")
        assert.strictEqual(created.status, "active")
        const persisted = yield* Effect.promise(
          () =>
            client<{ email: string }[]>`
            select email
            from identity.user_accounts
            where id = ${created.id}
          `,
        )
        assert.deepStrictEqual(persisted, [{ email: "user@example.com" }])

        assert.strictEqual((yield* service.getById(created.id)).id, created.id)
        assert.deepStrictEqual(yield* service.getByIds([created.id]), [created])
        assert.strictEqual((yield* service.list()).length, 1)
        assert.strictEqual(
          (yield* service.update({ id: created.id, email: "after@example.com" })).email,
          "after@example.com",
        )
        const invalidEmail = yield* postgresFailure(
          () =>
            client`
            update identity.user_accounts
            set email = ' AFTER@EXAMPLE.COM '
            where id = ${created.id}
          `,
        )
        assert.strictEqual(postgresCode(invalidEmail), "23514")
        assert.strictEqual(
          postgresConstraint(invalidEmail),
          "user_accounts_email_normalization_check",
        )
        const blankEmail = yield* postgresFailure(
          () =>
            client`
            insert into identity.user_accounts (email) values ('   ')
          `,
        )
        assert.strictEqual(postgresCode(blankEmail), "23514")
        assert.strictEqual(
          postgresConstraint(blankEmail),
          "user_accounts_email_normalization_check",
        )

        yield* service.remove(created.id)
        assert.deepStrictEqual(yield* service.list(), [])
        assert.instanceOf(yield* Effect.flip(service.getById(created.id)), UserAccountNotFound)
      }),
    ),
)

it.effect.skipIf(databaseUrl === undefined)(
  "publishes a tenant-scoped user-account creation event",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const database = makePostgresDatabase(client)
        const [tenant] = yield* Effect.promise(
          () =>
            client<{ id: string }[]>`
            insert into auth.tenants (slug) values (${uuidv7()}) returning id
          `,
        )
        const principal = { userAccountId: "identity-test", sessionId: "identity-session" }
        const messaging = yield* makeMessagingService.pipe(
          Effect.provideService(Database, database),
        )
        const service = yield* Effect.provide(
          makeUserAccountService,
          Layer.mergeAll(
            Layer.succeed(Database, database),
            Layer.succeed(IdentityAccountAuthorizer, {
              authorize: () => Effect.void,
            }),
            Layer.succeed(IdentityEventPublisher, { append: messaging.append }),
          ),
        )
        const created = yield* service.createForTenant({
          principal,
          tenantId: tenant!.id,
          email: "identity-event@example.com",
        })
        const [event] = yield* Effect.promise(
          () =>
            client<
              {
                event_type: string
                event_version: number
                aggregate_type: string
                aggregate_id: string
                payload: { userAccountId: string; email: string }
              }[]
            >`
            select event_type, event_version, aggregate_type, aggregate_id, payload
            from messaging.event_outbox
            where tenant_id = ${tenant!.id}
              and event_type = ${UserAccountCreatedEvent.id}
              and aggregate_id = ${created.id}
          `,
        )
        assert.deepStrictEqual(event, {
          event_type: UserAccountCreatedEvent.id,
          event_version: UserAccountCreatedEvent.version,
          aggregate_type: UserAccountCreatedEvent.aggregateType,
          aggregate_id: created.id,
          payload: { userAccountId: created.id, email: created.email },
        })
      }),
    ),
)

it.effect.skipIf(databaseUrl === undefined)(
  "maps the PostgreSQL unique constraint and validates input",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const service = yield* makeDatabaseService(client)
        yield* service.create({ email: "duplicate@example.com" })

        const duplicate = yield* Effect.flip(service.create({ email: " DUPLICATE@example.com " }))
        assert.instanceOf(duplicate, UserAccountAlreadyExists)
        assert.strictEqual(duplicate.email, "duplicate@example.com")

        const updateTarget = yield* service.create({ email: "update@example.com" })
        const updateDuplicate = yield* Effect.flip(
          service.update({ id: updateTarget.id, email: " DUPLICATE@example.com " }),
        )
        assert.instanceOf(updateDuplicate, UserAccountAlreadyExists)
        assert.strictEqual(updateDuplicate.email, "duplicate@example.com")

        const invalid = yield* Effect.flip(service.create({ email: 42 }))
        assert.instanceOf(invalid, Error)
        assert.match(invalid.message, /email/)
        const blank = yield* Effect.flip(service.create({ email: "   " }))
        assert.instanceOf(blank, Error)
        assert.match(blank.message, /email/)
      }),
    ),
)

it.effect.skipIf(databaseUrl === undefined)(
  "persists account disablement and session invalidation state in PostgreSQL",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const service = yield* makeDatabaseService(client)
        const created = yield* service.create({ email: "status@example.test" })
        const activeWithDisabledAt = yield* postgresFailure(
          () =>
            client`
            update identity.user_accounts set disabled_at = now()
            where id = ${created.id}
          `,
        )
        assert.strictEqual(postgresCode(activeWithDisabledAt), "23514")
        assert.strictEqual(
          postgresConstraint(activeWithDisabledAt),
          "user_accounts_status_disabled_at_check",
        )
        assert.strictEqual(
          (yield* service.getAuthenticationState(created.id)).sessionInvalidatedAt,
          null,
        )
        const disabled = yield* service.disable(created.id)
        assert.strictEqual(disabled.status, "disabled")
        const disabledState = yield* service.getAuthenticationState(created.id)
        assert.strictEqual(disabledState.status, "disabled")
        assert.ok(disabledState.sessionInvalidatedAt !== null)
        const disabledWithoutTimestamp = yield* postgresFailure(
          () =>
            client`
            update identity.user_accounts set disabled_at = null
            where id = ${created.id}
          `,
        )
        assert.strictEqual(postgresCode(disabledWithoutTimestamp), "23514")
        assert.strictEqual(
          postgresConstraint(disabledWithoutTimestamp),
          "user_accounts_status_disabled_at_check",
        )
        assert.strictEqual((yield* service.enable(created.id)).status, "active")
        assert.strictEqual((yield* service.getAuthenticationState(created.id)).status, "active")
      }),
    ),
)

it.effect.skipIf(databaseUrl === undefined)(
  "returns UserAccountNotFound for missing PostgreSQL records",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const service = yield* makeDatabaseService(client)
        const missingId = "00000000-0000-0000-0000-000000000000"

        assert.deepStrictEqual(yield* service.getByIds([]), [])
        assert.deepStrictEqual(yield* service.getByIds([missingId]), [])
        assert.instanceOf(yield* Effect.flip(service.getById(missingId)), UserAccountNotFound)
        assert.instanceOf(
          yield* Effect.flip(service.update({ id: missingId, email: "missing@example.com" })),
          UserAccountNotFound,
        )
        assert.instanceOf(
          yield* Effect.flip(service.getAuthenticationState(missingId)),
          UserAccountNotFound,
        )
        assert.instanceOf(yield* Effect.flip(service.disable(missingId)), UserAccountNotFound)
        assert.instanceOf(yield* Effect.flip(service.enable(missingId)), UserAccountNotFound)
        assert.instanceOf(yield* Effect.flip(service.remove(missingId)), UserAccountNotFound)
      }),
    ),
)
