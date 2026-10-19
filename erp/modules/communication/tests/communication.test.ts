import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import {
  EventEnvelopeShape,
  makeMessagingTestLayer,
  MessagingService,
} from "../../../../framework/modules/messaging/mod.ts"
import { ProcurementPurchaseOrderConfirmedEvent } from "../../procurement/mod.ts"
import {
  CommunicationService,
  CommunicationStateFailure,
  CommunicationTestTransport,
  makeCommunicationTestLayer,
  UnsupportedCommunicationEvent,
} from "../mod.ts"

const tenantId = "01990000-0000-7000-8000-000000000001"
const purchaseOrderId = "01990000-0000-7000-8000-000000000002"
const supplierAccountId = "01990000-0000-7000-8000-000000000003"
const eventId = "01990000-0000-7000-8000-000000000004"
const timestamp = "2026-09-06T00:00:00.000Z"

const event: EventEnvelopeShape = {
  eventId,
  eventType: ProcurementPurchaseOrderConfirmedEvent.id,
  eventVersion: ProcurementPurchaseOrderConfirmedEvent.version,
  tenantId,
  aggregateType: ProcurementPurchaseOrderConfirmedEvent.aggregateType,
  aggregateId: purchaseOrderId,
  commandId: "procurement.purchase_order.confirm:confirm-1",
  correlationId: `procurement.purchase_order:${purchaseOrderId}`,
  causationId: null,
  idempotencyKey: "confirm-1",
  actorPrincipalId: "principal-1",
  occurredAt: timestamp,
  payload: {
    purchaseOrderId,
    supplierAccountId,
    total: "125.50",
  },
  publishedAt: null,
  attempts: 0,
}

const withCommunication = <A, E>(
  program: Effect.Effect<
    A,
    E,
    CommunicationService | CommunicationTestTransport | MessagingService
  >,
) => {
  const messaging = makeMessagingTestLayer()
  const communication = makeCommunicationTestLayer({
    deliveryStatuses: ["unknown", "accepted"],
  }).pipe(Layer.provide(messaging))
  return Effect.provide(program, Layer.merge(messaging, communication))
}

it.effect("derives one intent, renders once, and retries the same artifact", () =>
  withCommunication(
    Effect.gen(function* () {
      const messaging = yield* MessagingService
      yield* messaging.append(event)
      const service = yield* CommunicationService
      const first = yield* service.processPurchaseOrderConfirmed({ event })
      const duplicate = yield* service.processPurchaseOrderConfirmed({ event })

      assert.strictEqual(first.duplicate, false)
      assert.strictEqual(first.communication.status, "queued")
      assert.strictEqual(first.attempt, null)
      assert.strictEqual(duplicate.duplicate, true)
      assert.strictEqual(duplicate.intent.communicationId, first.intent.communicationId)
      assert.strictEqual(duplicate.artifact.artifactId, first.artifact.artifactId)

      const firstDelivery = yield* service.deliver({
        communicationId: first.intent.communicationId,
      })
      assert.strictEqual(firstDelivery.communication.status, "reconciling")
      assert.strictEqual(firstDelivery.attempt?.status, "unknown")
      assert.strictEqual(firstDelivery.receipt?.status, "unknown")

      const retry = yield* service.retry({ communicationId: first.intent.communicationId })
      assert.strictEqual(retry.communication.status, "accepted")
      assert.strictEqual(retry.attempt?.attemptNumber, 2)
      assert.strictEqual(retry.receipt?.status, "accepted")
      assert.strictEqual(retry.artifact.artifactId, first.artifact.artifactId)

      const transport = yield* CommunicationTestTransport
      assert.strictEqual(transport.sent.length, 2)
      assert.strictEqual(transport.sent[0]?.artifactId, transport.sent[1]?.artifactId)
      assert.strictEqual(transport.sent[0]?.html, transport.sent[1]?.html)
    }),
  ),
)

it.effect("rejects unsupported source events before creating a communication", () =>
  withCommunication(
    Effect.gen(function* () {
      const messaging = yield* MessagingService
      const unsupportedEvent = { ...event, eventType: "billing.invoice.issued" }
      yield* messaging.append(unsupportedEvent)
      const service = yield* CommunicationService
      const failure = yield* Effect.flip(
        service.processPurchaseOrderConfirmed({ event: unsupportedEvent }),
      )

      assert.strictEqual(
        failure._tag,
        new UnsupportedCommunicationEvent({
          eventType: "billing.invoice.issued",
          eventVersion: 1,
        })._tag,
      )
    }),
  ),
)

it.effect("does not retry a communication before its first delivery attempt", () =>
  withCommunication(
    Effect.gen(function* () {
      const messaging = yield* MessagingService
      yield* messaging.append(event)
      const service = yield* CommunicationService
      const processed = yield* service.processPurchaseOrderConfirmed({ event })
      const failure = yield* Effect.flip(
        service.retry({ communicationId: processed.intent.communicationId }),
      )

      assert.strictEqual(
        failure._tag,
        new CommunicationStateFailure({
          reason: "communication has no attempt to retry",
        })._tag,
      )
    }),
  ),
)
