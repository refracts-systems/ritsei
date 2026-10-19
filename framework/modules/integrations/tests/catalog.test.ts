import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  defineExternalAction,
  ExternalProblemDetails,
  type ExternalSchema,
  simulateWithoutSideEffect,
  validateExternalActionDefinition,
} from "../mod.ts"

const PaymentInput = Schema.Struct({ amount: Schema.String })
const PaymentOutput = Schema.Struct({ providerPaymentId: Schema.String })

const createPayment = defineExternalAction({
  kind: "ExternalAction",
  id: "midtrans.payment.create",
  version: 1,
  connectorId: "midtrans",
  operationId: "createPayment",
  stability: "PUBLIC",
  compatibilityRange: { minimumVersion: 1, maximumVersion: 1 },
  inputSchema: PaymentInput,
  outputSchema: PaymentOutput,
  errorSchemas: [ExternalProblemDetails],
  requiredScope: "payments:create",
  idempotencyStrategy: "required",
  timeoutPolicy: { timeoutMs: 5_000 },
  retryPolicy: { maxAttempts: 3 },
  compensation: { kind: "action", actionId: "midtrans.payment.refund", version: 1 },
  allowlisted: true,
})

it.effect("simulates an allowlisted external catalog action without side effects", () =>
  Effect.gen(function* () {
    const result = yield* simulateWithoutSideEffect({
      tenantId: "018f3f77-0c5a-7cc0-8b62-6a163d214123",
      action: createPayment,
      input: { amount: "10.00" },
    })

    assert.strictEqual(result.simulated, true)
    assert.strictEqual(result.sideEffect, false)
    assert.strictEqual(result.actionId, createPayment.id)
    assert.strictEqual(result.version, 1)
    assert.deepStrictEqual(result.validatedInput, { amount: "10.00" })
  }),
)

it.effect("rejects malformed catalog metadata and forged schemas before simulation", () =>
  Effect.gen(function* () {
    assert.isFalse(
      validateExternalActionDefinition({
        ...createPayment,
        timeoutPolicy: { timeoutMs: 0 },
      }),
    )

    const forged = { ...createPayment, inputSchema: {} as ExternalSchema }
    const failure = yield* Effect.flip(
      simulateWithoutSideEffect({
        tenantId: "018f3f77-0c5a-7cc0-8b62-6a163d214123",
        action: forged,
        input: { amount: "10.00" },
      }),
    )
    assert.strictEqual(failure._tag, "ExternalPayloadInvalid")
  }),
)

it.effect("keeps transport absent from Process IR and uses a separate OAuth scope", () =>
  Effect.gen(function* () {
    const result = yield* simulateWithoutSideEffect({
      tenantId: "018f3f77-0c5a-7cc0-8b62-6a163d214123",
      action: createPayment,
      input: { amount: "10.00" },
    })

    assert.isFalse("transport" in result)
    assert.strictEqual(result.requiredScope, "payments:create")
    assert.notStrictEqual(result.requiredScope, createPayment.id)
  }),
)

it.effect("rejects invalid simulation input", () =>
  Effect.gen(function* () {
    const failure = yield* Effect.flip(
      simulateWithoutSideEffect({
        tenantId: "018f3f77-0c5a-7cc0-8b62-6a163d214123",
        action: createPayment,
        input: { amount: 10 },
      }),
    )

    assert.strictEqual(failure._tag, "ExternalPayloadInvalid")
  }),
)
