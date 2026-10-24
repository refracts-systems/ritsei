import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { uuidv7 } from "../ids/mod.ts"
import { InstantString } from "../time/mod.ts"

const Uuid = Schema.String.check(Schema.isUUID())
const NonEmptyString = Schema.String.check(Schema.isPattern(/\S/))
const Slug = Schema.String.check(
  Schema.makeFilter((value) => /^[a-z][a-z0-9._-]*$/.test(value), {
    expected: "a lowercase communication slug",
  }),
)
const PositiveInteger = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 2_147_483_647 }))
const NonNegativeInteger = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: 2_147_483_647 }),
)
const Sha256 = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/))
const EmailAddress = Schema.String.check(
  Schema.makeFilter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), {
    expected: "an email address",
  }),
)
const SafeEmailLink = Schema.String.check(
  Schema.makeFilter((value) => /^(?:https:\/\/|app:\/\/|\/)/i.test(value), {
    expected: "an https, app, or relative email link",
  }),
)
const Locale = Schema.String.check(
  Schema.makeFilter((value) => /^[a-z]{2,3}(?:-[A-Z][a-z]{2})?(?:-[A-Z]{2})?$/.test(value), {
    expected: "a BCP-47 locale",
  }),
)

export const CommunicationChannel = Schema.Literals(["email", "in_app", "sms", "push", "whatsapp"])
export type CommunicationChannel = Schema.Schema.Type<typeof CommunicationChannel>

export const CommunicationPriority = Schema.Literals(["critical", "high", "normal", "low"])
export type CommunicationPriority = Schema.Schema.Type<typeof CommunicationPriority>

export const CommunicationStatus = Schema.Literals([
  "requested",
  "resolving",
  "rendered",
  "queued",
  "sending",
  "reconciling",
  "accepted",
  "cancelled",
  "failed",
])
export type CommunicationStatus = Schema.Schema.Type<typeof CommunicationStatus>

export const DeliveryAttemptStatus = Schema.Literals([
  "planned",
  "sending",
  "accepted",
  "delivered",
  "bounced",
  "rejected",
  "complained",
  "failed",
  "unknown",
])
export type DeliveryAttemptStatus = Schema.Schema.Type<typeof DeliveryAttemptStatus>

export const CommunicationSubject = Schema.Struct({
  owner: Slug,
  type: Slug,
  id: Uuid,
})
export type CommunicationSubject = Schema.Schema.Type<typeof CommunicationSubject>

export const CommunicationAudience = Schema.Struct({
  type: Slug,
  subject: CommunicationSubject,
})
export type CommunicationAudience = Schema.Schema.Type<typeof CommunicationAudience>

export const CommunicationSourceEvent = Schema.Struct({
  eventId: Uuid,
  eventType: NonEmptyString,
  eventVersion: PositiveInteger,
  occurredAt: InstantString,
  correlationId: NonEmptyString,
  causationId: Schema.NullOr(NonEmptyString),
})
export type CommunicationSourceEvent = Schema.Schema.Type<typeof CommunicationSourceEvent>

export const CommunicationIntentInput = Schema.Struct({
  communicationId: Schema.optionalKey(Uuid),
  tenantId: Uuid,
  intentType: Slug,
  subject: CommunicationSubject,
  sourceEvent: CommunicationSourceEvent,
  audience: CommunicationAudience,
  channels: Schema.Array(CommunicationChannel).check(Schema.isMinLength(1)),
  priority: CommunicationPriority,
  locale: Schema.optionalKey(Locale),
  timezone: Schema.optionalKey(NonEmptyString),
  idempotencyKey: NonEmptyString,
  correlationId: NonEmptyString,
})
export type CommunicationIntentInput = Schema.Schema.Type<typeof CommunicationIntentInput>

export const CommunicationIntent = Schema.Struct({
  ...CommunicationIntentInput.fields,
  communicationId: Uuid,
  requestedAt: InstantString,
  status: Schema.Literal("requested"),
})
export type CommunicationIntent = Schema.Schema.Type<typeof CommunicationIntent>

export const RecipientMailbox = Schema.Struct({
  address: EmailAddress,
  displayName: Schema.optionalKey(NonEmptyString),
})
export type RecipientMailbox = Schema.Schema.Type<typeof RecipientMailbox>

export const RecipientSnapshot = Schema.Struct({
  audience: CommunicationAudience,
  to: Schema.Array(RecipientMailbox).check(Schema.isMinLength(1)),
  cc: Schema.Array(RecipientMailbox),
  bcc: Schema.Array(RecipientMailbox),
  resolverId: Slug,
  resolverVersion: PositiveInteger,
  resolvedAt: InstantString,
})
export type RecipientSnapshot = Schema.Schema.Type<typeof RecipientSnapshot>

export const SenderIdentity = Schema.Struct({
  senderId: Slug,
  address: EmailAddress,
  displayName: Schema.optionalKey(NonEmptyString),
  replyTo: Schema.optionalKey(EmailAddress),
})
export type SenderIdentity = Schema.Schema.Type<typeof SenderIdentity>

export const CommunicationTemplateRef = Schema.Struct({
  templateId: Slug,
  templateVersion: PositiveInteger,
  contextType: Slug,
  contextVersion: PositiveInteger,
  locale: Locale,
})
export type CommunicationTemplateRef = Schema.Schema.Type<typeof CommunicationTemplateRef>

export const CommunicationContext = Schema.Struct({
  contextType: Slug,
  contextVersion: PositiveInteger,
  tenantId: Uuid,
  communicationId: Uuid,
  locale: Locale,
  timezone: NonEmptyString,
  data: Schema.Json,
})
export type CommunicationContext = Schema.Schema.Type<typeof CommunicationContext>

export const CommunicationAttachmentRef = Schema.Struct({
  documentArtifactId: Uuid,
  filename: NonEmptyString,
  mediaType: NonEmptyString,
  disposition: Schema.Literals(["attachment", "inline"]),
  contentId: Schema.optionalKey(NonEmptyString),
})
export type CommunicationAttachmentRef = Schema.Schema.Type<typeof CommunicationAttachmentRef>

export const EmailHeadingNode = Schema.TaggedStruct("heading", {
  level: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 6 })),
  text: NonEmptyString,
})
export const EmailTextNode = Schema.TaggedStruct("text", {
  text: NonEmptyString,
})
export const EmailImageNode = Schema.TaggedStruct("image", {
  assetId: NonEmptyString,
  alt: NonEmptyString,
})
export const EmailButtonNode = Schema.TaggedStruct("button", {
  label: NonEmptyString,
  href: SafeEmailLink,
})
export const EmailDividerNode = Schema.TaggedStruct("divider", {})
export const EmailSpacerNode = Schema.TaggedStruct("spacer", {
  heightPx: NonNegativeInteger,
})
export const EmailKeyValueNode = Schema.TaggedStruct("key_value", {
  entries: Schema.Array(
    Schema.Struct({
      label: NonEmptyString,
      value: NonEmptyString,
    }),
  ).check(Schema.isMinLength(1)),
})
export const EmailTableNode = Schema.TaggedStruct("table", {
  headers: Schema.Array(NonEmptyString).check(Schema.isMinLength(1)),
  rows: Schema.Array(Schema.Array(NonEmptyString)),
}).check(
  Schema.makeFilter((node) => node.rows.every((row) => row.length === node.headers.length), {
    expected: "email table rows must match the header width",
  }),
)

export const EmailMessageNode = Schema.Union([
  EmailHeadingNode,
  EmailTextNode,
  EmailImageNode,
  EmailButtonNode,
  EmailDividerNode,
  EmailSpacerNode,
  EmailKeyValueNode,
  EmailTableNode,
]).pipe(Schema.toTaggedUnion("_tag"))
export type EmailMessageNode = Schema.Schema.Type<typeof EmailMessageNode>

export const EmailMessage = Schema.Struct({
  subject: NonEmptyString,
  preheader: Schema.optionalKey(NonEmptyString),
  nodes: Schema.Array(EmailMessageNode).check(Schema.isMinLength(1)),
  attachments: Schema.Array(CommunicationAttachmentRef),
})
export type EmailMessage = Schema.Schema.Type<typeof EmailMessage>

export const EmailRenderInput = Schema.Struct({
  intent: CommunicationIntent,
  context: CommunicationContext,
  template: CommunicationTemplateRef,
  message: EmailMessage,
})
export type EmailRenderInput = Schema.Schema.Type<typeof EmailRenderInput>

export const CommunicationArtifact = Schema.Struct({
  artifactId: Uuid,
  communicationId: Uuid,
  tenantId: Uuid,
  channel: Schema.Literal("email"),
  template: CommunicationTemplateRef,
  subject: NonEmptyString,
  html: NonEmptyString,
  text: NonEmptyString,
  htmlHash: Sha256,
  textHash: Sha256,
  attachments: Schema.Array(CommunicationAttachmentRef),
  rendererVersion: NonEmptyString,
  createdAt: InstantString,
})
export type CommunicationArtifact = Schema.Schema.Type<typeof CommunicationArtifact>

export const EmailHeader = Schema.Struct({
  name: NonEmptyString,
  value: NonEmptyString,
})
export type EmailHeader = Schema.Schema.Type<typeof EmailHeader>

export const PreparedEmail = Schema.Struct({
  artifactId: Uuid,
  communicationId: Uuid,
  sender: SenderIdentity,
  to: Schema.Array(RecipientMailbox).check(Schema.isMinLength(1)),
  cc: Schema.Array(RecipientMailbox),
  bcc: Schema.Array(RecipientMailbox),
  subject: NonEmptyString,
  html: NonEmptyString,
  text: NonEmptyString,
  attachments: Schema.Array(CommunicationAttachmentRef),
  headers: Schema.Array(EmailHeader),
})
export type PreparedEmail = Schema.Schema.Type<typeof PreparedEmail>

export const DeliveryReceipt = Schema.Struct({
  communicationId: Uuid,
  attemptId: Uuid,
  providerId: Slug,
  status: Schema.Literals(["accepted", "unknown"]),
  providerMessageId: Schema.NullOr(NonEmptyString),
  observedAt: InstantString,
})
export type DeliveryReceipt = Schema.Schema.Type<typeof DeliveryReceipt>

export const DeliveryAttempt = Schema.Struct({
  attemptId: Uuid,
  communicationId: Uuid,
  tenantId: Uuid,
  attemptNumber: PositiveInteger,
  providerId: Slug,
  status: DeliveryAttemptStatus,
  providerMessageId: Schema.NullOr(NonEmptyString),
  providerEvidenceId: Schema.NullOr(Uuid),
  failureCode: Schema.NullOr(Slug),
  startedAt: InstantString,
  completedAt: Schema.NullOr(InstantString),
})
export type DeliveryAttempt = Schema.Schema.Type<typeof DeliveryAttempt>

export const Communication = Schema.Struct({
  communicationId: Uuid,
  tenantId: Uuid,
  intentType: Slug,
  subject: CommunicationSubject,
  audience: CommunicationAudience,
  channels: Schema.Array(CommunicationChannel).check(Schema.isMinLength(1)),
  status: CommunicationStatus,
  recipientSnapshot: Schema.NullOr(RecipientSnapshot),
  template: Schema.NullOr(CommunicationTemplateRef),
  artifactId: Schema.NullOr(Uuid),
  createdAt: InstantString,
})
export type Communication = Schema.Schema.Type<typeof Communication>

export class CommunicationRecipientResolutionFailure extends Schema.TaggedError<CommunicationRecipientResolutionFailure>()(
  "CommunicationRecipientResolutionFailure",
  { reason: NonEmptyString },
) {}

export class CommunicationContextFailure extends Schema.TaggedError<CommunicationContextFailure>()(
  "CommunicationContextFailure",
  { reason: NonEmptyString },
) {}

export class CommunicationRenderFailure extends Schema.TaggedError<CommunicationRenderFailure>()(
  "CommunicationRenderFailure",
  { reason: NonEmptyString, cause: Schema.Unknown },
) {}

export class CommunicationTransportFailure extends Schema.TaggedError<CommunicationTransportFailure>()(
  "CommunicationTransportFailure",
  {
    providerId: Slug,
    kind: Schema.Literals(["temporary", "permanent", "rate_limited", "unknown"]),
    reason: NonEmptyString,
    cause: Schema.Unknown,
  },
) {}

export interface CommunicationRecipientResolver {
  readonly resolve: (
    input: Schema.Codec.Encoded<typeof CommunicationIntent>,
  ) => Effect.Effect<
    RecipientSnapshot,
    CommunicationRecipientResolutionFailure | Schema.SchemaError
  >
}

export const CommunicationRecipientResolver = Context.Service<CommunicationRecipientResolver>(
  "RITSEI/CommunicationRecipientResolver",
)

/** What a context builder receives: the intent and the owner data it is built from. */
export const CommunicationContextInput = Schema.Struct({
  intent: CommunicationIntent,
  data: Schema.Json,
})

export interface CommunicationContextBuilder {
  readonly build: (
    input: Schema.Codec.Encoded<typeof CommunicationContextInput>,
  ) => Effect.Effect<CommunicationContext, CommunicationContextFailure | Schema.SchemaError>
}

export const CommunicationContextBuilder = Context.Service<CommunicationContextBuilder>(
  "RITSEI/CommunicationContextBuilder",
)

export interface EmailRenderer {
  readonly render: (
    input: Schema.Codec.Encoded<typeof EmailRenderInput>,
  ) => Effect.Effect<CommunicationArtifact, CommunicationRenderFailure | Schema.SchemaError>
}

export const EmailRenderer = Context.Service<EmailRenderer>("RITSEI/EmailRenderer")

export interface EmailTransport {
  readonly send: (
    input: Schema.Codec.Encoded<typeof PreparedEmail>,
  ) => Effect.Effect<DeliveryReceipt, CommunicationTransportFailure | Schema.SchemaError>
}

export const EmailTransport = Context.Service<EmailTransport>("RITSEI/EmailTransport")

export const createCommunicationIntent = (
  input: Schema.Codec.Encoded<typeof CommunicationIntentInput>,
) =>
  Effect.gen(function* () {
    const decoded = yield* Schema.decodeUnknownEffect(CommunicationIntentInput)(input)
    return {
      ...decoded,
      communicationId: decoded.communicationId ?? uuidv7(),
      requestedAt: new Date().toISOString(),
      status: "requested" as const,
    } satisfies CommunicationIntent
  })

export const communicationIdempotencyKey = (
  intent: Pick<CommunicationIntent, "tenantId" | "intentType" | "idempotencyKey">,
) => `${intent.tenantId}:${intent.intentType}:${intent.idempotencyKey}`
