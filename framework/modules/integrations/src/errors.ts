import * as Schema from "effect/Schema"

const Uuid = Schema.String.check(Schema.isUUID())
const NonEmptyString = Schema.String.check(Schema.isPattern(/\S/))
const ProviderFailureReason = Schema.Literals(["timeout", "unavailable", "rejected"])

export class ExternalActionNotAllowlisted extends Schema.TaggedError<ExternalActionNotAllowlisted>()(
  "ExternalActionNotAllowlisted",
  {
    tenantId: Uuid,
    actionId: NonEmptyString,
  },
) {}

export class ExternalAuthorizationDenied extends Schema.TaggedError<ExternalAuthorizationDenied>()(
  "ExternalAuthorizationDenied",
  {
    tenantId: Uuid,
    requiredScope: NonEmptyString,
  },
) {}

export class ExternalIdempotencyConflict extends Schema.TaggedError<ExternalIdempotencyConflict>()(
  "ExternalIdempotencyConflict",
  {
    tenantId: Uuid,
    idempotencyKey: NonEmptyString,
  },
) {}

export class ExternalPayloadInvalid extends Schema.TaggedError<ExternalPayloadInvalid>()(
  "ExternalPayloadInvalid",
  {
    boundary: NonEmptyString,
    identifier: NonEmptyString,
  },
) {}

export class ExternalProviderFailure extends Schema.TaggedError<ExternalProviderFailure>()(
  "ExternalProviderFailure",
  {
    tenantId: Uuid,
    actionId: NonEmptyString,
    operationId: NonEmptyString,
    reason: ProviderFailureReason,
    retryable: Schema.Boolean,
  },
) {}

export class ExternalUnknownOutcome extends Schema.TaggedError<ExternalUnknownOutcome>()(
  "ExternalUnknownOutcome",
  {
    tenantId: Uuid,
    actionId: NonEmptyString,
    idempotencyKey: NonEmptyString,
  },
) {}

const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))
const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export class ExternalCompatibilityMismatch extends Schema.TaggedError<ExternalCompatibilityMismatch>()(
  "ExternalCompatibilityMismatch",
  {
    connectorId: NonEmptyString,
    connectorVersion: PositiveInt,
    minimumVersion: PositiveInt,
    maximumVersion: PositiveInt,
  },
) {}

export class ExternalPayloadLimitExceeded extends Schema.TaggedError<ExternalPayloadLimitExceeded>()(
  "ExternalPayloadLimitExceeded",
  {
    connectorId: NonEmptyString,
    operationId: NonEmptyString,
    maxPayloadBytes: PositiveInt,
    actualPayloadBytes: NonNegativeInt,
  },
) {}

export class ExternalConnectorNotReviewed extends Schema.TaggedError<ExternalConnectorNotReviewed>()(
  "ExternalConnectorNotReviewed",
  {
    connectorId: NonEmptyString,
    version: PositiveInt,
  },
) {}

export class ExternalConnectorRetired extends Schema.TaggedError<ExternalConnectorRetired>()(
  "ExternalConnectorRetired",
  {
    connectorId: NonEmptyString,
    version: PositiveInt,
  },
) {}

export class ExternalConnectorVersionConflict extends Schema.TaggedError<ExternalConnectorVersionConflict>()(
  "ExternalConnectorVersionConflict",
  {
    connectorId: NonEmptyString,
    connectorVersion: PositiveInt,
    operationVersion: PositiveInt,
  },
) {}
