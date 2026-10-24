import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import {
  CommunicationArtifact,
  CommunicationContext,
  CommunicationContextBuilder,
  CommunicationContextInput,
  CommunicationIntent,
  CommunicationRecipientResolver,
  CommunicationRenderFailure,
  EmailMessage,
  EmailMessageNode,
  EmailRenderer,
  EmailRenderInput,
  EmailTransport,
  createCommunicationIntent,
  PreparedEmail,
  RecipientMailbox,
  RecipientSnapshot,
  SenderIdentity,
  uuidv7,
} from "../../../../framework/foundation/mod.ts"
import { EventEnvelope } from "../../../../framework/modules/messaging/mod.ts"
import { ProcurementPurchaseOrderConfirmedEvent } from "../../procurement/mod.ts"
import {
  CommunicationConfiguration,
  CommunicationPolicy,
  CommunicationService,
  CommunicationTestTransport as CommunicationTestTransportTag,
} from "./contract.ts"
import { UnsupportedCommunicationEvent } from "./errors.ts"
import { makeCommunicationService } from "./service.ts"

export interface CommunicationTestLayerOptions {
  readonly sender?: SenderIdentity
  readonly recipient?: RecipientMailbox
  readonly deliveryStatuses?: ReadonlyArray<"accepted" | "unknown">
}

const defaultSender: SenderIdentity = {
  senderId: "ritsei-system",
  address: "no-reply@example.com",
  displayName: "RITSEI",
}

const defaultRecipient: RecipientMailbox = {
  address: "supplier@example.com",
  displayName: "Supplier",
}

const now = () => new Date().toISOString()

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")

const renderHtmlNode = (node: EmailMessage["nodes"][number]): string =>
  EmailMessageNode.match(node, {
    heading: (node) => `<h${node.level}>${escapeHtml(node.text)}</h${node.level}>`,
    text: (node) => `<p>${escapeHtml(node.text)}</p>`,
    image: (node) => `<img src="${escapeHtml(node.assetId)}" alt="${escapeHtml(node.alt)}">`,
    button: (node) => `<a href="${escapeHtml(node.href)}">${escapeHtml(node.label)}</a>`,
    divider: () => "<hr>",
    spacer: (node) => `<div style="height:${node.heightPx}px"></div>`,
    key_value: (node) =>
      `<dl>${node.entries
        .map((entry) => `<dt>${escapeHtml(entry.label)}</dt><dd>${escapeHtml(entry.value)}</dd>`)
        .join("")}</dl>`,
    table: (node) =>
      `<table><thead><tr>${node.headers
        .map((header) => `<th>${escapeHtml(header)}</th>`)
        .join("")}</tr></thead><tbody>${node.rows
        .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
        .join("")}</tbody></table>`,
  })

const renderTextNode = (node: EmailMessage["nodes"][number]): string =>
  EmailMessageNode.match(node, {
    heading: (node) => `${"#".repeat(node.level)} ${node.text}`,
    text: (node) => node.text,
    image: (node) => `[${node.alt}]`,
    button: (node) => `${node.label}: ${node.href}`,
    divider: () => "---",
    spacer: () => "",
    key_value: (node) => node.entries.map((entry) => `${entry.label}: ${entry.value}`).join("\n"),
    table: (node) =>
      [node.headers.join(" | ")].concat(node.rows.map((row) => row.join(" | "))).join("\n"),
  })

const sha256Hex = (value: string) =>
  Effect.tryPromise({
    try: async () => {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
      return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
    },
    catch: (cause) =>
      new CommunicationRenderFailure({ reason: "email content hashing failed", cause }),
  })

export const makeCommunicationTestLayer = (options: CommunicationTestLayerOptions = {}) => {
  const sender = options.sender ?? defaultSender
  const recipient = options.recipient ?? defaultRecipient
  const statuses = options.deliveryStatuses ?? ["accepted"]
  const sent: PreparedEmail[] = []
  let deliveryIndex = 0

  const policy: CommunicationPolicy = {
    derivePurchaseOrderConfirmed: Effect.fn(
      "CommunicationPolicy.test.derivePurchaseOrderConfirmed",
    )(function* (input: Schema.Codec.Encoded<typeof EventEnvelope>) {
      const event = yield* Schema.decodeUnknownEffect(EventEnvelope)(input)
      if (
        event.eventType !== ProcurementPurchaseOrderConfirmedEvent.id ||
        event.eventVersion !== ProcurementPurchaseOrderConfirmedEvent.version
      ) {
        return yield* Effect.fail(
          new UnsupportedCommunicationEvent({
            eventType: event.eventType,
            eventVersion: event.eventVersion,
          }),
        )
      }
      return yield* createCommunicationIntent({
        tenantId: event.tenantId,
        intentType: "purchase-order-confirmed",
        subject: {
          owner: "procurement",
          type: "purchase_order",
          id: event.aggregateId,
        },
        sourceEvent: {
          eventId: event.eventId,
          eventType: event.eventType,
          eventVersion: event.eventVersion,
          occurredAt: event.occurredAt,
          correlationId: event.correlationId,
          causationId: event.causationId,
        },
        audience: {
          type: "supplier-order-contact",
          subject: {
            owner: "procurement",
            type: "purchase_order",
            id: event.aggregateId,
          },
        },
        channels: ["email"],
        priority: "normal",
        locale: "en-US",
        timezone: "UTC",
        idempotencyKey: event.idempotencyKey,
        correlationId: event.correlationId,
      })
    }),
  }

  const recipientResolver: CommunicationRecipientResolver = {
    resolve: Effect.fn("CommunicationRecipientResolver.test.resolve")(function* (
      input: Schema.Codec.Encoded<typeof CommunicationIntent>,
    ) {
      const intent = yield* Schema.decodeUnknownEffect(CommunicationIntent)(input)
      const snapshot: RecipientSnapshot = {
        audience: intent.audience,
        to: [recipient],
        cc: [],
        bcc: [],
        resolverId: "purchase-order-supplier-contact",
        resolverVersion: 1,
        resolvedAt: now(),
      }
      return snapshot
    }),
  }

  const contextBuilder: CommunicationContextBuilder = {
    build: Effect.fn("CommunicationContextBuilder.test.build")(function* (
      input: Schema.Codec.Encoded<typeof CommunicationContextInput>,
    ) {
      const decoded = yield* Schema.decodeUnknownEffect(CommunicationContextInput)(input)
      const context: CommunicationContext = {
        contextType: "purchase-order-confirmed-context",
        contextVersion: 1,
        tenantId: decoded.intent.tenantId,
        communicationId: decoded.intent.communicationId,
        locale: decoded.intent.locale ?? "en-US",
        timezone: decoded.intent.timezone ?? "UTC",
        data: decoded.data,
      }
      return context
    }),
  }

  const renderer: EmailRenderer = {
    render: Effect.fn("EmailRenderer.test.render")(function* (
      input: Schema.Codec.Encoded<typeof EmailRenderInput>,
    ) {
      const decoded = yield* Schema.decodeUnknownEffect(EmailRenderInput)(input)
      const html = decoded.message.nodes.map(renderHtmlNode).join("")
      const text = decoded.message.nodes.map(renderTextNode).filter(Boolean).join("\n\n")
      const artifact: CommunicationArtifact = {
        artifactId: uuidv7(),
        communicationId: decoded.intent.communicationId,
        tenantId: decoded.intent.tenantId,
        channel: "email",
        template: decoded.template,
        subject: decoded.message.subject,
        html,
        text,
        htmlHash: yield* sha256Hex(html),
        textHash: yield* sha256Hex(text),
        attachments: decoded.message.attachments,
        rendererVersion: "email-ast-test@1",
        createdAt: now(),
      }
      return artifact
    }),
  }

  const transport: EmailTransport = {
    send: Effect.fn("EmailTransport.test.send")(function* (
      input: Schema.Codec.Encoded<typeof PreparedEmail>,
    ) {
      const prepared = yield* Schema.decodeUnknownEffect(PreparedEmail)(input)
      sent.push(prepared)
      const status = statuses[Math.min(deliveryIndex, statuses.length - 1)] ?? "accepted"
      deliveryIndex += 1
      return {
        communicationId: prepared.communicationId,
        attemptId: uuidv7(),
        providerId: "test-transport",
        status,
        providerMessageId: status === "accepted" ? `test-message-${deliveryIndex}` : null,
        observedAt: now(),
      }
    }),
  }

  const dependencies = Layer.mergeAll(
    Layer.succeed(CommunicationConfiguration, { sender }),
    Layer.succeed(CommunicationPolicy, policy),
    Layer.succeed(CommunicationRecipientResolver, recipientResolver),
    Layer.succeed(CommunicationContextBuilder, contextBuilder),
    Layer.succeed(EmailRenderer, renderer),
    Layer.succeed(EmailTransport, transport),
    Layer.succeed(CommunicationTestTransportTag, { sent }),
  )
  const service = Layer.effect(CommunicationService, makeCommunicationService).pipe(
    Layer.provide(dependencies),
  )
  return Layer.merge(dependencies, service)
}
