import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  defineExternalAction,
  defineExternalEvent,
  ExternalProblemDetails,
  makeExternalProcessActionMapping,
  simulateProcessExternalAction,
  toProcessExternalCatalogEntry,
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

const paymentSettled = defineExternalEvent({
  kind: "ExternalEvent",
  id: "com.midtrans.payment.settled",
  version: 1,
  connectorId: "midtrans",
  source: "https://partner.example",
  stability: "PUBLIC",
  compatibilityRange: { minimumVersion: 1, maximumVersion: 1 },
  payloadSchema: Schema.Struct({ paymentId: Schema.String }),
  envelope: "CloudEvents 1.0.x",
  transport: "HTTPS/Webhook",
  scope: ["payments:read"],
  correlationFields: ["paymentId"],
  filterableFields: ["paymentId"],
  deduplicationKey: "id",
  occurredAtSemantics: "provider_time",
})

it("projects only public catalog entries and omits transport metadata", () => {
  const action = toProcessExternalCatalogEntry(createPayment)
  const event = toProcessExternalCatalogEntry(paymentSettled)
  assert.isDefined(action)
  assert.isDefined(event)
  assert.isFalse("transport" in event!)
  assert.isTrue(action !== undefined && action.kind === "ExternalAction")
  if (action !== undefined && action.kind === "ExternalAction") {
    assert.strictEqual(action.requiredScope, "payments:create")
  }
})

it.effect("keeps a separate OAuth scope, typed mapping, and no provider side effect", () =>
  Effect.gen(function*() {
    const mapping = makeExternalProcessActionMapping(createPayment, { amount: "10.00" })
    const result = yield* simulateProcessExternalAction({
      tenantId: "018f3f77-0c5a-7cc0-8b62-6a163d214123",
      action: createPayment,
      input: mapping.input,
    })

    assert.strictEqual(mapping.actionId, createPayment.id)
    assert.strictEqual(mapping.actionVersion, 1)
    assert.strictEqual(result.catalog.requiredScope, "payments:create")
    assert.strictEqual(result.simulated, true)
    assert.strictEqual(result.sideEffect, false)
  }))

it("does not expose private or unallowlisted capabilities to Process Studio", () => {
  assert.isUndefined(toProcessExternalCatalogEntry({ ...createPayment, stability: "PRIVATE" }))
  assert.isUndefined(toProcessExternalCatalogEntry({ ...createPayment, allowlisted: false }))
})
