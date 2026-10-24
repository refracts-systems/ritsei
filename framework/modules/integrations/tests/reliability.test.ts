import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import {
  assessExternalDelivery,
  ExternalCompatibilityMismatch,
  ExternalPayloadLimitExceeded,
} from "../mod.ts"

const baseInput = {
  connectorId: "midtrans",
  connectorVersion: 1,
  operationId: "createPayment",
  providerStatus: "unknown" as const,
  attempts: 1,
  maxAttempts: 3,
  maxPayloadBytes: 1_024,
  payload: {
    providerPaymentId: "pay-1",
    accessToken: "do-not-retain",
    nested: { clientSecret: "also-secret" },
  },
  sentAtMs: 100,
  observedAtMs: 145,
  compatibilityRange: { minimumVersion: 1, maximumVersion: 1 },
}

it.effect("checks compatibility and payload limit with redaction", () =>
  Effect.gen(function* () {
    const decision = yield* assessExternalDelivery(baseInput)
    assert.strictEqual(decision.state, "retry")
    assert.strictEqual(decision.providerStatus, "unknown")
    assert.strictEqual(decision.lagMs, 45)
    assert.deepStrictEqual(decision.payload, {
      providerPaymentId: "pay-1",
      accessToken: "[REDACTED]",
      nested: { clientSecret: "[REDACTED]" },
    })

    const incompatible = yield* Effect.flip(
      assessExternalDelivery({
        ...baseInput,
        connectorVersion: 2,
      }),
    )

    assert.instanceOf(incompatible, ExternalCompatibilityMismatch)

    const tooLarge = yield* Effect.flip(
      assessExternalDelivery({
        ...baseInput,
        maxPayloadBytes: 1,
      }),
    )

    assert.instanceOf(tooLarge, ExternalPayloadLimitExceeded)
  }),
)

it.effect("moves a provider failure to a dead letter after bounded attempts", () =>
  Effect.gen(function* () {
    const decision = yield* assessExternalDelivery({
      ...baseInput,
      attempts: 3,
      maxAttempts: 3,
    })

    assert.strictEqual(decision.state, "dead_letter")
    assert.strictEqual(decision.attempts, 3)
  }),
)
