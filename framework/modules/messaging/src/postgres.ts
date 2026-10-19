import { and, eq, or } from "drizzle-orm"
import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import { consumerReceipts, eventOutbox } from "../../../../db/schema/messaging.ts"
import { Database, DatabaseFailure, isDatabaseConstraint } from "../../../foundation/mod.ts"
import {
  AppendEventInput,
  ConsumeOnceInput,
  EventEnvelope,
  GetEventInput,
  MessagingService,
} from "./contract.ts"
import {
  conflict,
  envelopeMatches,
  receiptMatchesEvent,
  selectEvent,
  selectReceipt,
  toEvent,
  toReceipt,
} from "./store.ts"

const decodePersistedEvent = (row: Parameters<typeof toEvent>[0], operation: string) =>
  Schema.decodeUnknownEffect(EventEnvelope)(toEvent(row)).pipe(
    Effect.mapError(
      () => new DatabaseFailure({ operation, cause: "persisted event envelope failed validation" }),
    ),
  )

export const makePostgresMessagingService = Effect.fn("Messaging.makePostgresService")(
  function* () {
    const database = yield* Database

    const findReceipt = (input: ConsumeOnceInput) =>
      database
        .query(
          (db) =>
            db
              .select(selectReceipt)
              .from(consumerReceipts)
              .where(
                and(
                  eq(consumerReceipts.tenantId, input.tenantId),
                  eq(consumerReceipts.consumerId, input.consumerId),
                  eq(consumerReceipts.eventId, input.eventId),
                ),
              ),
          "messaging.receipt.get",
        )
        .pipe(Effect.map((rows) => (rows[0] === undefined ? undefined : toReceipt(rows[0]))))

    const findEventIdentity = (input: ConsumeOnceInput) =>
      database
        .query(
          (db) =>
            db
              .select({
                eventType: eventOutbox.eventType,
                eventVersion: eventOutbox.eventVersion,
                idempotencyKey: eventOutbox.idempotencyKey,
              })
              .from(eventOutbox)
              .where(
                and(eq(eventOutbox.tenantId, input.tenantId), eq(eventOutbox.id, input.eventId)),
              ),
          "messaging.receipt.source.lookup",
        )
        .pipe(Effect.map((rows) => rows[0]))

    const identityFailure = () =>
      new DatabaseFailure({
        operation: "messaging.receipt.complete",
        cause: new Error("consumer receipt event identity does not match source"),
      })

    const append = Effect.fn("MessagingService.append")(function* (input: unknown) {
      const decoded = yield* Schema.decodeUnknownEffect(AppendEventInput)(input)
      const occurredAt = new Date(decoded.occurredAt)
      return yield* database.withTransaction(
        Effect.gen(function* () {
          const inserted = yield* database.query(
            (db) =>
              db
                .insert(eventOutbox)
                .values({
                  id: decoded.eventId,
                  eventType: decoded.eventType,
                  eventVersion: decoded.eventVersion,
                  tenantId: decoded.tenantId,
                  aggregateType: decoded.aggregateType,
                  aggregateId: decoded.aggregateId,
                  commandId: decoded.commandId,
                  correlationId: decoded.correlationId,
                  causationId: decoded.causationId,
                  idempotencyKey: decoded.idempotencyKey,
                  actorPrincipalId: decoded.actorPrincipalId,
                  occurredAt,
                  payload: decoded.payload,
                })
                .onConflictDoNothing()
                .returning(selectEvent),
            "messaging.event.append",
          )
          if (inserted[0] !== undefined) {
            return yield* decodePersistedEvent(inserted[0], "messaging.event.append.decode")
          }
          const existing = yield* database.query(
            (db) =>
              db
                .select(selectEvent)
                .from(eventOutbox)
                .where(
                  or(
                    and(
                      eq(eventOutbox.tenantId, decoded.tenantId),
                      eq(eventOutbox.id, decoded.eventId),
                    ),
                    and(
                      eq(eventOutbox.tenantId, decoded.tenantId),
                      eq(eventOutbox.eventType, decoded.eventType),
                      eq(eventOutbox.eventVersion, decoded.eventVersion),
                      eq(eventOutbox.idempotencyKey, decoded.idempotencyKey),
                    ),
                  ),
                ),
            "messaging.event.get-existing",
          )
          if (existing.length !== 1) return yield* Effect.fail(conflict(decoded))
          const event = yield* decodePersistedEvent(
            existing[0]!,
            "messaging.event.append.decode-existing",
          )
          return envelopeMatches(decoded, event) ? event : yield* Effect.fail(conflict(decoded))
        }),
        "messaging.event.append-transaction",
      )
    })

    const getEvent = Effect.fn("MessagingService.getEvent")(function* (input: unknown) {
      const decoded = yield* Schema.decodeUnknownEffect(GetEventInput)(input)
      const rows = yield* database.query(
        (db) =>
          db
            .select(selectEvent)
            .from(eventOutbox)
            .where(
              and(eq(eventOutbox.tenantId, decoded.tenantId), eq(eventOutbox.id, decoded.eventId)),
            ),
        "messaging.event.get",
      )
      return rows[0] === undefined
        ? undefined
        : yield* decodePersistedEvent(rows[0], "messaging.event.get.decode")
    })

    const consumeOnce = <A, E, R>(input: unknown, effect: Effect.Effect<A, E, R>) =>
      Effect.fn("MessagingService.consumeOnce")(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(ConsumeOnceInput)(input)
        const result = yield* database
          .withTransaction(
            Effect.gen(function* () {
              const source = yield* findEventIdentity(decoded)
              if (source === undefined) {
                return yield* Effect.fail(
                  new DatabaseFailure({
                    operation: "messaging.receipt.complete",
                    cause: new Error("source event does not exist for tenant"),
                  }),
                )
              }
              const existing = yield* findReceipt(decoded)
              if (existing !== undefined) {
                if (!receiptMatchesEvent(existing, source)) {
                  return yield* Effect.fail(identityFailure())
                }
                return { duplicate: true as const, receipt: existing }
              }
              const value = yield* effect
              const rows = yield* database.query(
                (db) =>
                  db
                    .insert(consumerReceipts)
                    .values({ ...decoded, ...source })
                    .returning(selectReceipt),
                "messaging.receipt.complete",
              )
              return { duplicate: false as const, value, receipt: toReceipt(rows[0]!) }
            }),
            "messaging.consume-once",
          )
          .pipe(Effect.result)
        if (Result.isSuccess(result)) return result.success
        if (isDatabaseConstraint(result.failure, "consumer_receipts_pkey")) {
          const receipt = yield* findReceipt(decoded)
          if (receipt !== undefined) {
            const source = yield* findEventIdentity(decoded)
            if (source !== undefined && receiptMatchesEvent(receipt, source)) {
              return { duplicate: true as const, receipt }
            }
            if (source !== undefined) return yield* Effect.fail(identityFailure())
          }
        }
        return yield* Effect.fail(result.failure)
      })()

    return { append, getEvent, consumeOnce } satisfies MessagingService
  },
)()
