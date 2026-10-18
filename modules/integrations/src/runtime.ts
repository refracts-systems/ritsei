import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"

import { CloudEventsEnvelope } from "./cloudevents.ts"
import {
  type ExternalActionCatalogEntry,
  ExternalCatalogLimits,
  type ExternalEventCatalogEntry,
  isAllowlistedExternalAction,
  validateExternalActionDefinition,
  validateExternalEventDefinition,
} from "./contract.ts"
import {
  ExternalActionNotAllowlisted,
  ExternalAuthorizationDenied,
  ExternalIdempotencyConflict,
  ExternalPayloadInvalid,
  ExternalProviderFailure,
  ExternalUnknownOutcome,
} from "./errors.ts"
import { decodeExternalSchema } from "./schema.ts"
import {
  type ExternalConnectorStore,
  type ExternalEventReceipt,
  type ExternalInvocationReceipt,
  makeMemoryExternalConnectorStore,
} from "./store.ts"

const Uuid = Schema.String.check(Schema.isUUID())
const BoundedNonEmptyString = Schema.String.check(
  Schema.isPattern(/\S/),
  Schema.isMaxLength(ExternalCatalogLimits.maxIdentifierLength),
)

export const WebhookIngestion = CloudEventsEnvelope

export type ExternalActionInvoker = (input: {
  readonly tenantId: string
  readonly action: ExternalActionCatalogEntry
  readonly idempotencyKey: string
  readonly input: unknown
}) => Effect.Effect<unknown, ExternalProviderFailure | ExternalUnknownOutcome, never>

export type ExternalScopeAuthorizer = (input: {
  readonly tenantId: string
  readonly requiredScope: string
}) => Effect.Effect<void, ExternalAuthorizationDenied, never>

export type InvokeExternalActionInput = {
  readonly tenantId: string
  readonly action: ExternalActionCatalogEntry
  readonly idempotencyKey: string
  readonly input: unknown
}

export type IngestExternalEventInput = {
  readonly tenantId: string
  readonly event: ExternalEventCatalogEntry
  readonly envelope: unknown
}

export type ExternalEventIngestionResult = {
  readonly duplicate: boolean
  readonly eventId: string
  readonly eventType: string
  readonly eventVersion: number
  readonly payload: unknown
}

export type ExternalConnectorRuntime = {
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
  readonly ingestEvent: (
    input: IngestExternalEventInput,
  ) => Effect.Effect<ExternalEventIngestionResult, ExternalPayloadInvalid>
}

export const ExternalWebhookEnvelope = WebhookIngestion

const catalogIdentifier = (
  value: { readonly id?: unknown } | null | undefined,
  fallback: string,
): string => {
  const id = typeof value?.id === "string" && value.id.trim() !== "" ? value.id : undefined
  return id === undefined ? fallback : id.slice(0, ExternalCatalogLimits.maxIdentifierLength)
}

const validateTenant = (tenantId: string): boolean => Schema.is(Uuid)(tenantId)
const validateNonEmpty = (value: string): boolean => Schema.is(BoundedNonEmptyString)(value)

const isValidActionInvocation = (input: InvokeExternalActionInput): boolean =>
  [
    validateExternalActionDefinition(input.action),
    validateTenant(input.tenantId),
    validateNonEmpty(input.idempotencyKey),
  ].every(Boolean)

const isValidEventRegistration = (input: IngestExternalEventInput): boolean =>
  [
    validateExternalEventDefinition(input.event),
    validateTenant(input.tenantId),
  ].every(Boolean)

export const makeExternalConnectorRuntime = (options: {
  readonly store?: ExternalConnectorStore
  readonly authorizeScope: ExternalScopeAuthorizer
  readonly invoke: ExternalActionInvoker
}): ExternalConnectorRuntime => {
  const store = options.store ?? makeMemoryExternalConnectorStore()

  // bounded retry stops at the catalog's declared maxAttempts.
  const invokeWithBoundedRetry = (
    input: InvokeExternalActionInput,
    attempt: number,
  ): Effect.Effect<unknown, ExternalProviderFailure | ExternalUnknownOutcome> =>
    Effect.timeoutOrElse(options.invoke(input), {
      duration: input.action.timeoutPolicy.timeoutMs,
      orElse: () =>
        Effect.fail(
          new ExternalProviderFailure({
            tenantId: input.tenantId,
            actionId: input.action.id,
            operationId: input.action.operationId,
            reason: "timeout",
            retryable: true,
          }),
        ),
    }).pipe(
      Effect.result,
      Effect.flatMap((result) => {
        if (Result.isSuccess(result)) return Effect.succeed(result.success)
        if (
          result.failure instanceof ExternalProviderFailure
          && result.failure.retryable
          && attempt < input.action.retryPolicy.maxAttempts
        ) {
          return invokeWithBoundedRetry(input, attempt + 1)
        }
        return Effect.fail(result.failure)
      }),
    )

  const invokeAction: ExternalConnectorRuntime["invokeAction"] = (input) =>
    Effect.gen(function*() {
      const identifier = catalogIdentifier(input.action, "external-action")
      if (!isValidActionInvocation(input)) {
        return yield* Effect.fail(
          new ExternalPayloadInvalid({
            boundary: "external.action.invocation",
            identifier,
          }),
        )
      }
      if (!isAllowlistedExternalAction(input.action) || input.action.stability !== "PUBLIC") {
        return yield* Effect.fail(
          new ExternalActionNotAllowlisted({
            tenantId: input.tenantId,
            actionId: input.action.id,
          }),
        )
      }

      yield* options.authorizeScope({
        tenantId: input.tenantId,
        requiredScope: input.action.requiredScope,
      })
      const decodedInput = yield* decodeExternalSchema(input.action.inputSchema, input.input)
        .pipe(
          Effect.mapError(() =>
            new ExternalPayloadInvalid({
              boundary: "external.action.input",
              identifier: input.action.id,
            })
          ),
        )
      const existing = yield* store.getInvocation(input.tenantId, input.idempotencyKey)
      if (existing !== undefined) {
        if (
          existing.actionId !== input.action.id
          || existing.actionVersion !== input.action.version
        ) {
          return yield* Effect.fail(
            new ExternalIdempotencyConflict({
              tenantId: input.tenantId,
              idempotencyKey: input.idempotencyKey,
            }),
          )
        }
        if (existing.status === "unknown") {
          return yield* Effect.fail(
            new ExternalUnknownOutcome({
              tenantId: input.tenantId,
              actionId: input.action.id,
              idempotencyKey: input.idempotencyKey,
            }),
          )
        }
        return existing.output
      }

      const output = yield* invokeWithBoundedRetry({ ...input, input: decodedInput }, 1).pipe(
        Effect.tapError((error) =>
          error instanceof ExternalUnknownOutcome
            ? store.putInvocation({
              tenantId: input.tenantId,
              actionId: input.action.id,
              actionVersion: input.action.version,
              idempotencyKey: input.idempotencyKey,
              status: "unknown",
            })
            : Effect.succeed(undefined)
        ),
      )
      const decodedOutput = yield* decodeExternalSchema(input.action.outputSchema, output)
        .pipe(
          Effect.mapError(() =>
            new ExternalPayloadInvalid({
              boundary: "external.action.output",
              identifier: input.action.id,
            })
          ),
        )
      yield* store.putInvocation({
        tenantId: input.tenantId,
        actionId: input.action.id,
        actionVersion: input.action.version,
        idempotencyKey: input.idempotencyKey,
        status: "accepted",
        output: decodedOutput,
      })
      return decodedOutput
    })

  const deduplicateEvent = (
    tenantId: string,
    source: string,
    providerEventId: string,
  ) => store.getEvent(tenantId, source, providerEventId)

  const ingestEvent: ExternalConnectorRuntime["ingestEvent"] = (input) =>
    Effect.gen(function*() {
      const identifier = catalogIdentifier(input.event, "external-event")
      if (!isValidEventRegistration(input) || input.event.stability !== "PUBLIC") {
        return yield* Effect.fail(
          new ExternalPayloadInvalid({
            boundary: "external.event.registration",
            identifier,
          }),
        )
      }
      const envelope = yield* Schema.decodeUnknownEffect(WebhookIngestion)(input.envelope).pipe(
        Effect.mapError(() =>
          new ExternalPayloadInvalid({
            boundary: "external.event.envelope",
            identifier: input.event.id,
          })
        ),
      )
      if (envelope.type !== input.event.id) {
        return yield* Effect.fail(
          new ExternalPayloadInvalid({
            boundary: "external.event.type",
            identifier: input.event.id,
          }),
        )
      }
      if (envelope.source !== input.event.source) {
        return yield* Effect.fail(
          new ExternalPayloadInvalid({
            boundary: "external.event.source",
            identifier: input.event.id,
          }),
        )
      }
      const payload = yield* decodeExternalSchema(input.event.payloadSchema, envelope.data)
        .pipe(
          Effect.mapError(() =>
            new ExternalPayloadInvalid({
              boundary: "external.event.payload",
              identifier: input.event.id,
            })
          ),
        )
      const existing = yield* deduplicateEvent(input.tenantId, envelope.source, envelope.id)
      if (existing !== undefined) {
        return {
          duplicate: true,
          eventId: existing.providerEventId,
          eventType: existing.eventType,
          eventVersion: existing.eventVersion,
          payload: existing.payload,
        }
      }
      const receipt: ExternalEventReceipt = {
        tenantId: input.tenantId,
        eventType: input.event.id,
        eventVersion: input.event.version,
        source: envelope.source,
        providerEventId: envelope.id,
        payload,
      }
      yield* store.putEvent(receipt)
      return {
        duplicate: false,
        eventId: envelope.id,
        eventType: input.event.id,
        eventVersion: input.event.version,
        payload,
      }
    })

  return { invokeAction, ingestEvent }
}

export { makeMemoryExternalConnectorStore }
export type { ExternalConnectorStore, ExternalEventReceipt, ExternalInvocationReceipt }
