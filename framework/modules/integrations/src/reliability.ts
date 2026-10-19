import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { ExternalCompatibilityMismatch, ExternalPayloadLimitExceeded } from "./errors.ts"

// provider status is normalized before it reaches Process Studio.
export const ExternalProviderStatus = Schema.Literals([
  "pending",
  "accepted",
  "rejected",
  "unknown",
])

export const ExternalDeliveryState = Schema.Literals(["accepted", "retry", "dead_letter"])

export type ExternalReliabilityInput = {
  readonly connectorId: string
  readonly connectorVersion: number
  readonly operationId: string
  readonly providerStatus: Schema.Schema.Type<typeof ExternalProviderStatus>
  readonly attempts: number
  readonly maxAttempts: number
  readonly maxPayloadBytes: number
  readonly payload: unknown
  readonly sentAtMs: number
  readonly observedAtMs: number
  readonly compatibilityRange: {
    readonly minimumVersion: number
    readonly maximumVersion: number
  }
}

export type ExternalReliabilityDecision = {
  readonly state: Schema.Schema.Type<typeof ExternalDeliveryState>
  readonly connectorId: string
  readonly operationId: string
  readonly providerStatus: Schema.Schema.Type<typeof ExternalProviderStatus>
  readonly attempts: number
  readonly lagMs: number
  readonly payload: unknown
}

const sensitiveField = (key: string): boolean =>
  ["authorization", "client_secret", "password", "secret", "token"].some((part) =>
    key.toLowerCase().includes(part),
  )

// redaction removes credentials before a delivery record is exposed or retained.
export const redactExternalPayload = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redactExternalPayload)
  if (typeof value !== "object" || value === null) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      sensitiveField(key) ? "[REDACTED]" : redactExternalPayload(child),
    ]),
  )
}

export const assessExternalDelivery = (
  input: ExternalReliabilityInput,
): Effect.Effect<
  ExternalReliabilityDecision,
  ExternalCompatibilityMismatch | ExternalPayloadLimitExceeded
> => {
  if (
    input.connectorVersion < input.compatibilityRange.minimumVersion ||
    input.connectorVersion > input.compatibilityRange.maximumVersion
  ) {
    return Effect.fail(
      new ExternalCompatibilityMismatch({
        connectorId: input.connectorId,
        connectorVersion: input.connectorVersion,
        minimumVersion: input.compatibilityRange.minimumVersion,
        maximumVersion: input.compatibilityRange.maximumVersion,
      }),
    )
  }

  const encoded = JSON.stringify(input.payload)
  const actualPayloadBytes =
    encoded === undefined ? Number.POSITIVE_INFINITY : new TextEncoder().encode(encoded).byteLength
  if (actualPayloadBytes > input.maxPayloadBytes) {
    return Effect.fail(
      new ExternalPayloadLimitExceeded({
        connectorId: input.connectorId,
        operationId: input.operationId,
        maxPayloadBytes: input.maxPayloadBytes,
        actualPayloadBytes,
      }),
    )
  }

  // dead letter policy is selected after the provider status and bounded attempts are known.
  const state =
    input.providerStatus === "accepted"
      ? "accepted"
      : input.attempts >= input.maxAttempts
        ? "dead_letter"
        : "retry"
  return Effect.succeed({
    state,
    connectorId: input.connectorId,
    operationId: input.operationId,
    providerStatus: input.providerStatus,
    attempts: input.attempts,
    lagMs: Math.max(0, input.observedAtMs - input.sentAtMs),
    payload: redactExternalPayload(input.payload),
  })
}
