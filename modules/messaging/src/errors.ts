import * as Schema from "effect/Schema"
import { AppendEventInput } from "./contract.ts"

export class EventIdempotencyConflict
  extends Schema.TaggedError<EventIdempotencyConflict>()("EventIdempotencyConflict", {
    tenantId: AppendEventInput.fields.tenantId,
    eventId: AppendEventInput.fields.eventId,
    eventType: AppendEventInput.fields.eventType,
    eventVersion: AppendEventInput.fields.eventVersion,
    idempotencyKey: AppendEventInput.fields.idempotencyKey,
  })
{}
