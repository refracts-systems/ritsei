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
  EmailHeadingNode,
  EmailKeyValueNode,
  EmailMessage,
  EmailRenderer,
  EmailRenderInput,
  EmailTextNode,
  EmailTransport,
  PreparedEmail,
  RecipientSnapshot,
  SenderIdentity,
  uuidv7,
} from "../../../../framework/foundation/mod.ts"
import {
  EventEnvelope,
  MessagingService as MessagingServiceTag,
} from "../../../../framework/modules/messaging/mod.ts"
import {
  AuthorizationService,
  scopedCommand,
} from "../../../../framework/modules/authorization/mod.ts"
import { CommunicationCapabilities } from "./capabilities.ts"
import { PurchaseOrderConfirmedEventPayload } from "../../procurement/mod.ts"
import {
  CommunicationConfiguration,
  CommunicationPolicy,
  CommunicationPreview,
  CommunicationProcessingResult,
  CommunicationQueryInput,
  CommunicationService,
  HistoricalDispatchOutcome,
  HistoricalDispatchResult,
  ProcessPurchaseOrderConfirmedInput,
  RecordHistoricalDispatchInput,
  RetryCommunicationInput,
  SendCommunicationInput,
} from "./contract.ts"
import {
  CommunicationNotFound,
  CommunicationPreviewStale,
  CommunicationStateFailure,
} from "./errors.ts"

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

const historicalIntentType = "historical-document-dispatch"

const historicalStatuses = {
  sent: { attempt: "accepted", communication: "accepted" },
  failed: { attempt: "failed", communication: "failed" },
  unknown: { attempt: "unknown", communication: "reconciling" },
} as const satisfies Record<
  HistoricalDispatchOutcome,
  { attempt: DeliveryAttempt["status"]; communication: Communication["status"] }
>

const historicalFailureCodes = {
  sent: null,
  failed: "historical-delivery-failed",
  unknown: "historical-delivery-unknown",
} as const satisfies Record<HistoricalDispatchOutcome, string | null>

const eventKey = (event: Pick<EventEnvelope, "tenantId" | "eventId">) =>
  `${event.tenantId}:${event.eventId}`

const makeEmailMessage = (
  event: EventEnvelope,
  payload: PurchaseOrderConfirmedPayload,
): EmailMessage => ({
  subject: `Purchase order ${event.aggregateId} confirmed`,
  preheader: "Your purchase order has been confirmed.",
  nodes: [
    EmailHeadingNode.make({ level: 1, text: "Purchase order confirmed" }),
    EmailTextNode.make({
      text: `Purchase order ${event.aggregateId} was confirmed for ${payload.total}.`,
    }),
    EmailKeyValueNode.make({
      entries: [
        { label: "Purchase order", value: event.aggregateId },
        { label: "Supplier", value: payload.supplierAccountId },
        { label: "Total", value: payload.total },
      ],
    }),
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
  const authorization = yield* AuthorizationService
  const authorized = scopedCommand(authorization)
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

  const historicalByKey = new Map<
    string,
    { readonly input: RecordHistoricalDispatchInput; readonly result: HistoricalDispatchResult }
  >()

  const historicalIds = new Set<string>()

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
  )(function* (input: Schema.Codec.Encoded<typeof ProcessPurchaseOrderConfirmedInput>) {
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

  const recordHistoricalDispatch = Effect.fn("CommunicationService.recordHistoricalDispatch")(
    function* (input: Schema.Codec.Encoded<typeof RecordHistoricalDispatchInput>) {
      const decoded = yield* authorized(
        RecordHistoricalDispatchInput,
        CommunicationCapabilities.historicalDispatchRecord,
      )(input)

      const key = `${decoded.tenantId}:${decoded.sourceSystem}:${decoded.sourceReference}`
      const existing = historicalByKey.get(key)

      if (existing !== undefined) {
        if (JSON.stringify(existing.input) !== JSON.stringify(decoded)) {
          return yield* Effect.fail(
            new CommunicationStateFailure({
              reason: "historical dispatch was already recorded with different evidence",
            }),
          )
        }

        return { ...existing.result, duplicate: true }
      }

      const statuses = historicalStatuses[decoded.outcome]
      const communicationId = uuidv7()
      const subject = decoded.subject

      const communication: Communication = {
        communicationId,
        tenantId: decoded.tenantId,
        intentType: historicalIntentType,
        subject,
        audience: { type: "historical-recipients", subject },
        channels: ["email"],
        status: statuses.communication,
        recipientSnapshot:
          decoded.recipients.length === 0
            ? null
            : {
                audience: { type: "historical-recipients", subject },
                to: decoded.recipients,
                cc: [],
                bcc: [],
                resolverId: "historical-import",
                resolverVersion: 1,
                resolvedAt: decoded.observedAt,
              },
        template: null,
        artifactId: null,
        createdAt: new Date().toISOString(),
      }

      const attempt: DeliveryAttempt = {
        attemptId: uuidv7(),
        communicationId,
        tenantId: decoded.tenantId,
        attemptNumber: 1,
        providerId: decoded.providerId,
        status: statuses.attempt,
        providerMessageId: decoded.providerMessageId,
        providerEvidenceId: null,
        failureCode: decoded.failureCode ?? historicalFailureCodes[decoded.outcome],
        startedAt: decoded.observedAt,
        completedAt: decoded.observedAt,
      }

      const result: HistoricalDispatchResult = {
        duplicate: false,
        communication,
        attempt,
        document: decoded.document,
      }

      historicalByKey.set(key, { input: decoded, result })
      historicalIds.add(communicationId)

      return result
    },
  )

  /** A communication of the caller's tenant; another tenant's is not found. */
  const storedFor = (tenantId: string, communicationId: string) =>
    Effect.gen(function* () {
      const stored = byCommunicationId.get(communicationId)

      if (stored === undefined || stored.communication.tenantId !== tenantId) {
        return yield* Effect.fail(new CommunicationNotFound({ communicationId }))
      }

      return stored
    })

  const preview = Effect.fn("CommunicationService.preview")(function* (
    input: Schema.Codec.Encoded<typeof CommunicationQueryInput>,
  ) {
    const decoded = yield* authorized(
      CommunicationQueryInput,
      CommunicationCapabilities.communicationRead,
    )(input)

    const stored = yield* storedFor(decoded.tenantId, decoded.communicationId)
    const email = stored.preparedEmail

    return {
      communicationId: stored.communication.communicationId,
      status: stored.communication.status,
      artifactId: email.artifactId,
      sender: email.sender,
      to: email.to,
      cc: email.cc,
      bcc: email.bcc,
      subject: email.subject,
      html: email.html,
      text: email.text,
      attachments: email.attachments,
      attempts: stored.attempts.length,
    } satisfies CommunicationPreview
  })

  const listAttempts = Effect.fn("CommunicationService.listAttempts")(function* (
    input: Schema.Codec.Encoded<typeof CommunicationQueryInput>,
  ) {
    const decoded = yield* authorized(
      CommunicationQueryInput,
      CommunicationCapabilities.communicationRead,
    )(input)

    const stored = yield* storedFor(decoded.tenantId, decoded.communicationId)

    // Copies, frozen: a reader cannot rewrite the log.
    return stored.attempts.map((attempt) => Object.freeze({ ...attempt }))
  })

  const refuseHistorical = (communicationId: string) =>
    historicalIds.has(communicationId)
      ? Effect.fail(
          new CommunicationStateFailure({ reason: "historical dispatch is never sent or retried" }),
        )
      : Effect.void

  const send = (tenantId: string, communicationId: string, retry: boolean) =>
    Effect.gen(function* () {
      yield* refuseHistorical(communicationId)

      const stored = yield* storedFor(tenantId, communicationId)

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

  const deliver = Effect.fn("CommunicationService.deliver")(function* (
    input: Schema.Codec.Encoded<typeof SendCommunicationInput>,
  ) {
    const decoded = yield* authorized(
      SendCommunicationInput,
      CommunicationCapabilities.communicationSend,
    )(input)

    // The rendering is fixed once made, so a send of anything but the previewed one is refused
    // before the transport is touched.
    yield* refuseHistorical(decoded.communicationId)
    const stored = yield* storedFor(decoded.tenantId, decoded.communicationId)

    if (decoded.previewedArtifactId !== stored.preparedEmail.artifactId) {
      return yield* Effect.fail(
        new CommunicationPreviewStale({
          communicationId: decoded.communicationId,
          previewedArtifactId: decoded.previewedArtifactId,
          currentArtifactId: stored.preparedEmail.artifactId,
        }),
      )
    }

    return yield* send(decoded.tenantId, decoded.communicationId, false)
  })

  const retry = Effect.fn("CommunicationService.retry")(function* (
    input: Schema.Codec.Encoded<typeof RetryCommunicationInput>,
  ) {
    const decoded = yield* authorized(
      RetryCommunicationInput,
      CommunicationCapabilities.communicationSend,
    )(input)

    return yield* send(decoded.tenantId, decoded.communicationId, true)
  })

  const service: CommunicationService = {
    processPurchaseOrderConfirmed,
    recordHistoricalDispatch,
    preview,
    listAttempts,
    deliver,
    retry,
  }

  return service
})
