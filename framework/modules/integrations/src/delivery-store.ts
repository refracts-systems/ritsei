import * as Effect from "effect/Effect"

export type ExternalDeliveryStatus =
  | "received"
  | "accepted"
  | "duplicate"
  | "unknown_outcome"
  | "manual_recovery"

export type ExternalDeliveryLog = {
  readonly tenantId: string
  readonly connectorId: string
  readonly source: string
  readonly providerEventId: string
  readonly status: ExternalDeliveryStatus
  readonly correlationId: string
}

export type ExternalDeliveryStore = {
  readonly get: (
    tenantId: string,
    source: string,
    providerEventId: string,
  ) => Effect.Effect<ExternalDeliveryLog | undefined>
  readonly put: (entry: ExternalDeliveryLog) => Effect.Effect<void>
}

// The delivery log preserves duplicate, unknown outcome, and manual recovery states.
export const makeMemoryExternalDeliveryStore = (): ExternalDeliveryStore => {
  const entries = new Map<string, ExternalDeliveryLog>()
  const key = (tenantId: string, source: string, providerEventId: string) =>
    `${tenantId}:${source}:${providerEventId}`
  return {
    get: (tenantId, source, providerEventId) =>
      Effect.succeed(entries.get(key(tenantId, source, providerEventId))),
    put: (entry) => {
      entries.set(key(entry.tenantId, entry.source, entry.providerEventId), entry)
      return Effect.succeed(undefined)
    },
  }
}
