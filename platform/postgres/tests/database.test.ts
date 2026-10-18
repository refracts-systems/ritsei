import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import type { Sql } from "postgres"

import { userAccounts } from "../../../db/schema/identity.ts"
import {
  DatabaseFailure,
  isDatabaseConstraint,
  type PostgresClient,
  ReplicaConsistencyFailure,
  UnsupportedPostgresVersion,
} from "../../../foundation/database/mod.ts"
import {
  makePostgresDatabase,
  makePostgresReadYourWrites,
  validatePostgresVersion,
} from "../mod.ts"

const makeClient = (version = "190000") => {
  const queries: Array<{ sql: string; parameters: readonly unknown[] }> = []
  const client = {
    options: { parsers: {}, serializers: {} },
    unsafe: <Row extends Record<string, unknown>>(
      query: string,
      parameters: readonly unknown[] = [],
    ) => {
      queries.push({ sql: query, parameters })
      const rows = query === "show server_version_num"
        ? [{ server_version_num: version }]
        : [{ id: "018f0000-0000-7000-8000-000000000000", email: "typed@example.com" }]
      const result = Promise.resolve(rows as unknown as readonly Row[])
      return Object.assign(result, {
        values: () => Promise.resolve(rows.map((row) => Object.values(row))),
      })
    },
    begin: <A>(operation: (transaction: unknown) => Promise<A>) => operation(client),
  }
  return { client: client as unknown as Sql, queries }
}

const makeConsistencyClient = (
  options: {
    readonly lsn?: string
    readonly status?: string
    readonly systemIdentifier?: string
    readonly timelineId?: number
  } = {},
) => {
  const queries: string[] = []
  const client = {
    options: { parsers: {}, serializers: {} },
    unsafe: <Row extends Record<string, unknown>>(query: string) => {
      queries.push(query)
      const rows = query.includes("pg_current_wal_insert_lsn")
        ? [{ lsn: options.lsn ?? "0/306EE20" }]
        : query.startsWith("WAIT FOR")
        ? [{ status: options.status ?? "success" }]
        : [{
          system_identifier: options.systemIdentifier ?? "7673735797966302046",
          timeline_id: options.timelineId ?? 1,
        }]
      return Promise.resolve(rows as unknown as readonly Row[])
    },
  }
  return { client: client as unknown as Sql, queries }
}

const consistencyConfig = {
  placementId: "test-cluster",
  secret: "01234567890123456789012345678901",
  maxWaitMs: 500,
  tokenTtlMs: 60_000,
}

const tenantId = "018f0000-0000-7000-8000-000000000001"

describe("database service", () => {
  it.effect("executes typed Drizzle queries", () =>
    Effect.gen(function*() {
      const { client, queries } = makeClient()
      const database = makePostgresDatabase(client)

      const rows = yield* database.query((db) =>
        db.select({ id: userAccounts.id, email: userAccounts.email }).from(userAccounts)
      )

      assert.strictEqual(rows[0]?.email, "typed@example.com")
      assert.match(queries.at(-1)?.sql ?? "", /from "identity"\."user_accounts"/i)
    }))

  it.effect("unwraps Drizzle failures when mapping constraints", () =>
    Effect.sync(() => {
      const driverError = { code: "23505", constraint_name: "user_accounts_email_key" }
      const failure = new DatabaseFailure({
        operation: "user-account.create",
        cause: new Error("query failed", { cause: driverError }),
      })

      assert.strictEqual(isDatabaseConstraint(failure, "user_accounts_email_key"), true)
    }))

  it.effect("rejects PostgreSQL versions below 19", () =>
    Effect.gen(function*() {
      const { client } = makeClient("180000")
      const error = yield* Effect.flip(
        validatePostgresVersion(client as unknown as PostgresClient),
      )

      assert.instanceOf(error, UnsupportedPostgresVersion)
    }))

  it.effect("captures and waits for an opaque PostgreSQL consistency token", () =>
    Effect.gen(function*() {
      const primary = makeConsistencyClient()
      const replica = makeConsistencyClient()
      const service = yield* makePostgresReadYourWrites(
        primary.client,
        replica.client,
        consistencyConfig,
      )
      const token = yield* service.capture(tenantId)
      yield* service.wait(tenantId, token)

      assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
      assert.isTrue(
        primary.queries.some((query) => query.includes("pg_current_wal_insert_lsn")),
      )
      assert.isTrue(
        replica.queries.some((query) =>
          query
            === "WAIT FOR LSN '0/306EE20' WITH (MODE 'standby_replay', TIMEOUT '500ms', NO_THROW)"
        ),
      )
    }))

  it.effect("rejects tampered and cross-tenant consistency tokens", () =>
    Effect.gen(function*() {
      const primary = makeConsistencyClient()
      const replica = makeConsistencyClient()
      const service = yield* makePostgresReadYourWrites(
        primary.client,
        replica.client,
        consistencyConfig,
      )
      const token = yield* service.capture(tenantId)
      const tampered = yield* Effect.flip(service.wait(tenantId, `${token}x`))
      const wrongTenant = yield* Effect.flip(
        service.wait("018f0000-0000-7000-8000-000000000002", token),
      )

      assert.instanceOf(tampered, ReplicaConsistencyFailure)
      assert.strictEqual(tampered.reason, "invalid_token")
      assert.strictEqual(wrongTenant.reason, "tenant_mismatch")
    }))

  it.effect("rejects expired consistency tokens", () =>
    Effect.gen(function*() {
      const { client: primary } = makeConsistencyClient()
      const { client: replica } = makeConsistencyClient()
      let now = 1_000
      const service = yield* makePostgresReadYourWrites(
        primary,
        replica,
        { ...consistencyConfig, tokenTtlMs: 1 },
        () => now,
      )
      const token = yield* service.capture(tenantId)
      now += 2_000
      const failure = yield* Effect.flip(service.wait(tenantId, token))

      assert.strictEqual(failure.reason, "expired_token")
    }))

  it.effect("rejects promotion and timeline mismatches before replica reads", () =>
    Effect.gen(function*() {
      const primary = makeConsistencyClient()
      const promotedReplica = makeConsistencyClient({ systemIdentifier: "different-cluster" })
      const service = yield* makePostgresReadYourWrites(
        primary.client,
        promotedReplica.client,
        consistencyConfig,
      )
      const token = yield* service.capture(tenantId)
      const placementFailure = yield* Effect.flip(service.wait(tenantId, token))

      assert.strictEqual(placementFailure.reason, "placement_mismatch")

      const timelineReplica = makeConsistencyClient({ timelineId: 2 })
      const timelineService = yield* makePostgresReadYourWrites(
        primary.client,
        timelineReplica.client,
        consistencyConfig,
      )
      const timelineToken = yield* timelineService.capture(tenantId)
      const timelineFailure = yield* Effect.flip(
        timelineService.wait(tenantId, timelineToken),
      )

      assert.strictEqual(timelineFailure.reason, "timeline_mismatch")
    }))

  it.effect("maps non-recovery and unknown replica wait statuses", () =>
    Effect.gen(function*() {
      const primary = makeConsistencyClient()
      const notInRecovery = makeConsistencyClient({ status: "not in recovery" })
      const service = yield* makePostgresReadYourWrites(
        primary.client,
        notInRecovery.client,
        consistencyConfig,
      )
      const token = yield* service.capture(tenantId)
      const failure = yield* Effect.flip(service.wait(tenantId, token))
      assert.strictEqual(failure.reason, "not_in_recovery")

      const unknownStatus = makeConsistencyClient({ status: "unexpected" })
      const unknownService = yield* makePostgresReadYourWrites(
        primary.client,
        unknownStatus.client,
        consistencyConfig,
      )
      const unknownToken = yield* unknownService.capture(tenantId)
      const unknownFailure = yield* Effect.flip(
        unknownService.wait(tenantId, unknownToken),
      )
      assert.strictEqual(unknownFailure.reason, "wait_failed")
    }))

  it.effect("maps bounded replica wait timeouts", () =>
    Effect.gen(function*() {
      const primary = makeConsistencyClient()
      const replica = makeConsistencyClient({ status: "timeout" })
      const service = yield* makePostgresReadYourWrites(
        primary.client,
        replica.client,
        consistencyConfig,
      )
      const token = yield* service.capture(tenantId)
      const failure = yield* Effect.flip(service.wait(tenantId, token))

      assert.strictEqual(failure.reason, "timeout")
    }))
})
