import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Predicate from "effect/Predicate"

import { validateExternalEventDefinition } from "./contract.ts"
import { type ExternalDeliveryStore, makeMemoryExternalDeliveryStore } from "./delivery-store.ts"
import {
  type ExternalActionNotAllowlisted,
  type ExternalAuthorizationDenied,
  type ExternalIdempotencyConflict,
  ExternalPayloadInvalid,
  type ExternalProviderFailure,
  type ExternalUnknownOutcome,
} from "./errors.ts"
import {
  type ExternalActionInvoker,
  type ExternalConnectorRuntime,
  type ExternalConnectorStore,
  type ExternalEventIngestionResult,
  type ExternalScopeAuthorizer,
  type IngestExternalEventInput,
  type InvokeExternalActionInput,
  makeExternalConnectorRuntime,
  WebhookIngestion,
} from "./runtime.ts"

const Uuid = Schema.String.check(Schema.isUUID())
const NonEmptyString = Schema.String.check(Schema.isPattern(/\S/))
const byteLength = (value: string) => new TextEncoder().encode(value).byteLength

export const HttpsWebhookLimits = {
  maxBodyBytes: 1_048_576,
  maxSignatureLength: 4_096,
  maxCorrelationIdLength: 256,
  verifierTimeoutMs: 5_000,
} as const

const eventIdentifier = (event: { readonly id?: unknown } | null | undefined): string => {
  const id = Predicate.isString(event?.id) && event.id.trim() !== "" ? event.id : undefined

  return id === undefined ? "external-event" : id.slice(0, 256)
}

const isBoundedNonEmptyString = (value: unknown, maxBytes: number): value is string =>
  Predicate.isString(value) && Schema.is(NonEmptyString)(value) && byteLength(value) <= maxBytes

const decodeWebhookBody = (body: string, identifier: string) =>
  Effect.try({
    try: () => JSON.parse(body),
    catch: () => undefined,
  }).pipe(
    Effect.flatMap((value) => Schema.decodeUnknownEffect(WebhookIngestion)(value)),
    Effect.mapError(
      () =>
        new ExternalPayloadInvalid({
          boundary: "external.https.webhook.body",
          identifier,
        }),
    ),
  )

type WebhookEnvelope = Schema.Schema.Type<typeof WebhookIngestion>

const sameWebhookEnvelope = (left: WebhookEnvelope, right: WebhookEnvelope): boolean =>
  left.specversion === right.specversion &&
  left.type === right.type &&
  left.source === right.source &&
  left.id === right.id &&
  left.time === right.time &&
  left.datacontenttype === right.datacontenttype &&
  left.subject === right.subject &&
  JSON.stringify(left.data) === JSON.stringify(right.data)

export type HttpsSignatureVerifier = (input: {
  readonly tenantId: string
  readonly body: string
  readonly signature: string
}) => Effect.Effect<boolean, ExternalPayloadInvalid>

export type HttpsWebhookInput = IngestExternalEventInput & {
  readonly body: string
  readonly signature: string
  readonly correlationId: string
}

const isValidWebhookInput = (input: HttpsWebhookInput): boolean =>
  [
    validateExternalEventDefinition(input.event),
    Schema.is(Uuid)(input.tenantId),
    isBoundedNonEmptyString(input.body, HttpsWebhookLimits.maxBodyBytes),
    isBoundedNonEmptyString(input.signature, HttpsWebhookLimits.maxSignatureLength),
    isBoundedNonEmptyString(input.correlationId, HttpsWebhookLimits.maxCorrelationIdLength),
  ].every(Boolean)

export type HttpsConnectorRuntime = {
  readonly invokeAction: (
    input: InvokeExternalActionInput,
  ) => Effect.Effect<
    unknown,
    | ExternalActionNotAllowlisted
    | ExternalAuthorizationDenied
    | ExternalIdempotencyConflict
    | ExternalPayloadInvalid
    | ExternalProviderFailure
    | ExternalUnknownOutcome
  >
  readonly ingestWebhook: (
    input: HttpsWebhookInput,
  ) => Effect.Effect<ExternalEventIngestionResult, ExternalPayloadInvalid>
}

// HTTPS action invocation stays outside PostgreSQL transactions and uses the existing typed runtime.
export const makeHttpsConnectorRuntime = (options: {
  readonly store?: ExternalConnectorStore
  readonly deliveryStore?: ExternalDeliveryStore
  readonly authorizeScope: ExternalScopeAuthorizer
  readonly invoke: ExternalActionInvoker
  readonly verifySignature: HttpsSignatureVerifier
}): HttpsConnectorRuntime => {
  const deliveryStore = options.deliveryStore ?? makeMemoryExternalDeliveryStore()

  const runtime: ExternalConnectorRuntime = makeExternalConnectorRuntime({
    store: options.store,
    authorizeScope: options.authorizeScope,
    invoke: options.invoke,
  })

  const ingestWebhook = (input: HttpsWebhookInput) =>
    Effect.gen(function* () {
      const identifier = eventIdentifier(input.event)

      if (!isValidWebhookInput(input)) {
        return yield* Effect.fail(
          new ExternalPayloadInvalid({
            boundary: "external.https.webhook.input",
            identifier,
          }),
        )
      }

      // verify signature on the raw body before parsing; deduplicate only after verification.
      const verified = yield* Effect.timeoutOrElse(
        options.verifySignature({
          tenantId: input.tenantId,
          body: input.body,
          signature: input.signature,
        }),
        {
          duration: HttpsWebhookLimits.verifierTimeoutMs,
          orElse: () =>
            Effect.fail(
              new ExternalPayloadInvalid({
                boundary: "external.https.webhook.verifier-timeout",
                identifier,
              }),
            ),
        },
      )

      if (!verified) {
        return yield* Effect.fail(
          new ExternalPayloadInvalid({
            boundary: "external.https.webhook.signature",
            identifier,
          }),
        )
      }

      const envelope = yield* decodeWebhookBody(input.body, identifier)

      const suppliedEnvelope = yield* Schema.decodeUnknownEffect(WebhookIngestion)(
        input.envelope,
      ).pipe(
        Effect.mapError(
          () =>
            new ExternalPayloadInvalid({
              boundary: "external.https.webhook.envelope",
              identifier,
            }),
        ),
      )

      if (!sameWebhookEnvelope(envelope, suppliedEnvelope)) {
        return yield* Effect.fail(
          new ExternalPayloadInvalid({
            boundary: "external.https.webhook.body-envelope-mismatch",
            identifier,
          }),
        )
      }

      const result = yield* runtime.ingestEvent({
        tenantId: input.tenantId,
        event: input.event,
        envelope,
      })

      yield* deliveryStore.put({
        tenantId: input.tenantId,
        connectorId: input.event.connectorId,
        source: envelope.source,
        providerEventId: envelope.id,
        status: result.duplicate ? "duplicate" : "accepted",
        correlationId: input.correlationId,
      })

      return result
    })

  return { invokeAction: runtime.invokeAction, ingestWebhook }
}
