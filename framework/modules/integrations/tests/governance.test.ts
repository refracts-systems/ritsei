import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  activateExternalConnector,
  defineExternalAction,
  ExternalConnectorNotReviewed,
  ExternalConnectorRetired,
  ExternalConnectorVersionConflict,
  ExternalProblemDetails,
  makeDeliveryControl,
  retireExternalConnector,
  reviewExternalConnector,
  validateExternalOperation,
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

const draftConnector = {
  connectorId: "midtrans",
  version: 1,
  status: "draft" as const,
  owner: "modules/integrations",
  compatibilityRange: { minimumVersion: 1, maximumVersion: 1 },
  actions: [createPayment],
  events: [],
}

it.effect("rejects an unreviewed operation and retired connector", () =>
  Effect.gen(function* () {
    const unreviewed = yield* Effect.flip(validateExternalOperation(draftConnector, createPayment))
    assert.instanceOf(unreviewed, ExternalConnectorNotReviewed)

    const reviewed = yield* reviewExternalConnector(
      draftConnector,
      "reviewer-1",
      "2026-08-27T00:00:00.000Z",
    )

    const active = yield* activateExternalConnector(reviewed)
    const retired = retireExternalConnector(active)
    const retiredFailure = yield* Effect.flip(validateExternalOperation(retired, createPayment))

    assert.strictEqual(active.status, "active")
    assert.instanceOf(retiredFailure, ExternalConnectorRetired)
  }),
)

it.effect("preserves connector version compatibility and delivery controls", () =>
  Effect.gen(function* () {
    const reviewed = yield* reviewExternalConnector(
      draftConnector,
      "reviewer-1",
      "2026-08-27T00:00:00.000Z",
    )

    const active = yield* activateExternalConnector(reviewed)
    const valid = yield* validateExternalOperation(active, createPayment)

    const control = yield* makeDeliveryControl({
      kind: "retry",
      operationId: valid.operationId,
      reason: "provider recovered",
    })

    const versionConflict = yield* Effect.flip(
      validateExternalOperation(active, {
        ...createPayment,
        version: 2,
      }),
    )

    assert.strictEqual(valid.id, createPayment.id)
    assert.strictEqual(control.kind, "retry")
    assert.instanceOf(versionConflict, ExternalConnectorVersionConflict)
  }),
)
