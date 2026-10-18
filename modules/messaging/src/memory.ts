import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import * as Semaphore from "effect/Semaphore"
import { DatabaseFailure } from "../../../foundation/mod.ts"
import {
  AppendEventInput,
  ConsumeOnceInput,
  ConsumerReceipt,
  EventEnvelope,
  GetEventInput,
  MessagingService,
  MessagingService as MessagingServiceTag,
} from "./contract.ts"
import { conflict, envelopeMatches, receiptKey, receiptMatchesEvent } from "./store.ts"

export const makeMessagingTestLayer = () => {
  const eventsById = new Map<string, EventEnvelope>()
  const eventIdsByDedupe = new Map<string, string>()
  const receipts = new Map<string, ConsumerReceipt>()
  // ponytail: global lock; use keyed permits if test-layer consumer throughput matters.
  const consumeSemaphore = Semaphore.makeUnsafe(1)
  let clock = 0
  const eventKey = (tenantId: string, eventId: string) => `${tenantId}:${eventId}`
  const dedupeKey = (input: AppendEventInput) =>
    `${input.tenantId}:${input.eventType}:${input.eventVersion}:${input.idempotencyKey}`

  const append = Effect.fn("MessagingService.append")(function*(input: unknown) {
    const decoded = yield* Schema.decodeUnknownEffect(AppendEventInput)(input)
    const byId = eventsById.get(eventKey(decoded.tenantId, decoded.eventId))
    const dedupedId = eventIdsByDedupe.get(dedupeKey(decoded))
    const byDedupe = dedupedId === undefined
      ? undefined
      : eventsById.get(eventKey(decoded.tenantId, dedupedId))
    const existing = byId ?? byDedupe
    if (existing !== undefined && byId === byDedupe && envelopeMatches(decoded, existing)) {
      return existing
    }
    if (existing !== undefined) return yield* Effect.fail(conflict(decoded))
    const event: EventEnvelope = { ...decoded, publishedAt: null, attempts: 0 }
    eventsById.set(eventKey(decoded.tenantId, decoded.eventId), event)
    eventIdsByDedupe.set(dedupeKey(decoded), decoded.eventId)
    return event
  })

  const getEvent = Effect.fn("MessagingService.getEvent")(function*(input: unknown) {
    const decoded = yield* Schema.decodeUnknownEffect(GetEventInput)(input)
    return eventsById.get(eventKey(decoded.tenantId, decoded.eventId))
  })

  const consumeOnce = <A, E, R>(input: unknown, effect: Effect.Effect<A, E, R>) =>
    Semaphore.withPermit(
      consumeSemaphore,
      Effect.fn("MessagingService.consumeOnce")(function*() {
        const decoded = yield* Schema.decodeUnknownEffect(ConsumeOnceInput)(input)
        const source = eventsById.get(eventKey(decoded.tenantId, decoded.eventId))
        if (source === undefined) {
          return yield* Effect.fail(
            new DatabaseFailure({
              operation: "messaging.receipt.complete",
              cause: new Error("source event does not exist for tenant"),
            }),
          )
        }
        const key = receiptKey(decoded)
        const existing = receipts.get(key)
        if (existing !== undefined) {
          if (!receiptMatchesEvent(existing, source)) {
            return yield* Effect.fail(
              new DatabaseFailure({
                operation: "messaging.receipt.complete",
                cause: new Error("consumer receipt event identity does not match source"),
              }),
            )
          }
          return { duplicate: true as const, receipt: existing }
        }
        const eventSnapshot = new Map(eventsById)
        const dedupeSnapshot = new Map(eventIdsByDedupe)
        const receiptSnapshot = new Map(receipts)
        const rollback = () => {
          eventsById.clear()
          eventIdsByDedupe.clear()
          receipts.clear()
          for (const [key, value] of eventSnapshot) eventsById.set(key, value)
          for (const [key, value] of dedupeSnapshot) eventIdsByDedupe.set(key, value)
          for (const [key, value] of receiptSnapshot) receipts.set(key, value)
        }
        const result = yield* Effect.result(effect)
        if (Result.isFailure(result)) {
          rollback()
          return yield* Effect.fail(result.failure)
        }
        const receipt: ConsumerReceipt = {
          ...decoded,
          eventType: source.eventType,
          eventVersion: source.eventVersion,
          idempotencyKey: source.idempotencyKey,
          completedAt: new Date(clock++).toISOString(),
        }
        receipts.set(key, receipt)
        return { duplicate: false as const, value: result.success, receipt }
      })(),
    )

  const service: MessagingService = { append, getEvent, consumeOnce }
  return Layer.succeed(MessagingServiceTag, service)
}
