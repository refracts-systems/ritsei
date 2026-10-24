import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { ExternalPayloadInvalid, normalizeCloudEvent } from "../mod.ts"

const PaymentPayload = Schema.Struct({ paymentId: Schema.String, amount: Schema.Number })

const envelope = {
  specversion: "1.0" as const,
  type: "payments.settled",
  source: "https://provider.example",
  id: "provider-event-1",
  time: "2026-08-30T00:00:00.000Z",
  datacontenttype: "application/json" as const,
  subject: "payment/pay-1",
  data: { paymentId: "pay-1", amount: 12.5 },
}

it.effect("validates a separate envelope and normalized ExternalEvent payload", () =>
  Effect.gen(function* () {
    const event = yield* normalizeCloudEvent({
      tenantId: "018f3f77-0c5a-7cc0-8b62-6a163d214123",
      connectorId: "payments",
      expectedType: "payments.settled",
      envelope,
      payloadSchema: PaymentPayload,
    })

    assert.strictEqual(event.kind, "ExternalEvent")
    assert.strictEqual(event.envelope, "CloudEvents 1.0.x")
    assert.deepStrictEqual(event.payload, { paymentId: "pay-1", amount: 12.5 })
  }),
)

it.effect("rejects malformed or oversized CloudEvents fields", () =>
  Effect.gen(function* () {
    const malformedTime = yield* Effect.flip(
      normalizeCloudEvent({
        tenantId: "018f3f77-0c5a-7cc0-8b62-6a163d214123",
        connectorId: "payments",
        expectedType: "payments.settled",
        envelope: { ...envelope, time: "not-a-timestamp" },
        payloadSchema: PaymentPayload,
      }),
    )

    const oversizedId = yield* Effect.flip(
      normalizeCloudEvent({
        tenantId: "018f3f77-0c5a-7cc0-8b62-6a163d214123",
        connectorId: "payments",
        expectedType: "payments.settled",
        envelope: { ...envelope, id: "x".repeat(257) },
        payloadSchema: PaymentPayload,
      }),
    )

    assert.instanceOf(malformedTime, ExternalPayloadInvalid)
    assert.instanceOf(oversizedId, ExternalPayloadInvalid)
  }),
)

it.effect("rejects a mismatched event type or payload", () =>
  Effect.gen(function* () {
    const typeFailure = yield* Effect.flip(
      normalizeCloudEvent({
        tenantId: "018f3f77-0c5a-7cc0-8b62-6a163d214123",
        connectorId: "payments",
        expectedType: "payments.refunded",
        envelope,
        payloadSchema: PaymentPayload,
      }),
    )

    const payloadFailure = yield* Effect.flip(
      normalizeCloudEvent({
        tenantId: "018f3f77-0c5a-7cc0-8b62-6a163d214123",
        connectorId: "payments",
        expectedType: "payments.settled",
        envelope: { ...envelope, data: { paymentId: 42, amount: "bad" } },
        payloadSchema: PaymentPayload,
      }),
    )

    assert.instanceOf(typeFailure, ExternalPayloadInvalid)
    assert.instanceOf(payloadFailure, ExternalPayloadInvalid)
  }),
)
