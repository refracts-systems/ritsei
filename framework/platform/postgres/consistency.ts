import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import type { Sql } from "postgres"

import {
  type PostgresReadYourWritesConfig,
  type PostgresReadYourWritesService,
} from "../../foundation/database/mod.ts"
import {
  ConsistencyToken,
  isConsistencyLsn,
  PostgresReadYourWrites,
  ReplicaConsistencyFailure,
} from "../../foundation/database/mod.ts"
import { makePostgresDatabase } from "./postgres.ts"

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const TokenPayload = Schema.Struct({
  version: Schema.Literal(1),
  tenantId: Schema.String.check(Schema.isUUID()),
  placementId: Schema.String.check(Schema.isPattern(/\S/)),
  systemIdentifier: Schema.String.check(Schema.isPattern(/^\d+$/)),
  timelineId: Schema.Int.check(Schema.isGreaterThan(0)),
  lsn: Schema.String.check(Schema.isPattern(/^[0-9A-F]+\/[0-9A-F]+$/i)),
  issuedAt: Schema.Int,
  expiresAt: Schema.Int,
})

type TokenPayload = Schema.Schema.Type<typeof TokenPayload>

const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")

const fromBase64Url = (value: string) => {
  const base64 = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=")
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
}

const invalidConfiguration = () =>
  new ReplicaConsistencyFailure({ reason: "invalid_configuration" })

const validateConfig = (config: PostgresReadYourWritesConfig) =>
  config.placementId.trim().length > 0 &&
  encoder.encode(config.secret).length >= 32 &&
  Number.isInteger(config.maxWaitMs) &&
  config.maxWaitMs > 0 &&
  config.maxWaitMs <= 30_000 &&
  Number.isInteger(config.tokenTtlMs) &&
  config.tokenTtlMs > 0 &&
  config.tokenTtlMs <= 3_600_000

const importHmacKey = (secret: string) =>
  Effect.tryPromise({
    try: () =>
      crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"],
      ),
    catch: invalidConfiguration,
  })

const databaseIdentity = (client: Sql, operation: "capture" | "wait") =>
  Effect.tryPromise({
    try: async () => {
      const rows = await client.unsafe<
        Array<{ readonly system_identifier: string; readonly timeline_id: number }>
      >(
        "select (pg_control_system()).system_identifier::text as system_identifier, " +
          "(pg_control_checkpoint()).timeline_id as timeline_id",
      )
      const identity = rows[0]
      if (identity === undefined) throw new Error("PostgreSQL identity is unavailable")
      return identity
    },
    catch: () =>
      new ReplicaConsistencyFailure({
        reason: operation === "capture" ? "capture_failed" : "wait_failed",
      }),
  })

// Capture insertion rather than flush position: async commit can report a committed write before
// its WAL is flushed; the replica wait remains the bounded check for replay visibility.
const capturePosition = (client: Sql) =>
  Effect.tryPromise({
    try: async () => {
      const rows = await client.unsafe<Array<{ readonly lsn: string }>>(
        "select pg_current_wal_insert_lsn()::text as lsn",
      )
      const lsn = rows[0]?.lsn
      if (lsn === undefined || !isConsistencyLsn(lsn)) {
        throw new Error("PostgreSQL LSN is unavailable")
      }
      return lsn
    },
    catch: () => new ReplicaConsistencyFailure({ reason: "capture_failed" }),
  })

const signPayload = (key: CryptoKey, payload: TokenPayload) =>
  Effect.tryPromise({
    try: async () => {
      const encodedPayload = toBase64Url(encoder.encode(JSON.stringify(payload)))
      const signature = new Uint8Array(
        await crypto.subtle.sign("HMAC", key, encoder.encode(encodedPayload)),
      )
      return `${encodedPayload}.${toBase64Url(signature)}` as ConsistencyToken
    },
    catch: () => new ReplicaConsistencyFailure({ reason: "capture_failed" }),
  })

const decodePayload = (key: CryptoKey, token: string) =>
  Effect.gen(function* () {
    const [encodedPayload, encodedSignature, extra] = token.split(".")
    if (encodedPayload === undefined || encodedSignature === undefined || extra !== undefined) {
      return yield* Effect.fail(new ReplicaConsistencyFailure({ reason: "invalid_token" }))
    }
    const valid = yield* Effect.tryPromise({
      try: () =>
        crypto.subtle.verify(
          "HMAC",
          key,
          fromBase64Url(encodedSignature),
          encoder.encode(encodedPayload),
        ),
      catch: () => new ReplicaConsistencyFailure({ reason: "invalid_token" }),
    })
    if (!valid) {
      return yield* Effect.fail(new ReplicaConsistencyFailure({ reason: "invalid_token" }))
    }
    const unknownPayload = yield* Effect.try({
      try: () => JSON.parse(decoder.decode(fromBase64Url(encodedPayload))) as unknown,
      catch: () => new ReplicaConsistencyFailure({ reason: "invalid_token" }),
    })
    return yield* Schema.decodeUnknownEffect(TokenPayload)(unknownPayload).pipe(
      Effect.mapError(() => new ReplicaConsistencyFailure({ reason: "invalid_token" })),
    )
  })

const waitForReplay = (client: Sql, lsn: string, maxWaitMs: number) =>
  Effect.tryPromise({
    try: async () => {
      if (!isConsistencyLsn(lsn)) throw new Error("Invalid LSN")
      const rows = await client.unsafe<Array<{ readonly status: string }>>(
        `WAIT FOR LSN '${lsn.toUpperCase()}' WITH (` +
          `MODE 'standby_replay', TIMEOUT '${maxWaitMs}ms', NO_THROW)`,
      )
      return rows[0]?.status
    },
    catch: () => new ReplicaConsistencyFailure({ reason: "wait_failed" }),
  })

export const makePostgresReadYourWrites = (
  primaryClient: Sql,
  replicaClient: Sql,
  config: PostgresReadYourWritesConfig,
  now: () => number = Date.now,
): Effect.Effect<PostgresReadYourWritesService, ReplicaConsistencyFailure> =>
  Effect.gen(function* () {
    if (!validateConfig(config)) return yield* Effect.fail(invalidConfiguration())
    const key = yield* importHmacKey(config.secret)
    const replicaDatabase = makePostgresDatabase(replicaClient)

    return {
      capture: (tenantId) =>
        Effect.gen(function* () {
          const identity = yield* databaseIdentity(primaryClient, "capture")
          const lsn = yield* capturePosition(primaryClient)
          const issuedAt = now()
          return yield* signPayload(key, {
            version: 1,
            tenantId,
            placementId: config.placementId,
            systemIdentifier: identity.system_identifier,
            timelineId: identity.timeline_id,
            lsn,
            issuedAt,
            expiresAt: issuedAt + config.tokenTtlMs,
          })
        }),
      wait: (tenantId, token) =>
        Effect.gen(function* () {
          const payload = yield* decodePayload(key, token)
          if (payload.expiresAt <= now()) {
            return yield* Effect.fail(new ReplicaConsistencyFailure({ reason: "expired_token" }))
          }
          if (payload.tenantId !== tenantId) {
            return yield* Effect.fail(new ReplicaConsistencyFailure({ reason: "tenant_mismatch" }))
          }
          if (payload.placementId !== config.placementId) {
            return yield* Effect.fail(
              new ReplicaConsistencyFailure({ reason: "placement_mismatch" }),
            )
          }
          const identity = yield* databaseIdentity(replicaClient, "wait")
          if (payload.systemIdentifier !== identity.system_identifier) {
            return yield* Effect.fail(
              new ReplicaConsistencyFailure({ reason: "placement_mismatch" }),
            )
          }
          if (payload.timelineId !== identity.timeline_id) {
            return yield* Effect.fail(
              new ReplicaConsistencyFailure({ reason: "timeline_mismatch" }),
            )
          }
          const status = yield* waitForReplay(replicaClient, payload.lsn, config.maxWaitMs)
          if (status === "success") return replicaDatabase
          if (status === "timeout") {
            return yield* Effect.fail(new ReplicaConsistencyFailure({ reason: "timeout" }))
          }
          if (status === "not in recovery") {
            return yield* Effect.fail(new ReplicaConsistencyFailure({ reason: "not_in_recovery" }))
          }
          return yield* Effect.fail(new ReplicaConsistencyFailure({ reason: "wait_failed" }))
        }),
    } satisfies PostgresReadYourWritesService
  })

export const PostgresReadYourWritesLive = (
  primaryClient: Sql,
  replicaClient: Sql,
  config: PostgresReadYourWritesConfig,
) =>
  Layer.effect(
    PostgresReadYourWrites,
    makePostgresReadYourWrites(primaryClient, replicaClient, config),
  )
