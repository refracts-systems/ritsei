import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  Communication,
  CommunicationArtifact,
  CommunicationContextFailure,
  CommunicationIntent,
  CommunicationRecipientResolutionFailure,
  CommunicationRenderFailure,
  CommunicationTransportFailure,
  DatabaseFailure,
  DeliveryAttempt,
  CommunicationSubject,
  DeliveryReceipt,
  InstantString,
  PreparedEmail,
  RecipientMailbox,
  SenderIdentity,
} from "../../../../framework/foundation/mod.ts"
import { Principal } from "../../../../framework/modules/auth/mod.ts"
import type { AuthorizationDenied } from "../../../../framework/modules/authorization/mod.ts"
import { EventEnvelope } from "../../../../framework/modules/messaging/mod.ts"
import {
  CommunicationNotFound,
  CommunicationPreviewStale,
  CommunicationStateFailure,
  UnsupportedCommunicationEvent,
} from "./errors.ts"

const Uuid = Schema.String.check(Schema.isUUID())
const NonEmptyString = Schema.String.check(Schema.isPattern(/\S/))
const Sha256 = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/))

export const ProcessPurchaseOrderConfirmedInput = Schema.Struct({
  event: EventEnvelope,
})

export type ProcessPurchaseOrderConfirmedInput = Schema.Schema.Type<
  typeof ProcessPurchaseOrderConfirmedInput
>

const CommunicationScope = { principal: Principal, tenantId: Uuid, communicationId: Uuid }

/** Reads one communication: its preview or its delivery attempts. */
export const CommunicationQueryInput = Schema.Struct(CommunicationScope)

export type CommunicationQueryInput = Schema.Schema.Type<typeof CommunicationQueryInput>

/**
 * Sends a communication once. It names the rendering the caller previewed, so what is sent is what
 * was reviewed; a different rendering is refused.
 */
export const SendCommunicationInput = Schema.Struct({
  ...CommunicationScope,
  previewedArtifactId: Uuid,
})

export type SendCommunicationInput = Schema.Schema.Type<typeof SendCommunicationInput>

export const RetryCommunicationInput = Schema.Struct(CommunicationScope)

export type RetryCommunicationInput = Schema.Schema.Type<typeof RetryCommunicationInput>

/**
 * What would be sent, exactly: the sender, the recipients as resolved, and the rendered message.
 * Reading it calls no transport, so it can be repeated freely.
 */
export const CommunicationPreview = Schema.Struct({
  communicationId: Uuid,
  status: Communication.fields.status,
  artifactId: Uuid,
  sender: SenderIdentity,
  to: Schema.Array(RecipientMailbox),
  cc: Schema.Array(RecipientMailbox),
  bcc: Schema.Array(RecipientMailbox),
  subject: Schema.String,
  html: Schema.String,
  text: Schema.String,
  attachments: CommunicationArtifact.fields.attachments,
  attempts: Schema.Int,
})

export type CommunicationPreview = Schema.Schema.Type<typeof CommunicationPreview>

/**
 * A dispatch that happened before cutover, recorded from the source system's evidence. It is an
 * outcome only: recording never renders, resolves recipients, or calls the transport, and the
 * record can never be sent or retried.
 */
export const HistoricalDispatchOutcome = Schema.Literals(["sent", "failed", "unknown"])

export type HistoricalDispatchOutcome = Schema.Schema.Type<typeof HistoricalDispatchOutcome>

/** The retained source bytes the dispatch carried; the document's owner stores the bytes. */
export const HistoricalDocumentRef = Schema.Struct({
  documentArtifactId: Uuid,
  contentHash: Sha256,
  filename: NonEmptyString,
  mediaType: NonEmptyString,
})

export type HistoricalDocumentRef = Schema.Schema.Type<typeof HistoricalDocumentRef>

export const RecordHistoricalDispatchInput = Schema.Struct({
  principal: Principal,
  tenantId: Uuid,
  sourceSystem: CommunicationSubject.fields.owner,
  sourceReference: NonEmptyString,
  subject: CommunicationSubject,
  document: HistoricalDocumentRef,
  recipients: Schema.Array(RecipientMailbox),
  outcome: HistoricalDispatchOutcome,
  providerId: DeliveryAttempt.fields.providerId,
  providerMessageId: DeliveryAttempt.fields.providerMessageId,
  failureCode: DeliveryAttempt.fields.failureCode,
  observedAt: InstantString,
}).check(
  Schema.makeFilter((input) => input.outcome !== "sent" || input.failureCode === null, {
    expected: "a sent historical dispatch without a failure code",
  }),
)

export type RecordHistoricalDispatchInput = Schema.Schema.Type<typeof RecordHistoricalDispatchInput>

export const HistoricalDispatchResult = Schema.Struct({
  duplicate: Schema.Boolean,
  communication: Communication,
  attempt: DeliveryAttempt,
  document: HistoricalDocumentRef,
})

export type HistoricalDispatchResult = Schema.Schema.Type<typeof HistoricalDispatchResult>

export const CommunicationProcessingResult = Schema.Struct({
  duplicate: Schema.Boolean,
  intent: CommunicationIntent,
  communication: Communication,
  artifact: CommunicationArtifact,
  attempt: Schema.NullOr(DeliveryAttempt),
  receipt: Schema.NullOr(DeliveryReceipt),
})

export type CommunicationProcessingResult = Schema.Schema.Type<typeof CommunicationProcessingResult>

export interface CommunicationConfiguration {
  readonly sender: SenderIdentity
}

export const CommunicationConfiguration = Context.Service<CommunicationConfiguration>(
  "RITSEI/CommunicationConfiguration",
)

export interface CommunicationPolicy {
  readonly derivePurchaseOrderConfirmed: (
    input: Schema.Codec.Encoded<typeof EventEnvelope>,
  ) => Effect.Effect<CommunicationIntent, UnsupportedCommunicationEvent | Schema.SchemaError>
}

export const CommunicationPolicy = Context.Service<CommunicationPolicy>(
  "RITSEI/CommunicationPolicy",
)

export interface CommunicationService {
  readonly processPurchaseOrderConfirmed: (
    input: Schema.Codec.Encoded<typeof ProcessPurchaseOrderConfirmedInput>,
  ) => Effect.Effect<
    CommunicationProcessingResult,
    | CommunicationNotFound
    | CommunicationStateFailure
    | UnsupportedCommunicationEvent
    | CommunicationRecipientResolutionFailure
    | CommunicationContextFailure
    | CommunicationRenderFailure
    | DatabaseFailure
    | Schema.SchemaError
  >
  readonly recordHistoricalDispatch: (
    input: Schema.Codec.Encoded<typeof RecordHistoricalDispatchInput>,
  ) => Effect.Effect<
    HistoricalDispatchResult,
    AuthorizationDenied | CommunicationStateFailure | DatabaseFailure | Schema.SchemaError
  >
  /** What would be sent, with no side effect: the review that comes before `deliver`. */
  readonly preview: (
    input: Schema.Codec.Encoded<typeof CommunicationQueryInput>,
  ) => Effect.Effect<
    CommunicationPreview,
    AuthorizationDenied | CommunicationNotFound | DatabaseFailure | Schema.SchemaError
  >
  /** The delivery attempts so far, oldest first. Attempts are only ever appended. */
  readonly listAttempts: (
    input: Schema.Codec.Encoded<typeof CommunicationQueryInput>,
  ) => Effect.Effect<
    ReadonlyArray<DeliveryAttempt>,
    AuthorizationDenied | CommunicationNotFound | DatabaseFailure | Schema.SchemaError
  >
  /** The first send, of the previewed rendering. It cannot be undone. */
  readonly deliver: (
    input: Schema.Codec.Encoded<typeof SendCommunicationInput>,
  ) => Effect.Effect<
    CommunicationProcessingResult,
    | AuthorizationDenied
    | CommunicationNotFound
    | CommunicationPreviewStale
    | CommunicationStateFailure
    | CommunicationTransportFailure
    | DatabaseFailure
    | Schema.SchemaError
  >
  /** Sends the same rendering again after an attempt. */
  readonly retry: (
    input: Schema.Codec.Encoded<typeof RetryCommunicationInput>,
  ) => Effect.Effect<
    CommunicationProcessingResult,
    | AuthorizationDenied
    | CommunicationNotFound
    | CommunicationStateFailure
    | CommunicationTransportFailure
    | DatabaseFailure
    | Schema.SchemaError
  >
}

export const CommunicationService = Context.Service<CommunicationService>(
  "RITSEI/CommunicationService",
)

export interface CommunicationTestTransport {
  readonly sent: ReadonlyArray<PreparedEmail>
}

export const CommunicationTestTransport = Context.Service<CommunicationTestTransport>(
  "RITSEI/CommunicationTestTransport",
)
