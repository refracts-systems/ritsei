import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { InstantString } from "../../../foundation/mod.ts"

const NonEmptyString = Schema.String.check(Schema.isPattern(/\S/))
const Uuid = Schema.String.check(Schema.isUUID())
const PositiveInt = Schema.Int.check(
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(2_147_483_647),
)
const NonNegativeInt = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(2_147_483_647),
)

const MaxPayloadStringLength = 64 * 1024
const MaxPayloadArrayLength = 1_000
const MaxPayloadDepth = 16
const MaxPayloadBytes = 256 * 1024

const isBoundedJson = (value: Schema.Schema.Type<typeof Schema.Json>): boolean => {
  const visit = (current: Schema.Schema.Type<typeof Schema.Json>, depth: number): boolean => {
    if (depth > MaxPayloadDepth) return false
    if (typeof current === "string") return current.length <= MaxPayloadStringLength
    if (Array.isArray(current)) {
      return (
        current.length <= MaxPayloadArrayLength && current.every((item) => visit(item, depth + 1))
      )
    }
    if (typeof current === "object" && current !== null) {
      return Object.entries(current).every(
        ([key, item]) => key.length <= MaxPayloadStringLength && visit(item, depth + 1),
      )
    }
    return true
  }

  return (
    visit(value, 0) && new TextEncoder().encode(JSON.stringify(value)).byteLength <= MaxPayloadBytes
  )
}

const BoundedJson = Schema.Json.check(
  Schema.makeFilter(isBoundedJson, { expected: "a bounded JSON payload" }),
)

export const AppendEventInput = Schema.Struct({
  eventId: Uuid,
  eventType: NonEmptyString,
  eventVersion: PositiveInt,
  tenantId: Uuid,
  aggregateType: NonEmptyString,
  aggregateId: Uuid,
  commandId: NonEmptyString,
  correlationId: NonEmptyString,
  causationId: Schema.NullOr(NonEmptyString),
  idempotencyKey: NonEmptyString,
  actorPrincipalId: NonEmptyString,
  occurredAt: InstantString,
  payload: BoundedJson,
})

export const EventEnvelope = Schema.Struct({
  ...AppendEventInput.fields,
  publishedAt: Schema.NullOr(InstantString),
  attempts: NonNegativeInt,
})

export const GetEventInput = Schema.Struct({ tenantId: Uuid, eventId: Uuid })

export const ConsumeOnceInput = Schema.Struct({
  tenantId: Uuid,
  consumerId: NonEmptyString,
  eventId: Uuid,
})

export const ConsumerReceipt = Schema.Struct({
  ...ConsumeOnceInput.fields,
  eventType: NonEmptyString,
  eventVersion: PositiveInt,
  idempotencyKey: NonEmptyString,
  completedAt: InstantString,
})

export type AppendEventInput = Schema.Schema.Type<typeof AppendEventInput>
export type EventEnvelope = Schema.Schema.Type<typeof EventEnvelope>
export type GetEventInput = Schema.Schema.Type<typeof GetEventInput>
export type ConsumeOnceInput = Schema.Schema.Type<typeof ConsumeOnceInput>
export type ConsumerReceipt = Schema.Schema.Type<typeof ConsumerReceipt>

export type ConsumeOnceResult<A> =
  | { readonly duplicate: false; readonly value: A; readonly receipt: ConsumerReceipt }
  | { readonly duplicate: true; readonly receipt: ConsumerReceipt }

export interface MessagingService {
  readonly append: (
    input: unknown,
  ) => Effect.Effect<
    EventEnvelope,
    | import("./errors.ts").EventIdempotencyConflict
    | import("../../../foundation/mod.ts").DatabaseFailure
    | Schema.SchemaError
  >
  readonly getEvent: (
    input: unknown,
  ) => Effect.Effect<
    EventEnvelope | undefined,
    import("../../../foundation/mod.ts").DatabaseFailure | Schema.SchemaError
  >
  /** The effect must be PostgreSQL-local so it and the completed receipt share one transaction. */
  readonly consumeOnce: <A, E, R>(
    input: unknown,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<
    ConsumeOnceResult<A>,
    E | import("../../../foundation/mod.ts").DatabaseFailure | Schema.SchemaError,
    R
  >
}

export const MessagingService = Context.Service<MessagingService>("RITSEI/MessagingService")
