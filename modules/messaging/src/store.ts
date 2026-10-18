import * as Equal from "effect/Equal"
import { consumerReceipts, eventOutbox } from "../../../db/schema/messaging.ts"
import { AppendEventInput, ConsumeOnceInput, ConsumerReceipt, EventEnvelope } from "./contract.ts"
import { EventIdempotencyConflict } from "./errors.ts"

export const selectEvent = {
  eventId: eventOutbox.id,
  eventType: eventOutbox.eventType,
  eventVersion: eventOutbox.eventVersion,
  tenantId: eventOutbox.tenantId,
  aggregateType: eventOutbox.aggregateType,
  aggregateId: eventOutbox.aggregateId,
  commandId: eventOutbox.commandId,
  correlationId: eventOutbox.correlationId,
  causationId: eventOutbox.causationId,
  idempotencyKey: eventOutbox.idempotencyKey,
  actorPrincipalId: eventOutbox.actorPrincipalId,
  occurredAt: eventOutbox.occurredAt,
  payload: eventOutbox.payload,
  publishedAt: eventOutbox.publishedAt,
  attempts: eventOutbox.attempts,
}

export const selectReceipt = {
  tenantId: consumerReceipts.tenantId,
  consumerId: consumerReceipts.consumerId,
  eventId: consumerReceipts.eventId,
  eventType: consumerReceipts.eventType,
  eventVersion: consumerReceipts.eventVersion,
  idempotencyKey: consumerReceipts.idempotencyKey,
  completedAt: consumerReceipts.completedAt,
}

export type EventRow = Omit<EventEnvelope, "occurredAt" | "publishedAt" | "payload"> & {
  readonly occurredAt: Date
  readonly publishedAt: Date | null
  readonly payload: unknown
}
export type ReceiptRow = Omit<ConsumerReceipt, "completedAt"> & { readonly completedAt: Date }

export const toEvent = (row: EventRow) => ({
  ...row,
  occurredAt: row.occurredAt.toISOString(),
  publishedAt: row.publishedAt?.toISOString() ?? null,
})

export const toReceipt = (row: ReceiptRow): ConsumerReceipt => ({
  ...row,
  completedAt: row.completedAt.toISOString(),
})

export const envelopeMatches = (input: AppendEventInput, event: EventEnvelope) =>
  input.eventId === event.eventId && input.eventType === event.eventType
  && input.eventVersion === event.eventVersion && input.tenantId === event.tenantId
  && input.aggregateType === event.aggregateType && input.aggregateId === event.aggregateId
  && input.commandId === event.commandId && input.correlationId === event.correlationId
  && input.causationId === event.causationId && input.idempotencyKey === event.idempotencyKey
  && input.actorPrincipalId === event.actorPrincipalId
  && new Date(input.occurredAt).getTime() === new Date(event.occurredAt).getTime()
  && Equal.equals(input.payload, event.payload)

export const conflict = (input: AppendEventInput) =>
  new EventIdempotencyConflict({
    tenantId: input.tenantId,
    eventId: input.eventId,
    eventType: input.eventType,
    eventVersion: input.eventVersion,
    idempotencyKey: input.idempotencyKey,
  })

export const receiptMatchesEvent = (
  receipt: ConsumerReceipt,
  event: Pick<EventEnvelope, "eventType" | "eventVersion" | "idempotencyKey">,
) =>
  receipt.eventType === event.eventType && receipt.eventVersion === event.eventVersion
  && receipt.idempotencyKey === event.idempotencyKey

export const receiptKey = (input: ConsumeOnceInput) =>
  `${input.tenantId}:${input.consumerId}:${input.eventId}`
