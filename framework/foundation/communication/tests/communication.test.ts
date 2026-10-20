import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  Communication,
  CommunicationArtifact,
  CommunicationContext,
  communicationIdempotencyKey,
  CommunicationIntent,
  DeliveryAttempt,
  EmailMessage,
  createCommunicationIntent,
  RecipientSnapshot,
} from "../mod.ts"

const tenantId = "01990000-0000-7000-8000-000000000001"
const subjectId = "01990000-0000-7000-8000-000000000002"
const eventId = "01990000-0000-7000-8000-000000000003"
const communicationId = "01990000-0000-7000-8000-000000000004"
const artifactId = "01990000-0000-7000-8000-000000000005"
const documentArtifactId = "01990000-0000-7000-8000-000000000006"
const attemptId = "01990000-0000-7000-8000-000000000007"
const evidenceId = "01990000-0000-7000-8000-000000000008"
const timestamp = "2026-09-06T00:00:00.000Z"
const hash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

const intent = {
  communicationId,
  tenantId,
  intentType: "purchase-order-approved",
  subject: { owner: "procurement", type: "purchase_order", id: subjectId },
  sourceEvent: {
    eventId,
    eventType: "procurement.purchase_order.approved",
    eventVersion: 1,
    occurredAt: timestamp,
    correlationId: "po-approval-1",
    causationId: null,
  },
  audience: {
    type: "supplier-order-contact",
    subject: { owner: "procurement", type: "purchase_order", id: subjectId },
  },
  channels: ["email"],
  priority: "normal",
  locale: "en-US",
  timezone: "Asia/Jakarta",
  idempotencyKey: "purchase-order-approved:1",
  correlationId: "po-approval-1",
} as const

it.effect("creates a versioned intent without coupling it to a provider", () =>
  Effect.gen(function* () {
    const { communicationId: _communicationId, ...withoutId } = intent
    const created = yield* createCommunicationIntent(withoutId)
    const decoded = yield* Schema.decodeUnknownEffect(CommunicationIntent)(created)

    assert.isString(decoded.communicationId)
    assert.strictEqual(decoded.intentType, "purchase-order-approved")
    assert.strictEqual(decoded.status, "requested")
    assert.strictEqual(
      communicationIdempotencyKey(decoded),
      `${tenantId}:purchase-order-approved:purchase-order-approved:1`,
    )
  }),
)

it.effect("keeps logical audience separate from resolved recipient snapshot", () =>
  Effect.gen(function* () {
    const snapshot = yield* Schema.decodeUnknownEffect(RecipientSnapshot)({
      audience: intent.audience,
      to: [{ address: "finance@example.com", displayName: "Finance" }],
      cc: [],
      bcc: [],
      resolverId: "supplier-order-contact",
      resolverVersion: 1,
      resolvedAt: timestamp,
    })

    assert.strictEqual(snapshot.audience.type, "supplier-order-contact")
    assert.strictEqual(snapshot.to[0]?.address, "finance@example.com")
  }),
)

it.effect("rejects unsafe email links and malformed table rows", () =>
  Effect.gen(function* () {
    const unsafe = yield* Effect.flip(
      Schema.decodeUnknownEffect(EmailMessage)({
        subject: "Purchase order",
        nodes: [{ _tag: "button", label: "Open", href: "javascript:alert(1)" }],
        attachments: [],
      }),
    )
    const malformedTable = yield* Effect.flip(
      Schema.decodeUnknownEffect(EmailMessage)({
        subject: "Purchase order",
        nodes: [{ _tag: "table", headers: ["Item", "Quantity"], rows: [["Widget"]] }],
        attachments: [],
      }),
    )

    assert.strictEqual(unsafe._tag, "SchemaError")
    assert.strictEqual(malformedTable._tag, "SchemaError")
  }),
)

it.effect("keeps unknown provider outcomes on attempts while communication reconciles", () =>
  Effect.gen(function* () {
    const communication = yield* Schema.decodeUnknownEffect(Communication)({
      communicationId,
      tenantId,
      intentType: intent.intentType,
      subject: intent.subject,
      audience: intent.audience,
      channels: ["email"],
      status: "reconciling",
      recipientSnapshot: null,
      template: null,
      artifactId: null,
      createdAt: timestamp,
    })
    const attempt = yield* Schema.decodeUnknownEffect(DeliveryAttempt)({
      attemptId,
      communicationId,
      tenantId,
      attemptNumber: 1,
      providerId: "smtp-primary",
      status: "unknown",
      providerMessageId: null,
      providerEvidenceId: evidenceId,
      failureCode: "provider-timeout",
      startedAt: timestamp,
      completedAt: timestamp,
    })

    assert.strictEqual(communication.status, "reconciling")
    assert.strictEqual(attempt.status, "unknown")
    assert.strictEqual(attempt.providerEvidenceId, evidenceId)
  }),
)

it.effect("binds an email artifact to an existing document artifact reference", () =>
  Effect.gen(function* () {
    const context = yield* Schema.decodeUnknownEffect(CommunicationContext)({
      contextType: "purchase-order-approved-context",
      contextVersion: 1,
      tenantId,
      communicationId,
      locale: "en-US",
      timezone: "Asia/Jakarta",
      data: { purchaseOrder: { number: "PO-2026-0001" } },
    })
    const artifact = yield* Schema.decodeUnknownEffect(CommunicationArtifact)({
      artifactId,
      communicationId,
      tenantId,
      channel: "email",
      template: {
        templateId: "purchase-order-approved-default",
        templateVersion: 3,
        contextType: context.contextType,
        contextVersion: context.contextVersion,
        locale: context.locale,
      },
      subject: "Purchase order approved",
      html: "<p>Purchase order approved</p>",
      text: "Purchase order approved",
      htmlHash: hash,
      textHash: hash,
      attachments: [
        {
          documentArtifactId,
          filename: "purchase-order.pdf",
          mediaType: "application/pdf",
          disposition: "attachment",
        },
      ],
      rendererVersion: "email-ast@1",
      createdAt: timestamp,
    })

    assert.strictEqual(artifact.attachments[0]?.documentArtifactId, documentArtifactId)
    assert.strictEqual(artifact.template.templateVersion, 3)
  }),
)
