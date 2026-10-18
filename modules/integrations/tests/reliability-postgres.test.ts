import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import { Database } from "../../../foundation/mod.ts"
import { makePostgresDatabase, runMigrations } from "../../../platform/mod.ts"
import { withTemporaryDatabase } from "../../../tests/support/postgres-database.ts"
import {
  ExternalCompatibilityMismatch,
  ExternalIdempotencyConflict,
  ExternalPayloadLimitExceeded,
  makePostgresExternalReliabilityStore,
} from "../mod.ts"

const databaseUrl = process.env["DATABASE_URL"]
const sentAtMs = Date.parse("2026-08-30T00:00:00.000Z")

const makeInput = (tenantId: string, overrides: Record<string, unknown> = {}) => ({
  tenantId,
  replayKey: "event:payments:settled:provider-event-1",
  kind: "event" as const,
  correlationId: "correlation-1",
  reliability: {
    connectorId: "payments",
    connectorVersion: 1,
    operationId: "payments.settled",
    providerStatus: "unknown" as const,
    attempts: 1,
    maxAttempts: 3,
    maxPayloadBytes: 1_024,
    payload: {
      paymentId: "pay-1",
      accessToken: "do-not-retain",
      nested: { clientSecret: "also-secret" },
    },
    sentAtMs,
    observedAtMs: sentAtMs + 45,
    compatibilityRange: { minimumVersion: 1, maximumVersion: 1 },
  },
  ...overrides,
})

it.effect.skipIf(databaseUrl === undefined)(
  "proves durable replay protection, redaction, compatibility, payload limit, dead letter, and health metric",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const [tenant] = yield* Effect.promise(
          () =>
            client<{ id: string }[]>`
            insert into auth.tenants (slug) values (${"integration-reliability-${sentAtMs}"}) returning id
          `,
        )
        const database = makePostgresDatabase(client)
        const store = yield* makePostgresExternalReliabilityStore.pipe(
          Effect.provideService(Database, database),
        )
        const input = makeInput(tenant!.id)

        const first = yield* store.record(input)
        const duplicate = yield* store.record(input)
        assert.strictEqual(first.duplicate, false)
        assert.strictEqual(first.record.state, "retry")
        assert.strictEqual(duplicate.duplicate, true)
        assert.strictEqual(duplicate.record.id, first.record.id)
        assert.deepStrictEqual(first.record.payload, {
          paymentId: "pay-1",
          accessToken: "[REDACTED]",
          nested: { clientSecret: "[REDACTED]" },
        })

        const accepted = yield* store.record({
          ...input,
          reliability: { ...input.reliability, attempts: 2, providerStatus: "accepted" as const },
        })
        assert.strictEqual(accepted.duplicate, false)
        assert.strictEqual(accepted.record.id, first.record.id)
        assert.strictEqual(accepted.record.state, "accepted")

        const restartedStore = yield* makePostgresExternalReliabilityStore.pipe(
          Effect.provideService(Database, database),
        )
        const recovered = yield* restartedStore.get(tenant!.id, input.replayKey)
        assert.strictEqual(recovered?.state, "accepted")
        assert.deepStrictEqual(recovered?.payload, first.record.payload)

        const conflict = yield* Effect.flip(
          restartedStore.record({
            ...input,
            reliability: { ...input.reliability, operationId: "payments.refund" },
          }),
        )
        assert.instanceOf(conflict, ExternalIdempotencyConflict)

        const incompatible = yield* Effect.flip(
          restartedStore.record({
            ...input,
            replayKey: "event:payments:incompatible",
            reliability: { ...input.reliability, connectorVersion: 2 },
          }),
        )
        assert.instanceOf(incompatible, ExternalCompatibilityMismatch)

        const tooLarge = yield* Effect.flip(
          restartedStore.record({
            ...input,
            replayKey: "event:payments:too-large",
            reliability: { ...input.reliability, maxPayloadBytes: 1 },
          }),
        )
        assert.instanceOf(tooLarge, ExternalPayloadLimitExceeded)

        const deadLetter = yield* restartedStore.record({
          ...input,
          replayKey: "event:payments:dead-letter",
          reliability: {
            ...input.reliability,
            providerStatus: "rejected" as const,
            attempts: 3,
          },
        })
        assert.strictEqual(deadLetter.record.state, "dead_letter")

        const health = yield* restartedStore.health(tenant!.id, "payments")
        assert.strictEqual(health.sampleSize, 2)
        assert.strictEqual(health.accepted, 1)
        assert.strictEqual(health.deadLetters, 1)
        assert.strictEqual(health.unknownProviderStatus, 0)
        assert.strictEqual(health.maxLagMs, 45)
        assert.strictEqual(health.averageLagMs, 45)
      }),
    ),
)
