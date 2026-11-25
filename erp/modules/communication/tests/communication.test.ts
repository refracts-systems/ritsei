import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import {
  EventEnvelopeContract,
  makeMessagingTestLayer,
  MessagingService,
} from "../../../../framework/modules/messaging/mod.ts"
import { uuidv7 } from "../../../../framework/foundation/mod.ts"
import { ProcurementPurchaseOrderConfirmedEvent } from "../../procurement/mod.ts"
import {
  AuthorizationDenied,
  makeAuthorizationTestLayer,
} from "../../../../framework/modules/authorization/mod.ts"
import {
  CommunicationCapabilities,
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

const event: EventEnvelopeContract = {
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

const otherTenantId = "01990000-0000-7000-8000-000000000009"
const principal = { userAccountId: "importer", sessionId: "importer-session" }
const scope = { principal, tenantId }

const withCommunication = <A, E>(
  program: Effect.Effect<
    A,
    E,
    CommunicationService | CommunicationTestTransport | MessagingService
  >,
) => {
  const messaging = makeMessagingTestLayer()

  const authorization = makeAuthorizationTestLayer(
    [tenantId, otherTenantId].flatMap((granted) =>
      Object.values(CommunicationCapabilities).map((capability) => ({
        userAccountId: principal.userAccountId,
        tenantId: granted,
        capability,
      })),
    ),
  )

  const communication = makeCommunicationTestLayer({
    deliveryStatuses: ["unknown", "accepted"],
  }).pipe(Layer.provide(Layer.merge(messaging, authorization)))

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
        ...scope,
        communicationId: first.intent.communicationId,
        previewedArtifactId: first.artifact.artifactId,
      })

      assert.strictEqual(firstDelivery.communication.status, "reconciling")
      assert.strictEqual(firstDelivery.attempt?.status, "unknown")
      assert.strictEqual(firstDelivery.receipt?.status, "unknown")

      const retry = yield* service.retry({
        ...scope,
        communicationId: first.intent.communicationId,
      })

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
        service.retry({ ...scope, communicationId: processed.intent.communicationId }),
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

const invoiceId = "01990000-0000-7000-8000-000000000005"
const documentArtifactId = "01990000-0000-7000-8000-000000000006"

const historicalDispatch = {
  principal,
  tenantId,
  sourceSystem: "legacy-erp",
  sourceReference: "mail-log-1",
  subject: { owner: "billing", type: "customer_invoice", id: invoiceId },
  document: {
    documentArtifactId,
    contentHash: "a".repeat(64),
    filename: "INV-0001.pdf",
    mediaType: "application/pdf",
  },
  recipients: [{ address: "customer@example.com" }],
  outcome: "sent",
  providerId: "legacy-smtp",
  providerMessageId: "legacy-message-1",
  failureCode: null,
  observedAt: "2025-03-01T08:00:00.000Z",
} as const

it.effect("records each historical dispatch outcome without sending", () =>
  withCommunication(
    Effect.gen(function* () {
      const service = yield* CommunicationService
      const transport = yield* CommunicationTestTransport

      const sent = yield* service.recordHistoricalDispatch(historicalDispatch)

      assert.strictEqual(sent.duplicate, false)
      assert.strictEqual(sent.communication.status, "accepted")
      assert.strictEqual(sent.communication.artifactId, null)
      assert.strictEqual(sent.attempt.status, "accepted")
      assert.strictEqual(sent.attempt.failureCode, null)
      assert.strictEqual(sent.attempt.providerMessageId, "legacy-message-1")
      assert.strictEqual(sent.attempt.startedAt, historicalDispatch.observedAt)
      assert.strictEqual(sent.document.documentArtifactId, documentArtifactId)

      assert.strictEqual(
        sent.communication.recipientSnapshot?.to[0]?.address,
        "customer@example.com",
      )

      const failed = yield* service.recordHistoricalDispatch({
        ...historicalDispatch,
        sourceReference: "mail-log-2",
        outcome: "failed",
        providerMessageId: null,
        failureCode: "mailbox-full",
        recipients: [],
      })

      assert.strictEqual(failed.communication.status, "failed")
      assert.strictEqual(failed.communication.recipientSnapshot, null)
      assert.strictEqual(failed.attempt.status, "failed")
      assert.strictEqual(failed.attempt.failureCode, "mailbox-full")

      const unknown = yield* service.recordHistoricalDispatch({
        ...historicalDispatch,
        sourceReference: "mail-log-3",
        outcome: "unknown",
        providerMessageId: null,
      })

      assert.strictEqual(unknown.communication.status, "reconciling")
      assert.strictEqual(unknown.attempt.status, "unknown")
      assert.strictEqual(unknown.attempt.failureCode, "historical-delivery-unknown")

      assert.strictEqual(transport.sent.length, 0)
    }),
  ),
)

it.effect("replays a historical dispatch and rejects conflicting evidence", () =>
  withCommunication(
    Effect.gen(function* () {
      const service = yield* CommunicationService
      const first = yield* service.recordHistoricalDispatch(historicalDispatch)
      const replay = yield* service.recordHistoricalDispatch(historicalDispatch)

      assert.strictEqual(replay.duplicate, true)
      assert.strictEqual(replay.communication.communicationId, first.communication.communicationId)
      assert.strictEqual(replay.attempt.attemptId, first.attempt.attemptId)

      const otherTenant = yield* service.recordHistoricalDispatch({
        ...historicalDispatch,
        tenantId: otherTenantId,
      })

      assert.strictEqual(otherTenant.duplicate, false)

      const conflict = yield* Effect.flip(
        service.recordHistoricalDispatch({ ...historicalDispatch, outcome: "failed" }),
      )

      assert.strictEqual(conflict._tag, "CommunicationStateFailure")
    }),
  ),
)

it.effect("never delivers or retries a historical dispatch", () =>
  withCommunication(
    Effect.gen(function* () {
      const service = yield* CommunicationService
      const transport = yield* CommunicationTestTransport

      const recorded = yield* service.recordHistoricalDispatch({
        ...historicalDispatch,
        outcome: "unknown",
        providerMessageId: null,
      })

      const { communicationId } = recorded.communication

      const deliver = yield* Effect.flip(
        service.deliver({ ...scope, communicationId, previewedArtifactId: uuidv7() }),
      )

      const retry = yield* Effect.flip(service.retry({ ...scope, communicationId }))

      assert.strictEqual(deliver._tag, "CommunicationStateFailure")
      assert.strictEqual(retry._tag, "CommunicationStateFailure")
      assert.strictEqual(transport.sent.length, 0)
    }),
  ),
)

it.effect("rejects a historical dispatch with an invalid hash or a sent failure code", () =>
  withCommunication(
    Effect.gen(function* () {
      const service = yield* CommunicationService

      const failure = yield* Effect.flip(
        service.recordHistoricalDispatch({
          ...historicalDispatch,
          document: { ...historicalDispatch.document, contentHash: "abc" },
        }),
      )

      assert.strictEqual(failure._tag, "SchemaError")

      const sentWithFailure = yield* Effect.flip(
        service.recordHistoricalDispatch({ ...historicalDispatch, failureCode: "mailbox-full" }),
      )

      assert.strictEqual(sentWithFailure._tag, "SchemaError")
    }),
  ),
)

it.effect("denies recording a historical dispatch without the capability", () =>
  Effect.gen(function* () {
    const service = yield* CommunicationService
    const denied = yield* Effect.flip(service.recordHistoricalDispatch(historicalDispatch))

    assert.instanceOf(denied, AuthorizationDenied)
  }).pipe(
    Effect.provide(
      makeCommunicationTestLayer().pipe(
        Layer.provide(Layer.merge(makeMessagingTestLayer(), makeAuthorizationTestLayer())),
      ),
    ),
  ),
)

const otherPrincipal = { userAccountId: "reader", sessionId: "reader-session" }

it.effect(
  "previews what would be sent without sending, and sends only the previewed rendering",
  () =>
    withCommunication(
      Effect.gen(function* () {
        const messaging = yield* MessagingService
        yield* messaging.append(event)
        const service = yield* CommunicationService
        const transport = yield* CommunicationTestTransport
        const processed = yield* service.processPurchaseOrderConfirmed({ event })
        const { communicationId } = processed.intent

        // Previewing is repeatable and calls no transport.
        const first = yield* service.preview({ ...scope, communicationId })
        const again = yield* service.preview({ ...scope, communicationId })

        assert.deepStrictEqual(again, first)
        assert.strictEqual(first.artifactId, processed.artifact.artifactId)
        assert.strictEqual(first.status, "queued")
        assert.strictEqual(first.attempts, 0)
        assert.strictEqual(first.subject, processed.artifact.subject)
        assert.isAbove(first.to.length, 0)
        assert.strictEqual(transport.sent.length, 0)
        assert.deepStrictEqual(yield* service.listAttempts({ ...scope, communicationId }), [])

        // A send that names another rendering is refused and sends nothing.
        const stale = yield* Effect.flip(
          service.deliver({ ...scope, communicationId, previewedArtifactId: uuidv7() }),
        )

        assert.strictEqual(stale._tag, "CommunicationPreviewStale")
        assert.strictEqual(transport.sent.length, 0)

        // Sending the previewed rendering delivers exactly what the preview showed.
        yield* service.deliver({ ...scope, communicationId, previewedArtifactId: first.artifactId })
        assert.strictEqual(transport.sent.length, 1)
        assert.strictEqual(transport.sent[0]?.html, first.html)
        assert.strictEqual(transport.sent[0]?.subject, first.subject)

        // It is sent once: a second first-send is refused.
        const twice = yield* Effect.flip(
          service.deliver({ ...scope, communicationId, previewedArtifactId: first.artifactId }),
        )

        assert.strictEqual(twice._tag, "CommunicationStateFailure")
        assert.strictEqual(transport.sent.length, 1)
      }),
    ),
)

it.effect("keeps an append-only log of delivery attempts that a reader cannot rewrite", () =>
  withCommunication(
    Effect.gen(function* () {
      const messaging = yield* MessagingService
      yield* messaging.append(event)
      const service = yield* CommunicationService
      const processed = yield* service.processPurchaseOrderConfirmed({ event })
      const { communicationId } = processed.intent
      const previewedArtifactId = processed.artifact.artifactId

      yield* service.deliver({ ...scope, communicationId, previewedArtifactId })
      const afterFirst = yield* service.listAttempts({ ...scope, communicationId })
      yield* service.retry({ ...scope, communicationId })
      const afterRetry = yield* service.listAttempts({ ...scope, communicationId })

      // Attempts accumulate in order, and an earlier read is not changed by a later send.
      assert.deepStrictEqual(
        afterRetry.map((attempt) => attempt.attemptNumber),
        [1, 2],
      )

      assert.strictEqual(afterFirst.length, 1)
      assert.deepStrictEqual(afterRetry[0], afterFirst[0])

      // The copies handed out are frozen, so a reader cannot rewrite the record.
      assert.isTrue(Object.isFrozen(afterRetry[0]))
      const preview = yield* service.preview({ ...scope, communicationId })
      assert.strictEqual(preview.attempts, 2)
      assert.strictEqual(preview.status, "accepted")
    }),
  ),
)

it.effect("denies previewing, reading attempts, and sending without their capabilities", () =>
  Effect.gen(function* () {
    const messaging = yield* MessagingService
    yield* messaging.append(event)
    const service = yield* CommunicationService
    const processed = yield* service.processPurchaseOrderConfirmed({ event })
    const { communicationId } = processed.intent
    const transport = yield* CommunicationTestTransport
    const reader = { principal: otherPrincipal, tenantId, communicationId }

    // Reading is granted to this caller, sending is not.
    assert.strictEqual((yield* service.preview(reader)).communicationId, communicationId)

    const denied = yield* Effect.flip(
      service.deliver({ ...reader, previewedArtifactId: processed.artifact.artifactId }),
    )

    assert.instanceOf(denied, AuthorizationDenied)
    assert.instanceOf(yield* Effect.flip(service.retry(reader)), AuthorizationDenied)

    const stranger = {
      principal: { userAccountId: "stranger", sessionId: "stranger-session" },
      tenantId,
      communicationId,
    }

    assert.instanceOf(yield* Effect.flip(service.preview(stranger)), AuthorizationDenied)
    assert.instanceOf(yield* Effect.flip(service.listAttempts(stranger)), AuthorizationDenied)
    assert.strictEqual(transport.sent.length, 0)
  }).pipe(
    Effect.provide(
      (() => {
        const messaging = makeMessagingTestLayer()

        const authorization = makeAuthorizationTestLayer([
          {
            userAccountId: otherPrincipal.userAccountId,
            tenantId,
            capability: CommunicationCapabilities.communicationRead,
          },
        ])

        const communication = makeCommunicationTestLayer().pipe(
          Layer.provide(Layer.merge(messaging, authorization)),
        )

        return Layer.merge(messaging, communication)
      })(),
    ),
  ),
)

it.effect("does not show or send another tenant's communication", () =>
  withCommunication(
    Effect.gen(function* () {
      const messaging = yield* MessagingService
      yield* messaging.append(event)
      const service = yield* CommunicationService
      const processed = yield* service.processPurchaseOrderConfirmed({ event })
      const { communicationId } = processed.intent
      const transport = yield* CommunicationTestTransport
      const foreign = { principal, tenantId: otherTenantId, communicationId }

      const refused = [
        (yield* Effect.flip(service.preview(foreign)))._tag,
        (yield* Effect.flip(service.listAttempts(foreign)))._tag,
        (yield* Effect.flip(
          service.deliver({ ...foreign, previewedArtifactId: processed.artifact.artifactId }),
        ))._tag,
        (yield* Effect.flip(service.retry(foreign)))._tag,
      ]

      assert.deepStrictEqual(refused, Array(4).fill("CommunicationNotFound"))

      assert.strictEqual(transport.sent.length, 0)
    }),
  ),
)
