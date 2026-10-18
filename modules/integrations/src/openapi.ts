import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { ExternalActionNotAllowlisted, ExternalPayloadInvalid } from "./errors.ts"

const Uuid = Schema.String.check(Schema.isUUID())
const MaxFieldLength = 256
const NonEmptyString = Schema.String.check(
  Schema.isPattern(/\S/),
  Schema.isMaxLength(MaxFieldLength),
)
const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))
const OpenApiPath = NonEmptyString.check(Schema.isPattern(/^\/\S*$/))
export const SupportedOpenApiMethod = Schema.Literals([
  "get",
  "post",
  "put",
  "patch",
  "delete",
])
export type SupportedOpenApiMethod = Schema.Schema.Type<typeof SupportedOpenApiMethod>

const MaxDocumentSectionBytes = 512 * 1024
const utf8Encoder = new TextEncoder()
const JsonObject = Schema.Record(Schema.String, Schema.Json)
type JsonObjectValue = Schema.Schema.Type<typeof JsonObject>
const jsonByteLength = (value: JsonObjectValue): number =>
  utf8Encoder.encode(JSON.stringify(value)).byteLength
const BoundedJsonObject = JsonObject.check(Schema.makeFilter(
  (value) => jsonByteLength(value) <= MaxDocumentSectionBytes,
  { expected: `a JSON object <= ${MaxDocumentSectionBytes} UTF-8 bytes` },
))

export const OpenApiDocument = Schema.Struct({
  openapi: Schema.Literal("3.2.0"),
  info: BoundedJsonObject,
  paths: BoundedJsonObject,
})

export const OpenApiOperation = Schema.Struct({
  operationId: NonEmptyString,
  method: SupportedOpenApiMethod,
  path: OpenApiPath,
  hasAuthentication: Schema.Boolean,
  requiredScope: NonEmptyString,
  sideEffect: Schema.Boolean,
  idempotencyKeyRequired: Schema.Boolean,
})

export const OpenApiImportRequest = Schema.Struct({
  tenantId: Uuid,
  connectorId: NonEmptyString,
  document: OpenApiDocument,
  operation: OpenApiOperation,
  version: PositiveInt,
  allowlisted: Schema.Boolean,
})
export type OpenApiImportRequest = Schema.Schema.Type<typeof OpenApiImportRequest>

export const OpenApiOperationSelection = Schema.Struct({
  kind: Schema.Literal("ExternalAction"),
  standard: Schema.Literal("OpenAPI 3.2.0"),
  tenantId: Uuid,
  connectorId: NonEmptyString,
  operationId: NonEmptyString,
  path: OpenApiPath,
  method: SupportedOpenApiMethod,
  version: PositiveInt,
  requiredScope: NonEmptyString,
  allowlisted: Schema.Literal(true),
})
export type OpenApiOperationSelection = Schema.Schema.Type<typeof OpenApiOperationSelection>

const invalid = (boundary: string, identifier: string) =>
  new ExternalPayloadInvalid({ boundary, identifier })

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const documentContainsSelectedOperation = (
  paths: JsonObjectValue,
  operation: Schema.Schema.Type<typeof OpenApiOperation>,
): boolean => {
  const pathItem = paths[operation.path]
  if (!isRecord(pathItem)) return false
  const selected = pathItem[operation.method]
  return isRecord(selected) && selected.operationId === operation.operationId
}

export const validateOpenApiImport = (
  input: unknown,
): Effect.Effect<
  OpenApiOperationSelection,
  ExternalActionNotAllowlisted | ExternalPayloadInvalid | Schema.SchemaError
> =>
  Effect.gen(function*() {
    const decoded = yield* Schema.decodeUnknownEffect(OpenApiImportRequest)(input)
    if (!documentContainsSelectedOperation(decoded.document.paths, decoded.operation)) {
      return yield* Effect.fail(
        invalid("integration.openapi.operation", decoded.operation.operationId),
      )
    }
    if (!decoded.allowlisted) {
      return yield* Effect.fail(
        new ExternalActionNotAllowlisted({
          tenantId: decoded.tenantId,
          actionId: `${decoded.connectorId}.${decoded.operation.operationId}`,
        }),
      )
    }
    if (!decoded.operation.hasAuthentication) {
      return yield* Effect.fail(
        invalid("integration.openapi.authentication", decoded.operation.operationId),
      )
    }
    if (decoded.operation.sideEffect && !decoded.operation.idempotencyKeyRequired) {
      return yield* Effect.fail(
        invalid("integration.openapi.idempotency", decoded.operation.operationId),
      )
    }
    return yield* Schema.decodeUnknownEffect(OpenApiOperationSelection)({
      kind: "ExternalAction",
      standard: "OpenAPI 3.2.0",
      tenantId: decoded.tenantId,
      connectorId: decoded.connectorId,
      operationId: decoded.operation.operationId,
      path: decoded.operation.path,
      method: decoded.operation.method,
      version: decoded.version,
      requiredScope: decoded.operation.requiredScope,
      allowlisted: true,
    })
  })
