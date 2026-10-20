import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Predicate from "effect/Predicate"

import { FencingContext, LeaseGeneration } from "../concurrency/mod.ts"
import { uuidv7 } from "../ids/mod.ts"
import { InstantString } from "../time/mod.ts"

const Uuid = Schema.String.check(Schema.isUUID())
const NonEmptyString = Schema.String.check(Schema.isPattern(/\S/))
const Slug = Schema.String.check(
  Schema.makeFilter((value) => /^[a-z][a-z0-9._-]*$/.test(value), {
    expected: "a lowercase document slug",
  }),
)
const PositiveInteger = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 2_147_483_647 }))
const NonNegativeInteger = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: 2_147_483_647 }),
)
const Sha256 = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/))

export const DocumentRendererFamily = Schema.Literals([
  "native-transactional",
  "publishing",
  "static-html",
  "browser-html",
])
export type DocumentRendererFamily = Schema.Schema.Type<typeof DocumentRendererFamily>

export const DocumentCapability = Schema.Literals([
  "css",
  "paged-media",
  "javascript",
  "browser-dom",
  "canvas",
  "svg",
  "remote-assets",
])
export type DocumentCapability = Schema.Schema.Type<typeof DocumentCapability>

export const DocumentSourceRef = Schema.Struct({
  owner: Slug,
  type: Slug,
  id: Uuid,
})
export type DocumentSourceRef = Schema.Schema.Type<typeof DocumentSourceRef>

export const DocumentSnapshotInput = Schema.Struct({
  snapshotId: Schema.optionalKey(Uuid),
  tenantId: Uuid,
  source: DocumentSourceRef,
  capturedAt: InstantString,
  schemaVersion: PositiveInteger,
  payload: Schema.Json,
})
export type DocumentSnapshotInput = Schema.Schema.Type<typeof DocumentSnapshotInput>

export const DocumentSnapshot = Schema.Struct({
  snapshotId: Uuid,
  tenantId: Uuid,
  source: DocumentSourceRef,
  capturedAt: InstantString,
  schemaVersion: PositiveInteger,
  payload: Schema.Json,
  checksum: Sha256,
})
export type DocumentSnapshot = Schema.Schema.Type<typeof DocumentSnapshot>

export const DocumentContext = Schema.Struct({
  snapshotId: Uuid,
  tenantId: Uuid,
  source: DocumentSourceRef,
  capturedAt: InstantString,
  schemaVersion: PositiveInteger,
  data: Schema.Json,
  snapshotChecksum: Sha256,
})
export type DocumentContext = Schema.Schema.Type<typeof DocumentContext>

const DocumentTextNode = Schema.Struct({
  _tag: Schema.Literal("text"),
  value: NonEmptyString,
})
const DocumentImageNode = Schema.Struct({
  _tag: Schema.Literal("image"),
  assetId: NonEmptyString,
  alt: NonEmptyString,
})
const DocumentTableNode = Schema.Struct({
  _tag: Schema.Literal("table"),
  headers: Schema.Array(NonEmptyString).check(Schema.isMinLength(1)),
  rows: Schema.Array(Schema.Array(NonEmptyString)),
}).check(
  Schema.makeFilter((node) => node.rows.every((row) => row.length === node.headers.length), {
    expected: "document table rows must match the header width",
  }),
)
const DocumentDividerNode = Schema.Struct({ _tag: Schema.Literal("divider") })
const DocumentSpacerNode = Schema.Struct({
  _tag: Schema.Literal("spacer"),
  heightPx: NonNegativeInteger,
})
const DocumentPageBreakNode = Schema.Struct({ _tag: Schema.Literal("page_break") })
const DocumentBarcodeNode = Schema.Struct({
  _tag: Schema.Literal("barcode"),
  value: NonEmptyString,
})
const DocumentQrCodeNode = Schema.Struct({
  _tag: Schema.Literal("qr_code"),
  value: NonEmptyString,
})
const DocumentSignatureNode = Schema.Struct({
  _tag: Schema.Literal("signature"),
  assetId: NonEmptyString,
  label: NonEmptyString,
})

export const DocumentNode = Schema.Union([
  DocumentTextNode,
  DocumentImageNode,
  DocumentTableNode,
  DocumentDividerNode,
  DocumentSpacerNode,
  DocumentPageBreakNode,
  DocumentBarcodeNode,
  DocumentQrCodeNode,
  DocumentSignatureNode,
])
export type DocumentNode = Schema.Schema.Type<typeof DocumentNode>

export const DocumentAstInput = Schema.Struct({
  astId: Schema.optionalKey(Uuid),
  snapshotId: Uuid,
  documentType: Slug,
  astVersion: PositiveInteger,
  nodes: Schema.Array(DocumentNode).check(Schema.isMinLength(1)),
})
export type DocumentAstInput = Schema.Schema.Type<typeof DocumentAstInput>

export const DocumentAst = Schema.Struct({
  astId: Uuid,
  snapshotId: Uuid,
  documentType: Slug,
  astVersion: PositiveInteger,
  nodes: Schema.Array(DocumentNode).check(Schema.isMinLength(1)),
  checksum: Sha256,
})
export type DocumentAst = Schema.Schema.Type<typeof DocumentAst>

export const DocumentRenderRequestInput = Schema.Struct({
  tenantId: Uuid,
  snapshotId: Uuid,
  snapshotChecksum: Sha256,
  astId: Uuid,
  astChecksum: Sha256,
  templateId: Slug,
  templateVersion: PositiveInteger,
  documentSchemaVersion: PositiveInteger,
  rendererFamily: DocumentRendererFamily,
  rendererVersion: NonEmptyString,
  assetVersions: Schema.Array(NonEmptyString),
  capabilities: Schema.Array(DocumentCapability),
  astNodeCount: NonNegativeInteger,
  pageCount: NonNegativeInteger,
  assetBytes: NonNegativeInteger,
  correlationId: NonEmptyString,
})
export type DocumentRenderRequestInput = Schema.Schema.Type<typeof DocumentRenderRequestInput>

export const DocumentRenderRequest = Schema.Struct({
  ...DocumentRenderRequestInput.fields,
  renderFingerprint: Sha256,
  fenceScope: NonEmptyString,
})
export type DocumentRenderRequest = Schema.Schema.Type<typeof DocumentRenderRequest>

export const DocumentRenderJobPayload = Schema.Struct({
  jobVersion: PositiveInteger,
  tenantId: Uuid,
  snapshotId: Uuid,
  astId: Uuid,
  templateId: Slug,
  templateVersion: PositiveInteger,
  documentSchemaVersion: PositiveInteger,
  rendererFamily: DocumentRendererFamily,
  rendererVersion: NonEmptyString,
  assetVersions: Schema.Array(NonEmptyString),
  capabilities: Schema.Array(DocumentCapability),
  astNodeCount: NonNegativeInteger,
  pageCount: NonNegativeInteger,
  assetBytes: NonNegativeInteger,
  snapshotChecksum: Sha256,
  astChecksum: Sha256,
  renderFingerprint: Sha256,
  idempotencyKey: NonEmptyString,
  correlationId: NonEmptyString,
  fenceScope: NonEmptyString,
})
export type DocumentRenderJobPayload = Schema.Schema.Type<typeof DocumentRenderJobPayload>

export const DocumentArtifactStatus = Schema.Literals(["ready", "failed", "manual_recovery"])
export type DocumentArtifactStatus = Schema.Schema.Type<typeof DocumentArtifactStatus>

export const DocumentArtifact = Schema.Struct({
  artifactId: Uuid,
  tenantId: Uuid,
  snapshotId: Uuid,
  astId: Uuid,
  templateId: Slug,
  templateVersion: PositiveInteger,
  documentSchemaVersion: PositiveInteger,
  rendererFamily: DocumentRendererFamily,
  rendererVersion: NonEmptyString,
  assetVersions: Schema.Array(NonEmptyString),
  renderFingerprint: Sha256,
  contentHash: Sha256,
  mediaType: NonEmptyString,
  byteLength: NonNegativeInteger,
  pageCount: NonNegativeInteger,
  status: DocumentArtifactStatus,
  createdAt: InstantString,
})
export type DocumentArtifact = Schema.Schema.Type<typeof DocumentArtifact>

export const DocumentArtifactLookup = Schema.Struct({
  tenantId: Uuid,
  renderFingerprint: Sha256,
})
export type DocumentArtifactLookup = Schema.Schema.Type<typeof DocumentArtifactLookup>

export type DocumentArtifactWrite = {
  readonly metadata: DocumentArtifact
  readonly bytes: Uint8Array
  readonly fencing: Schema.Schema.Type<typeof FencingContext>
}

export type DocumentArtifactRecord = {
  readonly metadata: DocumentArtifact
  readonly bytes: Uint8Array
}

export type DocumentRenderInput = {
  readonly context: DocumentContext
  readonly ast: DocumentAst
  readonly request: DocumentRenderRequest
}

export type DocumentRenderedOutput = {
  readonly metadata: DocumentArtifact
  readonly bytes: Uint8Array
}

export interface DocumentRenderer {
  readonly family: DocumentRendererFamily
  readonly render: (
    input: DocumentRenderInput,
  ) => Effect.Effect<
    DocumentRenderedOutput,
    | DocumentAssetUnavailable
    | DocumentHashFailure
    | DocumentRenderLimitExceeded
    | DocumentRenderPolicyViolation
    | DocumentRendererFailure
    | Schema.SchemaError
    | UnsupportedDocumentCapability
  >
}

export class DocumentHashFailure extends Schema.TaggedError<DocumentHashFailure>()(
  "DocumentHashFailure",
  { cause: Schema.Unknown },
) {}

export class DocumentAssetUnavailable extends Schema.TaggedError<DocumentAssetUnavailable>()(
  "DocumentAssetUnavailable",
  {
    assetId: NonEmptyString,
    reason: NonEmptyString,
  },
) {}

export class DocumentRendererFailure extends Schema.TaggedError<DocumentRendererFailure>()(
  "DocumentRendererFailure",
  {
    rendererFamily: DocumentRendererFamily,
    operation: NonEmptyString,
    reason: NonEmptyString,
    cause: Schema.Unknown,
  },
) {}

export class UnsupportedDocumentCapability extends Schema.TaggedError<UnsupportedDocumentCapability>()(
  "UnsupportedDocumentCapability",
  {
    rendererFamily: DocumentRendererFamily,
    capability: DocumentCapability,
  },
) {}

export class DocumentRenderPolicyViolation extends Schema.TaggedError<DocumentRenderPolicyViolation>()(
  "DocumentRenderPolicyViolation",
  {
    reason: Schema.Literals([
      "renderer_family_mismatch",
      "javascript_disabled",
      "network_disabled",
    ]),
  },
) {}

export class DocumentRenderLimitExceeded extends Schema.TaggedError<DocumentRenderLimitExceeded>()(
  "DocumentRenderLimitExceeded",
  {
    limit: Schema.Literals(["ast_nodes", "pages", "asset_bytes"]),
    actual: NonNegativeInteger,
    maximum: NonNegativeInteger,
  },
) {}

export class DocumentArtifactConflict extends Schema.TaggedError<DocumentArtifactConflict>()(
  "DocumentArtifactConflict",
  {
    tenantId: Uuid,
    renderFingerprint: Sha256,
    reason: NonEmptyString,
  },
) {}

export class DocumentArtifactStaleWriter extends Schema.TaggedError<DocumentArtifactStaleWriter>()(
  "DocumentArtifactStaleWriter",
  {
    fenceScope: NonEmptyString,
    receivedGeneration: LeaseGeneration,
    currentGeneration: LeaseGeneration,
  },
) {}

export class DocumentArtifactInvalidContent extends Schema.TaggedError<DocumentArtifactInvalidContent>()(
  "DocumentArtifactInvalidContent",
  {
    artifactId: NonEmptyString,
    reason: NonEmptyString,
  },
) {}

export const DocumentRenderPolicy = Schema.Struct({
  rendererFamily: DocumentRendererFamily,
  capabilities: Schema.Array(DocumentCapability),
  allowJavaScript: Schema.Boolean,
  allowNetwork: Schema.Boolean,
  maxAstNodes: PositiveInteger,
  maxPages: PositiveInteger,
  maxAssetBytes: NonNegativeInteger,
})
export type DocumentRenderPolicy = Schema.Schema.Type<typeof DocumentRenderPolicy>

export const canonicalizeJson = (value: Schema.Schema.Type<typeof Schema.Json>): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalizeJson).join(",")}]`
  if (
    value === null ||
    Predicate.isString(value) ||
    Predicate.isNumber(value) ||
    Predicate.isBoolean(value)
  ) {
    const encoded = JSON.stringify(value)
    return encoded === undefined ? "null" : encoded
  }
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalizeJson(entry)}`)
    .join(",")}}`
}

export const sha256Hex = (input: string | Uint8Array) =>
  Effect.tryPromise({
    try: async () => {
      const bytes = Predicate.isString(input) ? new TextEncoder().encode(input) : input
      const buffer = new ArrayBuffer(bytes.byteLength)
      new Uint8Array(buffer).set(bytes)
      const digest = await crypto.subtle.digest("SHA-256", buffer)
      return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
    },
    catch: (cause) => new DocumentHashFailure({ cause }),
  })

export const hashJson = (input: unknown) =>
  Effect.gen(function* () {
    const decoded = yield* Schema.decodeUnknownEffect(Schema.Json)(input)
    return yield* sha256Hex(canonicalizeJson(decoded))
  })

export const createDocumentSnapshot = (input: unknown) =>
  Effect.gen(function* () {
    const decoded = yield* Schema.decodeUnknownEffect(DocumentSnapshotInput)(input)
    const checksum = yield* hashJson({
      tenantId: decoded.tenantId,
      source: decoded.source,
      schemaVersion: decoded.schemaVersion,
      payload: decoded.payload,
    })
    return {
      ...decoded,
      snapshotId: decoded.snapshotId ?? uuidv7(),
      checksum,
    } satisfies DocumentSnapshot
  })

export const documentContextFromSnapshot = (snapshot: DocumentSnapshot): DocumentContext => ({
  snapshotId: snapshot.snapshotId,
  tenantId: snapshot.tenantId,
  source: snapshot.source,
  capturedAt: snapshot.capturedAt,
  schemaVersion: snapshot.schemaVersion,
  data: snapshot.payload,
  snapshotChecksum: snapshot.checksum,
})

export const createDocumentAst = (input: unknown) =>
  Effect.gen(function* () {
    const decoded = yield* Schema.decodeUnknownEffect(DocumentAstInput)(input)
    const checksum = yield* hashJson({
      snapshotId: decoded.snapshotId,
      documentType: decoded.documentType,
      astVersion: decoded.astVersion,
      nodes: decoded.nodes,
    })
    return {
      ...decoded,
      astId: decoded.astId ?? uuidv7(),
      checksum,
    } satisfies DocumentAst
  })

export const createDocumentRenderRequest = (input: unknown) =>
  Effect.gen(function* () {
    const decoded = yield* Schema.decodeUnknownEffect(DocumentRenderRequestInput)(input)
    const renderFingerprint = yield* hashJson({
      tenantId: decoded.tenantId,
      snapshotId: decoded.snapshotId,
      snapshotChecksum: decoded.snapshotChecksum,
      astId: decoded.astId,
      astChecksum: decoded.astChecksum,
      templateId: decoded.templateId,
      templateVersion: decoded.templateVersion,
      documentSchemaVersion: decoded.documentSchemaVersion,
      rendererFamily: decoded.rendererFamily,
      rendererVersion: decoded.rendererVersion,
      assetVersions: decoded.assetVersions,
      capabilities: decoded.capabilities,
      astNodeCount: decoded.astNodeCount,
      pageCount: decoded.pageCount,
      assetBytes: decoded.assetBytes,
    })
    return {
      ...decoded,
      renderFingerprint,
      fenceScope: `document-render:${decoded.tenantId}:${renderFingerprint}`,
    } satisfies DocumentRenderRequest
  })

export const documentRenderIdempotencyKey = (
  request: Pick<DocumentRenderRequest, "tenantId" | "renderFingerprint">,
) => `document-render:${request.tenantId}:${request.renderFingerprint}`

export const makeDocumentRenderJobPayload = (input: unknown) =>
  Effect.gen(function* () {
    const request = yield* Schema.decodeUnknownEffect(DocumentRenderRequest)(input)
    return {
      jobVersion: 1,
      tenantId: request.tenantId,
      snapshotId: request.snapshotId,
      astId: request.astId,
      templateId: request.templateId,
      templateVersion: request.templateVersion,
      documentSchemaVersion: request.documentSchemaVersion,
      rendererFamily: request.rendererFamily,
      rendererVersion: request.rendererVersion,
      assetVersions: request.assetVersions,
      capabilities: request.capabilities,
      astNodeCount: request.astNodeCount,
      pageCount: request.pageCount,
      assetBytes: request.assetBytes,
      snapshotChecksum: request.snapshotChecksum,
      astChecksum: request.astChecksum,
      renderFingerprint: request.renderFingerprint,
      idempotencyKey: documentRenderIdempotencyKey(request),
      correlationId: request.correlationId,
      fenceScope: request.fenceScope,
    } satisfies DocumentRenderJobPayload
  })

const validateRendererFamily = (
  requirements: DocumentRenderRequestInput,
  policy: DocumentRenderPolicy,
) =>
  requirements.rendererFamily === policy.rendererFamily
    ? Effect.succeed<void>(undefined)
    : Effect.fail(new DocumentRenderPolicyViolation({ reason: "renderer_family_mismatch" }))

const validateRequiredCapabilities = (
  requirements: DocumentRenderRequestInput,
  policy: DocumentRenderPolicy,
) => {
  const unsupported = requirements.capabilities.find(
    (capability) => !policy.capabilities.includes(capability),
  )
  return unsupported === undefined
    ? Effect.succeed<void>(undefined)
    : Effect.fail(
        new UnsupportedDocumentCapability({
          rendererFamily: requirements.rendererFamily,
          capability: unsupported,
        }),
      )
}

const validatePolicyFlags = (
  requirements: DocumentRenderRequestInput,
  policy: DocumentRenderPolicy,
) => {
  const reason =
    requirements.capabilities.includes("javascript") && !policy.allowJavaScript
      ? ("javascript_disabled" as const)
      : requirements.capabilities.includes("remote-assets") && !policy.allowNetwork
        ? ("network_disabled" as const)
        : undefined
  return reason === undefined
    ? Effect.succeed<void>(undefined)
    : Effect.fail(new DocumentRenderPolicyViolation({ reason }))
}

const validateRenderLimits = (
  requirements: DocumentRenderRequestInput,
  policy: DocumentRenderPolicy,
) => {
  const limits = [
    { limit: "ast_nodes" as const, actual: requirements.astNodeCount, maximum: policy.maxAstNodes },
    { limit: "pages" as const, actual: requirements.pageCount, maximum: policy.maxPages },
    {
      limit: "asset_bytes" as const,
      actual: requirements.assetBytes,
      maximum: policy.maxAssetBytes,
    },
  ]
  const exceeded = limits.find(({ actual, maximum }) => actual > maximum)
  return exceeded === undefined
    ? Effect.succeed<void>(undefined)
    : Effect.fail(new DocumentRenderLimitExceeded(exceeded))
}

export const validateDocumentRenderPolicy = (requirements: unknown, policy: unknown) =>
  Effect.gen(function* () {
    const decodedRequirements = yield* Schema.decodeUnknownEffect(DocumentRenderRequestInput)(
      requirements,
    )
    const decodedPolicy = yield* Schema.decodeUnknownEffect(DocumentRenderPolicy)(policy)
    yield* validateRendererFamily(decodedRequirements, decodedPolicy)
    yield* validateRequiredCapabilities(decodedRequirements, decodedPolicy)
    yield* validatePolicyFlags(decodedRequirements, decodedPolicy)
    yield* validateRenderLimits(decodedRequirements, decodedPolicy)
    return decodedPolicy
  })

export interface DocumentArtifactStore {
  readonly put: (
    input: unknown,
  ) => Effect.Effect<
    DocumentArtifact,
    | DocumentArtifactConflict
    | DocumentArtifactInvalidContent
    | DocumentArtifactStaleWriter
    | DocumentHashFailure
    | Schema.SchemaError
  >
  readonly get: (
    input: unknown,
  ) => Effect.Effect<DocumentArtifactRecord | undefined, Schema.SchemaError>
}

export const DocumentArtifactStore = Context.Service<DocumentArtifactStore>(
  "RITSEI/DocumentArtifactStore",
)
