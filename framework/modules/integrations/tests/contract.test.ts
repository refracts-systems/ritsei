import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  defineExternalAction,
  defineExternalEvent,
  ExternalIntegrationProfile,
  ExternalProblemDetails,
  isAllowlistedExternalAction,
} from "../mod.ts"

const PaymentInput = Schema.Struct({ amount: Schema.String })
const PaymentOutput = Schema.Struct({ providerPaymentId: Schema.String })
const PaymentSettled = Schema.Struct({ providerPaymentId: Schema.String })

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
  id: "midtrans.payment.settled",
  version: 1,
  connectorId: "midtrans",
  source: "https://provider.example",
  stability: "PUBLIC",
  compatibilityRange: { minimumVersion: 1, maximumVersion: 1 },
  payloadSchema: PaymentSettled,
  envelope: "CloudEvents 1.0.x",
  transport: "HTTPS/Webhook",
  scope: ["tenant"],
  correlationFields: ["providerPaymentId"],
  filterableFields: ["providerPaymentId"],
  deduplicationKey: "source:id",
  occurredAtSemantics: "provider_time",
})

it("defines the golden external contract profile", () => {
  assert.strictEqual(ExternalIntegrationProfile.actionTransport, "HTTPS + JSON")
  assert.strictEqual(ExternalIntegrationProfile.openApiStandard, "OpenAPI")
  assert.strictEqual(ExternalIntegrationProfile.openApiVersion, "3.2.0")
  assert.strictEqual(
    ExternalIntegrationProfile.eventTransport,
    "CloudEvents 1.0.x over HTTPS/Webhook",
  )
  assert.strictEqual(ExternalIntegrationProfile.asyncApiVersion, "3.1.0")
  assert.strictEqual(ExternalIntegrationProfile.authentication, "OAuth 2.0")
  assert.strictEqual(ExternalIntegrationProfile.oauthSecurityBaseline, "RFC 9700")
  assert.strictEqual(ExternalIntegrationProfile.problemDetails, "RFC 9457")
  assert.strictEqual(createPayment.kind, "ExternalAction")
  assert.strictEqual(paymentSettled.kind, "ExternalEvent")
})

it("requires an allowlisted operation before publication", () => {
  assert.isTrue(isAllowlistedExternalAction(createPayment))
  assert.isFalse(isAllowlistedExternalAction({ ...createPayment, allowlisted: false }))
  assert.strictEqual(createPayment.requiredScope, "payments:create")
  assert.notStrictEqual(createPayment.requiredScope, createPayment.id)
})

it("keeps a separate envelope from external payloads", () => {
  assert.strictEqual(paymentSettled.envelope, "CloudEvents 1.0.x")
  assert.strictEqual(paymentSettled.transport, "HTTPS/Webhook")
  // SAFETY: the comparison only needs reference identity.
  assert.notStrictEqual(paymentSettled.payloadSchema as unknown, paymentSettled.envelope)
  assert.deepStrictEqual(paymentSettled.correlationFields, ["providerPaymentId"])
  assert.deepStrictEqual(paymentSettled.filterableFields, ["providerPaymentId"])
})

it.effect("validates external schemas at the contract boundary", () =>
  Effect.gen(function* () {
    yield* Schema.decodeUnknownEffect(createPayment.inputSchema)({ amount: "10.00" })
    yield* Schema.decodeUnknownEffect(createPayment.outputSchema)({ providerPaymentId: "pay-1" })
    yield* Schema.decodeUnknownEffect(paymentSettled.payloadSchema)({ providerPaymentId: "pay-1" })
    yield* Schema.decodeUnknownEffect(ExternalProblemDetails)({
      type: "https://provider.example/problem",
      title: "Provider rejected request",
      status: 422,
      detail: "The payment cannot be created",
    })

    const invalid = yield* Effect.flip(
      Schema.decodeUnknownEffect(ExternalProblemDetails)({
        type: "",
        title: "",
        status: 200,
        detail: "",
      }),
    )

    assert.strictEqual(invalid._tag, "SchemaError")
  }),
)
