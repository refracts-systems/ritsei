import * as Effect from "effect/Effect"

export type ExternalInvocationStatus = "accepted" | "unknown"

export type ExternalInvocationReceipt = {
  readonly tenantId: string
  readonly actionId: string
  readonly actionVersion: number
  readonly idempotencyKey: string
  readonly status: ExternalInvocationStatus
  readonly output?: unknown
}

export type ExternalEventReceipt = {
  readonly tenantId: string
  readonly eventType: string
  readonly eventVersion: number
  readonly source: string
  readonly providerEventId: string
  readonly payload: unknown
}

export type ExternalConnectorStore = {
  readonly getInvocation: (
    tenantId: string,
    idempotencyKey: string,
  ) => Effect.Effect<ExternalInvocationReceipt | undefined, never, never>
  readonly putInvocation: (receipt: ExternalInvocationReceipt) => Effect.Effect<void, never, never>
  readonly getEvent: (
    tenantId: string,
    source: string,
    providerEventId: string,
  ) => Effect.Effect<ExternalEventReceipt | undefined, never, never>
  readonly putEvent: (receipt: ExternalEventReceipt) => Effect.Effect<void, never, never>
}

export const makeMemoryExternalConnectorStore = (): ExternalConnectorStore => {
  const invocations = new Map<string, ExternalInvocationReceipt>()
  const events = new Map<string, ExternalEventReceipt>()

  const invocationKey = (tenantId: string, idempotencyKey: string) =>
    `${tenantId}:${idempotencyKey}`

  const eventKey = (tenantId: string, source: string, providerEventId: string) =>
    `${tenantId}:${source}:${providerEventId}`

  return {
    getInvocation: (tenantId, idempotencyKey) =>
      Effect.succeed(invocations.get(invocationKey(tenantId, idempotencyKey))),
    putInvocation: (receipt) => {
      invocations.set(invocationKey(receipt.tenantId, receipt.idempotencyKey), receipt)

      return Effect.succeed(undefined)
    },
    getEvent: (tenantId, source, providerEventId) =>
      Effect.succeed(events.get(eventKey(tenantId, source, providerEventId))),
    putEvent: (receipt) => {
      events.set(eventKey(receipt.tenantId, receipt.source, receipt.providerEventId), receipt)

      return Effect.succeed(undefined)
    },
  }
}
