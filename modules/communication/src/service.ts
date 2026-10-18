import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  Communication,
  CommunicationArtifact,
  CommunicationContextBuilder,
  communicationIdempotencyKey,
  CommunicationIntent,
  CommunicationRecipientResolver,
  DeliveryAttempt,
  DeliveryReceipt,
  EmailMessage,
  EmailRenderer,
  EmailRenderInput,
  EmailTransport,
  PreparedEmail,
  RecipientSnapshot,
  SenderIdentity,
} from "../../../foundation/mod.ts"
import { EventEnvelope, MessagingService as MessagingServiceTag } from "../../messaging/mod.ts"
import { PurchaseOrderConfirmedEventPayload } from "../../procurement/mod.ts"
import {
  CommunicationConfiguration,
  CommunicationPolicy,
  CommunicationProcessingResult,
  CommunicationService,
  ProcessPurchaseOrderConfirmedInput,
  RetryCommunicationInput,
} from "./contract.ts"
import { CommunicationNotFound, CommunicationStateFailure } from "./errors.ts"

type PurchaseOrderConfirmedPayload = Schema.Schema.Type<typeof PurchaseOrderConfirmedEventPayload>

const purchaseOrderConsumerId = "communication.purchase-order-confirmed.v1"
const purchaseOrderContextType = "purchase-order-confirmed-context"
const purchaseOrderTemplate = {
  templateId: "purchase-order-confirmed-default",
  templateVersion: 1,
  contextType: purchaseOrderContextType,
  contextVersion: 1,
  locale: "en-US",
} as const

interface StoredCommunication {
  readonly intent: CommunicationIntent
  readonly artifact: CommunicationArtifact
  readonly preparedEmail: PreparedEmail
  communication: Communication
  result: CommunicationProcessingResult
  readonly attempts: DeliveryAttempt[]
}

const eventKey = (event: Pick<EventEnvelope, "tenantId" | "eventId">) =>
  `${event.tenantId}:${event.eventId}`

const makeEmailMessage = (
  event: EventEnvelope,
  payload: PurchaseOrderConfirmedPayload,
): EmailMessage => ({
  subject: `Purchase order ${event.aggregateId} confirmed`,
  preheader: "Your purchase order has been confirmed.",
  nodes: [
    { _tag: "heading", level: 1, text: "Purchase order confirmed" },
    {
      _tag: "text",
      text: `Purchase order ${event.aggregateId} was confirmed for ${payload.total}.`,
    },
    {
      _tag: "key_value",
      entries: [
        { label: "Purchase order", value: event.aggregateId },
        { label: "Supplier", value: payload.supplierAccountId },
        { label: "Total", value: payload.total },
      ],
    },
  ],
  attachments: [],
})

const communicationStatusFor = (status: DeliveryReceipt["status"]): Communication["status"] =>
  status === "unknown" ? "reconciling" : "accepted"

const makeAttempt = (
  communication: Communication,
  receipt: DeliveryReceipt,
  attemptNumber: number,
): DeliveryAttempt => ({
  attemptId: receipt.attemptId,
  communicationId: communication.communicationId,
  tenantId: communication.tenantId,
  attemptNumber,
  providerId: receipt.providerId,
  status: receipt.status,
  providerMessageId: receipt.providerMessageId,
  providerEvidenceId: null,
  failureCode: receipt.status === "unknown" ? "provider-unknown" : null,
  startedAt: receipt.observedAt,
  completedAt: receipt.observedAt,
})

const makePreparedEmail = (
  sender: SenderIdentity,
  artifact: CommunicationArtifact,
  recipients: RecipientSnapshot,
): PreparedEmail => ({
  artifactId: artifact.artifactId,
  communicationId: artifact.communicationId,
  sender,
  to: recipients.to,
  cc: recipients.cc,
  bcc: recipients.bcc,
  subject: artifact.subject,
  html: artifact.html,
  text: artifact.text,
  attachments: artifact.attachments,
  headers: [{ name: "X-RITSEI-Communication-ID", value: artifact.communicationId }],
})

export const makeCommunicationService = Effect.gen(function* () {
  const messaging = yield* MessagingServiceTag
  const configuration = yield* CommunicationConfiguration
  const policy = yield* CommunicationPolicy
  const recipientResolver = yield* CommunicationRecipientResolver
  const contextBuilder = yield* CommunicationContextBuilder
  const renderer = yield* EmailRenderer
  const transport = yield* EmailTransport

  const byEvent = new Map<string, string>()
  const byIdempotency = new Map<string, string>()
  const byCommunicationId = new Map<string, StoredCommunication>()

  const processEvent = (event: EventEnvelope) =>
    Effect.gen(function* () {
      const intent = yield* policy.derivePurchaseOrderConfirmed(event)
      const payload = yield* Schema.decodeUnknownEffect(PurchaseOrderConfirmedEventPayload)(
        event.payload,
      )
      const intentKey = communicationIdempotencyKey(intent)
      const existingId = byIdempotency.get(intentKey)
      if (existingId !== undefined) {
        const existing = byCommunicationId.get(existingId)
        if (existing === undefined) {
          return yield* Effect.fail(
            new CommunicationStateFailure({ reason: "idempotency record has no communication" }),
          )
        }
        return { ...existing.result, duplicate: true }
      }

      const recipients = yield* recipientResolver.resolve(intent)
      const context = yield* contextBuilder.build({ intent, data: payload })
      const message = makeEmailMessage(event, payload)
      const artifact = yield* renderer.render({
        intent,
        context,
        template: purchaseOrderTemplate,
        message,
      } satisfies EmailRenderInput)
      const communication: Communication = {
        communicationId: intent.communicationId,
        tenantId: intent.tenantId,
        intentType: intent.intentType,
        subject: intent.subject,
        audience: intent.audience,
        channels: intent.channels,
        status: "queued",
        recipientSnapshot: recipients,
        template: purchaseOrderTemplate,
        artifactId: artifact.artifactId,
        createdAt: intent.requestedAt,
      }
      const preparedEmail = makePreparedEmail(configuration.sender, artifact, recipients)
      const result: CommunicationProcessingResult = {
        duplicate: false,
        intent,
        communication,
        artifact,
        attempt: null,
        receipt: null,
      }
      const stored: StoredCommunication = {
        intent,
        artifact,
        preparedEmail,
        communication,
        result,
        attempts: [],
      }
      byEvent.set(eventKey(event), intent.communicationId)
      byIdempotency.set(intentKey, intent.communicationId)
      byCommunicationId.set(intent.communicationId, stored)
      return result
    })

  const processPurchaseOrderConfirmed = Effect.fn(
    "CommunicationService.processPurchaseOrderConfirmed",
  )(function* (input: unknown) {
    const decoded = yield* Schema.decodeUnknownEffect(ProcessPurchaseOrderConfirmedInput)(input)
    const event = decoded.event
    const consumed = yield* messaging.consumeOnce(
      {
        tenantId: event.tenantId,
        consumerId: purchaseOrderConsumerId,
        eventId: event.eventId,
      },
      processEvent(event),
    )
    if (!consumed.duplicate) return consumed.value

    const communicationId = byEvent.get(eventKey(event))
    const stored =
      communicationId === undefined ? undefined : byCommunicationId.get(communicationId)
    if (stored === undefined) {
      return yield* Effect.fail(
        new CommunicationStateFailure({ reason: "consumer receipt has no communication" }),
      )
    }
    return { ...stored.result, duplicate: true }
  })

  const send = (communicationId: string, retry: boolean) =>
    Effect.gen(function* () {
      const stored = byCommunicationId.get(communicationId)
      if (stored === undefined) {
        return yield* Effect.fail(new CommunicationNotFound({ communicationId }))
      }
      if (!retry && stored.attempts.length !== 0) {
        return yield* Effect.fail(
          new CommunicationStateFailure({ reason: "communication already has a delivery attempt" }),
        )
      }
      if (retry && stored.attempts.length === 0) {
        return yield* Effect.fail(
          new CommunicationStateFailure({ reason: "communication has no attempt to retry" }),
        )
      }

      const receipt = yield* transport.send(stored.preparedEmail)
      const attempt = makeAttempt(stored.communication, receipt, stored.attempts.length + 1)
      const communication = {
        ...stored.communication,
        status: communicationStatusFor(receipt.status),
      } satisfies Communication
      const result: CommunicationProcessingResult = {
        ...stored.result,
        duplicate: false,
        communication,
        attempt,
        receipt,
      }
      stored.communication = communication
      stored.result = result
      stored.attempts.push(attempt)
      return result
    })

  const deliver = Effect.fn("CommunicationService.deliver")(function* (input: unknown) {
    const decoded = yield* Schema.decodeUnknownEffect(RetryCommunicationInput)(input)
    return yield* send(decoded.communicationId, false)
  })

  const retry = Effect.fn("CommunicationService.retry")(function* (input: unknown) {
    const decoded = yield* Schema.decodeUnknownEffect(RetryCommunicationInput)(input)
    return yield* send(decoded.communicationId, true)
  })

  const service: CommunicationService = {
    processPurchaseOrderConfirmed,
    deliver,
    retry,
  }
  return service
})
