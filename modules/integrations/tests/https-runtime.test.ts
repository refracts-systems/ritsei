import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  defineExternalAction,
  defineExternalEvent,
  ExternalProviderFailure,
  ExternalUnknownOutcome,
  HttpsWebhookLimits,
  makeHttpsConnectorRuntime,
  makeMemoryExternalConnectorStore,
  makeMemoryExternalDeliveryStore,
} from "../mod.ts"

const tenantId = "018f3f77-0c5a-7cc0-8b62-6a163d214123"
const action = defineExternalAction({
  kind: "ExternalAction",
  id: "payments.create",
  version: 1,
  connectorId: "payments",
  operationId: "createPayment",
  stability: "PUBLIC",
  compatibilityRange: { minimumVersion: 1, maximumVersion: 1 },
  inputSchema: Schema.Struct({ amount: Schema.Number }),
  outputSchema: Schema.Struct({ accepted: Schema.Boolean }),
  errorSchemas: [],
  requiredScope: "payments:create",
  idempotencyStrategy: "required",
  timeoutPolicy: { timeoutMs: 1000 },
  retryPolicy: { maxAttempts: 2 },
  compensation: { kind: "none", recovery: "manual" },
  allowlisted: true,
})
const event = defineExternalEvent({
  kind: "ExternalEvent",
  id: "payments.settled",
  version: 1,
  connectorId: "payments",
  source: "https://payments.example",
  stability: "PUBLIC",
  compatibilityRange: { minimumVersion: 1, maximumVersion: 1 },
  payloadSchema: Schema.Struct({ paymentId: Schema.String }),
  envelope: "CloudEvents 1.0.x",
  transport: "HTTPS/Webhook",
  scope: ["tenant"],
  correlationFields: ["paymentId"],
  filterableFields: ["paymentId"],
  deduplicationKey: "source:id",
  occurredAtSemantics: "provider_time",
})

it.effect("proves duplicate delivery, timeout, and unknown outcome handling over HTTPS", () =>
  Effect.gen(function* () {
    let attempts = 0
    const deliveryStore = makeMemoryExternalDeliveryStore()
    const runtime = makeHttpsConnectorRuntime({
      store: makeMemoryExternalConnectorStore(),
      deliveryStore,
      authorizeScope: () => Effect.succeed(undefined),
      verifySignature: () => Effect.succeed(true),
      invoke: (input) => {
        attempts += 1
        return attempts === 1
          ? Effect.fail(
              new ExternalProviderFailure({
                tenantId: input.tenantId,
                actionId: input.action.id,
                operationId: input.action.operationId,
                reason: "timeout",
                retryable: true,
              }),
            )
          : Effect.succeed({ accepted: true })
      },
    })
    const output = yield* runtime.invokeAction({
      tenantId,
      action,
      idempotencyKey: "payment-1",
      input: { amount: 10 },
    })
    const envelope = {
      specversion: "1.0" as const,
      type: event.id,
      source: event.source,
      id: "provider-event-1",
      time: "2026-08-30T00:00:00.000Z",
      datacontenttype: "application/json" as const,
      data: { paymentId: "pay-1" },
    }
    const webhook = {
      tenantId,
      event,
      body: JSON.stringify(envelope),
      signature: "signature-1",
      correlationId: "payment-correlation-1",
      envelope,
    }
    const firstDelivery = yield* runtime.ingestWebhook(webhook)
    const duplicateDelivery = yield* runtime.ingestWebhook(webhook)
    const deliveryLog = yield* deliveryStore.get(tenantId, event.source, "provider-event-1")

    assert.deepStrictEqual(output, { accepted: true })
    assert.strictEqual(attempts, 2)
    assert.strictEqual(firstDelivery.duplicate, false)
    assert.strictEqual(duplicateDelivery.duplicate, true)
    assert.strictEqual(deliveryLog?.status, "duplicate")

    const mismatchedEnvelope = yield* Effect.flip(
      runtime.ingestWebhook({
        ...webhook,
        envelope: { ...envelope, id: "provider-event-2" },
      }),
    )
    assert.strictEqual(mismatchedEnvelope._tag, "ExternalPayloadInvalid")
  }),
)

it.effect("rejects oversized webhook resources before signature verification", () =>
  Effect.gen(function* () {
    let verified = false
    const runtime = makeHttpsConnectorRuntime({
      authorizeScope: () => Effect.succeed(undefined),
      verifySignature: () => {
        verified = true
        return Effect.succeed(true)
      },
      invoke: () => Effect.succeed(undefined),
    })
    const base = {
      tenantId,
      event,
      body: "x".repeat(HttpsWebhookLimits.maxBodyBytes + 1),
      signature: "signature-1",
      correlationId: "payment-correlation-1",
      envelope: {
        specversion: "1.0" as const,
        type: event.id,
        source: event.source,
        id: "provider-event-oversized",
        time: "2026-08-30T00:00:00.000Z",
        datacontenttype: "application/json" as const,
        data: { paymentId: "pay-1" },
      },
    }
    const failure = yield* Effect.flip(runtime.ingestWebhook(base))
    assert.strictEqual(failure._tag, "ExternalPayloadInvalid")
    assert.isFalse(verified)

    const signatureFailure = yield* Effect.flip(
      runtime.ingestWebhook({
        ...base,
        body: "signed-cloud-event-body",
        signature: "x".repeat(HttpsWebhookLimits.maxSignatureLength + 1),
      }),
    )
    assert.strictEqual(signatureFailure._tag, "ExternalPayloadInvalid")
  }),
)

it.effect("persists an unknown outcome and refuses an automatic replay", () =>
  Effect.gen(function* () {
    const runtime = makeHttpsConnectorRuntime({
      authorizeScope: () => Effect.succeed(undefined),
      verifySignature: () => Effect.succeed(true),
      invoke: (input) =>
        Effect.fail(
          new ExternalUnknownOutcome({
            tenantId: input.tenantId,
            actionId: input.action.id,
            idempotencyKey: input.idempotencyKey,
          }),
        ),
    })
    const input = { tenantId, action, idempotencyKey: "payment-unknown", input: { amount: 12 } }
    const first = yield* Effect.flip(runtime.invokeAction(input))
    const second = yield* Effect.flip(runtime.invokeAction(input))
    assert.instanceOf(first, ExternalUnknownOutcome)
    assert.instanceOf(second, ExternalUnknownOutcome)
  }),
)
