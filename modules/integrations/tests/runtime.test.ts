import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as TestClock from "effect/testing/TestClock"

import {
  defineExternalAction,
  defineExternalEvent,
  ExternalProblemDetails,
  ExternalProviderFailure,
  ExternalUnknownOutcome,
  makeExternalConnectorRuntime,
  makeMemoryExternalConnectorStore,
} from "../mod.ts"

const tenantId = "018f3f77-0c5a-7cc0-8b62-6a163d214123"
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
  retryPolicy: { maxAttempts: 2 },
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

const envelope = (id: string, data: unknown) => ({
  specversion: "1.0",
  type: paymentSettled.id,
  source: paymentSettled.source,
  id,
  time: "2026-08-27T00:00:00.000Z",
  datacontenttype: "application/json",
  data,
})

it.effect("uses bounded retry and idempotent action receipts", () =>
  Effect.gen(function*() {
    let calls = 0
    const runtime = makeExternalConnectorRuntime({
      store: makeMemoryExternalConnectorStore(),
      authorizeScope: () => Effect.succeed(undefined),
      invoke: (input) => {
        calls += 1
        return calls === 1
          ? Effect.fail(
            new ExternalProviderFailure({
              tenantId: input.tenantId,
              actionId: input.action.id,
              operationId: input.action.operationId,
              reason: "timeout",
              retryable: true,
            }),
          )
          : Effect.succeed({ providerPaymentId: "pay-1" })
      },
    })

    const first = yield* runtime.invokeAction({
      tenantId,
      action: createPayment,
      idempotencyKey: "payment-1",
      input: { amount: "10.00" },
    })
    const replay = yield* runtime.invokeAction({
      tenantId,
      action: createPayment,
      idempotencyKey: "payment-1",
      input: { amount: "10.00" },
    })

    assert.deepStrictEqual(replay, first)
    assert.strictEqual(calls, 2)
  }))

it.effect("enforces the catalog timeout across bounded retries", () =>
  TestClock.withLive(Effect.gen(function*() {
    let calls = 0
    const timedAction = { ...createPayment, timeoutPolicy: { timeoutMs: 1 } }
    const runtime = makeExternalConnectorRuntime({
      authorizeScope: () => Effect.succeed(undefined),
      invoke: () => {
        calls += 1
        return Effect.never
      },
    })
    const failure = yield* Effect.flip(runtime.invokeAction({
      tenantId,
      action: timedAction,
      idempotencyKey: "payment-timeout",
      input: { amount: "10.00" },
    }))

    assert.instanceOf(failure, ExternalProviderFailure)
    assert.strictEqual(failure.reason, "timeout")
    assert.strictEqual(calls, 2)
  })))

it.effect("keeps an unknown outcome in manual recovery", () =>
  Effect.gen(function*() {
    let calls = 0
    const runtime = makeExternalConnectorRuntime({
      authorizeScope: () => Effect.succeed(undefined),
      invoke: (input) => {
        calls += 1
        return Effect.fail(
          new ExternalUnknownOutcome({
            tenantId: input.tenantId,
            actionId: input.action.id,
            idempotencyKey: input.idempotencyKey,
          }),
        )
      },
    })
    const input = {
      tenantId,
      action: createPayment,
      idempotencyKey: "payment-unknown",
      input: { amount: "10.00" },
    }

    const first = yield* Effect.flip(runtime.invokeAction(input))
    const replay = yield* Effect.flip(runtime.invokeAction(input))

    assert.instanceOf(first, ExternalUnknownOutcome)
    assert.instanceOf(replay, ExternalUnknownOutcome)
    assert.strictEqual(calls, 1)
  }))

it.effect("deduplicates WebhookIngestion by provider event identity", () =>
  Effect.gen(function*() {
    const runtime = makeExternalConnectorRuntime({
      authorizeScope: () => Effect.succeed(undefined),
      invoke: () => Effect.succeed(undefined),
    })
    const input = {
      tenantId,
      event: paymentSettled,
      envelope: envelope("evt-1", { providerPaymentId: "pay-1" }),
    }

    const first = yield* runtime.ingestEvent(input)
    const duplicate = yield* runtime.ingestEvent(input)
    const invalid = yield* Effect.flip(runtime.ingestEvent({
      ...input,
      envelope: envelope("evt-2", { providerPaymentId: 3 }),
    }))
    const wrongSource = yield* Effect.flip(runtime.ingestEvent({
      ...input,
      envelope: {
        ...envelope("evt-3", { providerPaymentId: "pay-3" }),
        source: "https://other.example",
      },
    }))

    assert.isFalse(first.duplicate)
    assert.isTrue(duplicate.duplicate)
    assert.strictEqual(duplicate.eventId, first.eventId)
    assert.strictEqual(invalid._tag, "ExternalPayloadInvalid")
    assert.strictEqual(wrongSource._tag, "ExternalPayloadInvalid")
  }))
