import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { InstantString } from "../../../foundation/time/mod.ts"
import type { ExternalSchema } from "./contract.ts"
import { ExternalPayloadInvalid } from "./errors.ts"
import { decodeExternalSchema } from "./schema.ts"

const Uuid = Schema.String.check(Schema.isUUID())
const MaxFieldLength = 256
const BoundedNonEmptyString = Schema.String.check(
  Schema.isPattern(/\S/),
  Schema.isMaxLength(MaxFieldLength),
)

export const CloudEventsEnvelope = Schema.Struct({
  specversion: Schema.Literals(["1.0"]),
  type: BoundedNonEmptyString,
  source: BoundedNonEmptyString,
  id: BoundedNonEmptyString,
  time: InstantString,
  datacontenttype: Schema.Literals(["application/json"]),
  subject: Schema.optional(BoundedNonEmptyString),
  data: Schema.Json,
})

export type CloudEventsEnvelope = Schema.Schema.Type<typeof CloudEventsEnvelope>

export type NormalizeExternalEventInput = {
  readonly tenantId: string
  readonly connectorId: string
  readonly expectedType: string
  readonly envelope: unknown
  readonly payloadSchema: ExternalSchema
}

export type NormalizedExternalEvent = {
  readonly kind: "ExternalEvent"
  readonly envelope: "CloudEvents 1.0.x"
  readonly tenantId: string
  readonly connectorId: string
  readonly id: string
  readonly type: string
  readonly source: string
  readonly payload: unknown
}

// CloudEvents is a separate envelope from the validated ExternalEvent payload.
export const normalizeCloudEvent = (
  input: NormalizeExternalEventInput,
): Effect.Effect<NormalizedExternalEvent, ExternalPayloadInvalid> =>
  Effect.gen(function*() {
    const identifier = typeof input.expectedType === "string" && input.expectedType.trim() !== ""
      ? input.expectedType.slice(0, MaxFieldLength)
      : "external-event"
    if (
      !Schema.is(Uuid)(input.tenantId)
      || !Schema.is(BoundedNonEmptyString)(input.connectorId)
      || !Schema.is(BoundedNonEmptyString)(input.expectedType)
    ) {
      return yield* Effect.fail(
        new ExternalPayloadInvalid({
          boundary: "integration.cloudevents.scope",
          identifier,
        }),
      )
    }
    const envelope = yield* Schema.decodeUnknownEffect(CloudEventsEnvelope)(input.envelope).pipe(
      Effect.mapError(() =>
        new ExternalPayloadInvalid({
          boundary: "integration.cloudevents.envelope",
          identifier,
        })
      ),
    )
    if (envelope.type !== input.expectedType) {
      return yield* Effect.fail(
        new ExternalPayloadInvalid({
          boundary: "integration.cloudevents.type",
          identifier,
        }),
      )
    }
    const payload = yield* decodeExternalSchema(input.payloadSchema, envelope.data).pipe(
      Effect.mapError(() =>
        new ExternalPayloadInvalid({
          boundary: "integration.cloudevents.payload",
          identifier,
        })
      ),
    )
    return {
      kind: "ExternalEvent" as const,
      envelope: "CloudEvents 1.0.x" as const,
      tenantId: input.tenantId,
      connectorId: input.connectorId,
      id: envelope.id,
      type: envelope.type,
      source: envelope.source,
      payload,
    }
  })
