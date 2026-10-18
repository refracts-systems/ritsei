import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import type { ExternalActionCatalogEntry, ExternalEventCatalogEntry } from "./contract.ts"
import {
  ExternalConnectorNotReviewed,
  ExternalConnectorRetired,
  ExternalConnectorVersionConflict,
  ExternalPayloadInvalid,
} from "./errors.ts"

const NonEmptyString = Schema.String.check(Schema.isPattern(/\S/))

export const ExternalConnectorStatus = Schema.Literals([
  "draft",
  "reviewed",
  "active",
  "retired",
])
export const ExternalDeliveryControlKind = Schema.Literals([
  "retry",
  "redeliver",
  "quarantine",
])

export type ExternalConnectorDefinition = {
  readonly connectorId: string
  readonly version: number
  readonly status: Schema.Schema.Type<typeof ExternalConnectorStatus>
  readonly owner: string
  readonly compatibilityRange: {
    readonly minimumVersion: number
    readonly maximumVersion: number
  }
  readonly actions: readonly ExternalActionCatalogEntry[]
  readonly events: readonly ExternalEventCatalogEntry[]
  readonly reviewedBy?: string
  readonly reviewedAt?: string
}

export type ExternalDeliveryControl = {
  readonly kind: Schema.Schema.Type<typeof ExternalDeliveryControlKind>
  readonly operationId: string
  readonly reason: string
}

// reviewed connector state is explicit and never inferred from provider configuration.
export const reviewExternalConnector = (
  connector: ExternalConnectorDefinition,
  reviewer: string,
  reviewedAt: string,
): Effect.Effect<ExternalConnectorDefinition, ExternalPayloadInvalid> => {
  if (!Schema.is(NonEmptyString)(reviewer) || !Schema.is(NonEmptyString)(reviewedAt)) {
    return Effect.fail(
      new ExternalPayloadInvalid({
        boundary: "integration.connector.review",
        identifier: connector.connectorId,
      }),
    )
  }
  return Effect.succeed({
    ...connector,
    status: "reviewed",
    reviewedBy: reviewer,
    reviewedAt,
  })
}

export const activateExternalConnector = (
  connector: ExternalConnectorDefinition,
): Effect.Effect<ExternalConnectorDefinition, ExternalConnectorNotReviewed> =>
  connector.status === "reviewed"
    ? Effect.succeed({ ...connector, status: "active" })
    : Effect.fail(
      new ExternalConnectorNotReviewed({
        connectorId: connector.connectorId,
        version: connector.version,
      }),
    )

// connector retirement is terminal for new invocations while preserving history and controls.
export const retireExternalConnector = (
  connector: ExternalConnectorDefinition,
): ExternalConnectorDefinition => ({ ...connector, status: "retired" })

export const validateExternalOperation = (
  connector: ExternalConnectorDefinition,
  action: ExternalActionCatalogEntry,
): Effect.Effect<
  ExternalActionCatalogEntry,
  | ExternalConnectorNotReviewed
  | ExternalConnectorRetired
  | ExternalConnectorVersionConflict
> => {
  if (connector.status === "retired") {
    return Effect.fail(
      new ExternalConnectorRetired({
        connectorId: connector.connectorId,
        version: connector.version,
      }),
    )
  }
  if (connector.status !== "active") {
    return Effect.fail(
      new ExternalConnectorNotReviewed({
        connectorId: connector.connectorId,
        version: connector.version,
      }),
    )
  }
  if (
    action.connectorId !== connector.connectorId
    || action.version < connector.compatibilityRange.minimumVersion
    || action.version > connector.compatibilityRange.maximumVersion
  ) {
    return Effect.fail(
      new ExternalConnectorVersionConflict({
        connectorId: connector.connectorId,
        connectorVersion: connector.version,
        operationVersion: action.version,
      }),
    )
  }
  return Effect.succeed(action)
}

// delivery controls are explicit operator commands, separate from connector lifecycle.
export const makeDeliveryControl = (
  control: ExternalDeliveryControl,
): Effect.Effect<ExternalDeliveryControl, ExternalPayloadInvalid> => {
  if (
    !Schema.is(ExternalDeliveryControlKind)(control.kind)
    || !Schema.is(NonEmptyString)(control.operationId)
    || !Schema.is(NonEmptyString)(control.reason)
  ) {
    return Effect.fail(
      new ExternalPayloadInvalid({
        boundary: "integration.delivery.control",
        identifier: control.operationId || "delivery-control",
      }),
    )
  }
  return Effect.succeed(control)
}
