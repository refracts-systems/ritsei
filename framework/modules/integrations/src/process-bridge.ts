import type * as Schema from "effect/Schema"
import * as Effect from "effect/Effect"

import {
  type ExternalCatalogEntry,
  type ExternalSimulationResult,
  simulateWithoutSideEffect,
} from "./catalog.ts"
import { type ExternalActionCatalogEntry, type ExternalEventCatalogEntry } from "./contract.ts"
import { ExternalActionNotAllowlisted, ExternalPayloadInvalid } from "./errors.ts"

export type { ExternalCatalogEntry }

export type ProcessExternalAction = Pick<
  ExternalActionCatalogEntry,
  | "kind"
  | "id"
  | "version"
  | "connectorId"
  | "operationId"
  | "stability"
  | "compatibilityRange"
  | "requiredScope"
  | "idempotencyStrategy"
  | "timeoutPolicy"
  | "retryPolicy"
  | "compensation"
  | "allowlisted"
>

export type ProcessExternalEvent = Pick<
  ExternalEventCatalogEntry,
  | "kind"
  | "id"
  | "version"
  | "connectorId"
  | "source"
  | "stability"
  | "compatibilityRange"
  | "scope"
  | "correlationFields"
  | "filterableFields"
  | "deduplicationKey"
  | "occurredAtSemantics"
>

export type ProcessExternalCatalogEntry = ProcessExternalAction | ProcessExternalEvent

export type ExternalProcessActionMapping = {
  readonly actionId: string
  readonly actionVersion: number
  readonly input: unknown
}

export type ProcessExternalSimulationResult = ExternalSimulationResult & {
  readonly catalog: ProcessExternalAction
}

// Process IR carries typed catalog references; transport absent from Process IR.
export const toProcessExternalCatalogEntry = (
  entry: ExternalCatalogEntry,
): ProcessExternalCatalogEntry | undefined => {
  if (entry.stability !== "PUBLIC") return undefined
  if (entry.kind === "ExternalAction" && !entry.allowlisted) return undefined
  if (entry.kind === "ExternalAction") {
    return {
      kind: entry.kind,
      id: entry.id,
      version: entry.version,
      connectorId: entry.connectorId,
      operationId: entry.operationId,
      stability: entry.stability,
      compatibilityRange: entry.compatibilityRange,
      requiredScope: entry.requiredScope,
      idempotencyStrategy: entry.idempotencyStrategy,
      timeoutPolicy: entry.timeoutPolicy,
      retryPolicy: entry.retryPolicy,
      compensation: entry.compensation,
      allowlisted: entry.allowlisted,
    }
  }
  return {
    kind: entry.kind,
    id: entry.id,
    version: entry.version,
    connectorId: entry.connectorId,
    source: entry.source,
    stability: entry.stability,
    compatibilityRange: entry.compatibilityRange,
    scope: entry.scope,
    correlationFields: entry.correlationFields,
    filterableFields: entry.filterableFields,
    deduplicationKey: entry.deduplicationKey,
    occurredAtSemantics: entry.occurredAtSemantics,
  }
}

export const makeExternalProcessActionMapping = (
  action: ExternalActionCatalogEntry,
  input: Schema.Json,
): ExternalProcessActionMapping => ({
  actionId: action.id,
  actionVersion: action.version,
  input,
})

export const simulateProcessExternalAction = (input: {
  readonly tenantId: string
  readonly action: ExternalActionCatalogEntry
  readonly input: unknown
}): Effect.Effect<
  ProcessExternalSimulationResult,
  ExternalActionNotAllowlisted | ExternalPayloadInvalid
> =>
  Effect.gen(function* () {
    const catalog = toProcessExternalCatalogEntry(input.action)
    if (catalog === undefined || catalog.kind !== "ExternalAction") {
      return yield* Effect.fail(
        new ExternalActionNotAllowlisted({
          tenantId: input.tenantId,
          actionId: input.action.id,
        }),
      )
    }
    const result = yield* simulateWithoutSideEffect(input)
    return { ...result, catalog }
  })
