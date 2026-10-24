import * as Result from "effect/Result"
import * as Schema from "effect/Schema"

import {
  type ActionCompensation,
  ActionCompensationSchema,
  type ActionIdempotency,
  ActionIdempotencySchema,
  type CatalogSchema,
  type CatalogStability,
  CatalogStabilitySchema,
  type CompatibilityRange,
  CompatibilityRangeSchema,
} from "../../module/mod.ts"

export const ExternalIntegrationProfile = {
  actionTransport: "HTTPS + JSON",
  openApiStandard: "OpenAPI",
  openApiVersion: "3.2.0",
  eventTransport: "CloudEvents 1.0.x over HTTPS/Webhook",
  asyncApiVersion: "3.1.0",
  authentication: "OAuth 2.0",
  oauthSecurityBaseline: "RFC 9700",
  problemDetails: "RFC 9457",
} as const

export type ExternalActionIdempotency = ActionIdempotency

export type ExternalSchema = CatalogSchema

export const ExternalCatalogLimits = {
  maxIdentifierLength: 256,
  maxScopeLength: 256,
  maxCorrelationFields: 32,
  maxFilterableFields: 32,
  maxErrorSchemas: 32,
  maxAttempts: 10,
  maxTimeoutMs: 120_000,
  maxPayloadBytes: 256 * 1024,
} as const

const Identifier = Schema.String.check(
  Schema.isPattern(/\S/),
  Schema.isMaxLength(ExternalCatalogLimits.maxIdentifierLength),
)

const Scope = Schema.String.check(
  Schema.isPattern(/\S/),
  Schema.isMaxLength(ExternalCatalogLimits.maxScopeLength),
)

const PositiveInteger = Schema.Int.check(Schema.isGreaterThan(0))
const ProblemText = Schema.String.check(Schema.isPattern(/\S/), Schema.isMaxLength(4_096))

export type ExternalActionCatalogEntry = {
  readonly kind: "ExternalAction"
  readonly id: string
  readonly version: number
  readonly connectorId: string
  readonly operationId: string
  readonly stability: CatalogStability
  readonly compatibilityRange: CompatibilityRange
  readonly inputSchema: ExternalSchema
  readonly outputSchema: ExternalSchema
  readonly errorSchemas: readonly ExternalSchema[]
  readonly requiredScope: string
  readonly idempotencyStrategy: ExternalActionIdempotency
  readonly timeoutPolicy: { readonly timeoutMs: number }
  readonly retryPolicy: { readonly maxAttempts: number }
  readonly compensation: ActionCompensation
  readonly allowlisted: boolean
}

export type ExternalEventCatalogEntry = {
  readonly kind: "ExternalEvent"
  readonly id: string
  readonly version: number
  readonly connectorId: string
  readonly source: string
  readonly stability: CatalogStability
  readonly compatibilityRange: CompatibilityRange
  readonly payloadSchema: ExternalSchema
  readonly envelope: "CloudEvents 1.0.x"
  readonly transport: "HTTPS/Webhook"
  readonly scope: readonly string[]
  readonly correlationFields: readonly string[]
  readonly filterableFields: readonly string[]
  readonly deduplicationKey: string
  readonly occurredAtSemantics: "provider_time" | "ingest_time"
}

export const ExternalProblemDetails = Schema.Struct({
  type: ProblemText,
  title: ProblemText,
  status: Schema.Int.check(Schema.isGreaterThanOrEqualTo(400), Schema.isLessThanOrEqualTo(599)),
  detail: ProblemText,
})

const ExternalSchemaValue = Schema.Unknown.pipe(
  Schema.refine((value): value is ExternalSchema => Schema.isSchema(value)),
)

const ExternalErrorSchemas = Schema.Array(ExternalSchemaValue).check(
  Schema.isMaxLength(ExternalCatalogLimits.maxErrorSchemas),
)

const ScopeList = Schema.Array(Scope).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(ExternalCatalogLimits.maxCorrelationFields),
)

const CorrelationFields = Schema.Array(Identifier).check(
  Schema.isMaxLength(ExternalCatalogLimits.maxCorrelationFields),
)

const FilterableFields = Schema.Array(Identifier).check(
  Schema.isMaxLength(ExternalCatalogLimits.maxFilterableFields),
)

const TimeoutPolicySchema = Schema.Struct({
  timeoutMs: PositiveInteger.check(Schema.isLessThanOrEqualTo(ExternalCatalogLimits.maxTimeoutMs)),
})

const RetryPolicySchema = Schema.Struct({
  maxAttempts: PositiveInteger.check(Schema.isLessThanOrEqualTo(ExternalCatalogLimits.maxAttempts)),
})

export const ExternalActionDefinitionSchema = Schema.Struct({
  kind: Schema.Literal("ExternalAction"),
  id: Identifier,
  version: PositiveInteger,
  connectorId: Identifier,
  operationId: Identifier,
  stability: CatalogStabilitySchema,
  compatibilityRange: CompatibilityRangeSchema,
  inputSchema: ExternalSchemaValue,
  outputSchema: ExternalSchemaValue,
  errorSchemas: ExternalErrorSchemas,
  requiredScope: Scope,
  idempotencyStrategy: ActionIdempotencySchema,
  timeoutPolicy: TimeoutPolicySchema,
  retryPolicy: RetryPolicySchema,
  compensation: ActionCompensationSchema,
  allowlisted: Schema.Boolean,
}).check(
  Schema.makeFilter((entry) =>
    entry.version >= entry.compatibilityRange.minimumVersion &&
    entry.version <= entry.compatibilityRange.maximumVersion
      ? undefined
      : {
          path: ["compatibilityRange"],
          issue: "version must be within compatibilityRange",
        },
  ),
)

export const ExternalEventDefinitionSchema = Schema.Struct({
  kind: Schema.Literal("ExternalEvent"),
  id: Identifier,
  version: PositiveInteger,
  connectorId: Identifier,
  source: Identifier,
  stability: CatalogStabilitySchema,
  compatibilityRange: CompatibilityRangeSchema,
  payloadSchema: ExternalSchemaValue,
  envelope: Schema.Literal("CloudEvents 1.0.x"),
  transport: Schema.Literal("HTTPS/Webhook"),
  scope: ScopeList,
  correlationFields: CorrelationFields,
  filterableFields: FilterableFields,
  deduplicationKey: Identifier,
  occurredAtSemantics: Schema.Literals(["provider_time", "ingest_time"]),
}).check(
  Schema.makeFilter((entry) =>
    entry.version >= entry.compatibilityRange.minimumVersion &&
    entry.version <= entry.compatibilityRange.maximumVersion
      ? undefined
      : {
          path: ["compatibilityRange"],
          issue: "version must be within compatibilityRange",
        },
  ),
)

export const decodeExternalActionDefinition = Schema.decodeUnknownResult(
  ExternalActionDefinitionSchema,
)

export const decodeExternalEventDefinition = Schema.decodeUnknownResult(
  ExternalEventDefinitionSchema,
)

export const validateExternalActionDefinition = (
  entry: unknown,
): entry is ExternalActionCatalogEntry => Result.isSuccess(decodeExternalActionDefinition(entry))

export const validateExternalEventDefinition = (
  entry: unknown,
): entry is ExternalEventCatalogEntry => Result.isSuccess(decodeExternalEventDefinition(entry))

export const defineExternalAction = <const Entry extends ExternalActionCatalogEntry>(
  entry: Entry,
): Entry => entry

export const defineExternalEvent = <const Entry extends ExternalEventCatalogEntry>(
  entry: Entry,
): Entry => entry

export const isAllowlistedExternalAction = (entry: ExternalActionCatalogEntry): boolean =>
  entry.allowlisted
