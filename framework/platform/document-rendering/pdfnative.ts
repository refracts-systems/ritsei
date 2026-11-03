import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Schema from "effect/Schema"
import * as Predicate from "effect/Predicate"
import {
  buildDocumentPDFBytes,
  detectFallbackLangs,
  detectImageFormat,
  type DocumentBlock as PdfDocumentBlock,
  type DocumentParams as PdfDocumentParams,
  type FontData,
  type FontLoader,
  inspectDocumentLayout,
  loadFontData,
  parseImage,
  type PdfLayoutOptions,
  registerFonts,
} from "pdfnative"

import { uuidv7 } from "../../foundation/ids/mod.ts"
import {
  DocumentArtifact,
  DocumentArtifactStatus,
  DocumentAssetUnavailable,
  DocumentAst,
  DocumentContext,
  DocumentNode,
  DocumentRenderer,
  DocumentRendererFailure,
  DocumentRenderInput,
  DocumentRenderLimitExceeded,
  DocumentRenderPolicy,
  DocumentRenderRequest,
  createDocumentAst,
  createDocumentRenderRequest,
  createDocumentSnapshot,
  sha256Hex,
  validateDocumentRenderPolicy,
} from "../../foundation/mod.ts"

const fontLoader =
  (load: () => Promise<object>): FontLoader =>
  async () => {
    const module = await load()
    const font = Predicate.isObjectOrArray(module) && "default" in module ? module.default : module

    if (!Predicate.isObjectKeyword(font) || !("fontName" in font) || !("ttfBase64" in font)) {
      throw new TypeError("pdfnative font module did not expose FontData")
    }

    // SAFETY: pdfnative's generated font declarations describe module fields loosely; the runtime object is
    // the FontData shape documented by its FontLoader contract.
    return font as FontData
  }

registerFonts({
  ar: fontLoader(() => import("pdfnative/fonts/noto-arabic-data.js")),
  ja: fontLoader(() => import("pdfnative/fonts/noto-jp-data.js")),
  ko: fontLoader(() => import("pdfnative/fonts/noto-kr-data.js")),
  latin: fontLoader(() => import("pdfnative/fonts/noto-sans-data.js")),
  zh: fontLoader(() => import("pdfnative/fonts/noto-sc-data.js")),
})

// pdfnative 1.7.0 formats its supplied Date with local-time getters. Keep its PDF and XMP
// metadata in UTC without changing the process timezone shared by other requests.
class UtcMetadataDate extends Date {
  override getFullYear() {
    return this.getUTCFullYear()
  }

  override getMonth() {
    return this.getUTCMonth()
  }

  override getDate() {
    return this.getUTCDate()
  }

  override getHours() {
    return this.getUTCHours()
  }

  override getMinutes() {
    return this.getUTCMinutes()
  }

  override getSeconds() {
    return this.getUTCSeconds()
  }

  override getTimezoneOffset() {
    return 0
  }
}

const deterministicCreationDate = new UtcMetadataDate("2000-01-01T00:00:00.000Z")

// Increment the adapter version when a change can affect the PDF bytes.
export const pdfNativeRendererVersion = "ritsei-pdfnative@1+pdfnative@1.7.0"

const defaultPolicy: DocumentRenderPolicy = {
  rendererFamily: "native-transactional",
  capabilities: ["svg"],
  allowJavaScript: false,
  allowNetwork: false,
  maxAstNodes: 100_000,
  maxPages: 10_000,
  maxAssetBytes: 50_000_000,
  maxImagePixels: 20_000_000,
  maxOutputBytes: 50_000_000,
}

/** Resolve only assets that the specified tenant is authorized to use. */
export type PdfNativeAssetResolver = (input: {
  readonly tenantId: string
  readonly assetId: string
  readonly version: string
}) => Effect.Effect<Uint8Array | undefined, DocumentAssetUnavailable | DocumentRendererFailure>

export type PdfNativeRendererOptions = {
  readonly policy?: DocumentRenderPolicy
  readonly resolveAsset?: PdfNativeAssetResolver
}

const rendererFailure = (operation: string, reason: string, cause: unknown) =>
  new DocumentRendererFailure({
    rendererFamily: "native-transactional",
    operation,
    reason,
    cause,
  })

const textValues = (nodes: ReadonlyArray<DocumentNode>) =>
  nodes.flatMap((node) => {
    if ("value" in node) return [node.value]

    if ("headers" in node) return [...node.headers, ...node.rows.flat()]

    if ("label" in node) return [node.label]

    return []
  })

const loadFontEntries = (texts: ReadonlyArray<string>) =>
  Effect.tryPromise({
    try: async () => {
      const languages = new Set(["latin", ...detectFallbackLangs([...texts], "latin")])

      const loaded = await Promise.all(
        [...languages].map(async (language) => {
          const fontData = await loadFontData(language)

          return fontData === null ? undefined : { fontData, lang: language }
        }),
      )

      return loaded
        .filter((entry): entry is { fontData: FontData; lang: string } => entry !== undefined)
        .map(({ fontData, lang }, index) => ({
          fontData,
          fontRef: `/RitseiFont${index + 1}`,
          lang,
        }))
    },
    catch: (cause) => rendererFailure("font-loading", "unable to load registered fonts", cause),
  })

type AssetBudget = { readonly usedBytes: number; readonly policy: DocumentRenderPolicy }

const validateImage = (bytes: Uint8Array, assetId: string, policy: DocumentRenderPolicy) =>
  Effect.gen(function* () {
    if (detectImageFormat(bytes) === null) {
      return yield* Effect.fail(
        rendererFailure("asset-loading", "asset is not a supported PNG or JPEG image", { assetId }),
      )
    }

    const dimensions = yield* Effect.try({
      try: () => parseImage(bytes),
      catch: (cause) => rendererFailure("asset-loading", "unable to parse image", cause),
    })

    const pixels = dimensions.width * dimensions.height

    if (dimensions.width < 1 || dimensions.height < 1 || pixels > 2_147_483_647) {
      return yield* Effect.fail(
        rendererFailure("asset-loading", "image dimensions are invalid or unsupported", undefined),
      )
    }

    if (pixels > policy.maxImagePixels) {
      return yield* Effect.fail(
        new DocumentRenderLimitExceeded({
          limit: "image_pixels",
          actual: pixels,
          maximum: policy.maxImagePixels,
        }),
      )
    }
  })

const loadAsset = (
  request: DocumentRenderRequest,
  assetId: string,
  resolveAsset: PdfNativeAssetResolver | undefined,
  budget: AssetBudget,
) =>
  Effect.gen(function* () {
    const asset = request.assetVersions.find((entry) => entry.assetId === assetId)

    if (asset === undefined) {
      return yield* Effect.fail(
        new DocumentAssetUnavailable({
          assetId,
          reason: "asset is absent from the render manifest",
        }),
      )
    }

    const resolved =
      resolveAsset === undefined
        ? undefined
        : yield* resolveAsset({ tenantId: request.tenantId, assetId, version: asset.version })

    if (resolved === undefined) {
      return yield* Effect.fail(
        new DocumentAssetUnavailable({
          assetId,
          reason: "the renderer has no asset bytes for this asset",
        }),
      )
    }

    yield* validateAssetBytes(budget.usedBytes + resolved.byteLength, budget.policy)

    // Keep the verified image stable even if the resolver later mutates its buffer.
    const bytes = Uint8Array.from(resolved)
    const contentHash = yield* sha256Hex(bytes)

    if (contentHash !== asset.contentHash) {
      return yield* Effect.fail(
        new DocumentAssetUnavailable({
          assetId,
          reason: "asset content does not match its version",
        }),
      )
    }

    yield* validateImage(bytes, assetId, budget.policy)

    return bytes
  })

type StaticDocumentNode = Exclude<DocumentNode, { _tag: "image" | "signature" }>

const toStaticPdfBlock = (node: StaticDocumentNode): PdfDocumentBlock =>
  Match.valueTags(node, {
    text: (node): PdfDocumentBlock => ({ type: "paragraph", text: node.value }),
    table: (node): PdfDocumentBlock => ({
      type: "table",
      headers: node.headers,
      rows: node.rows.map((cells) => ({ cells, type: "default", pointed: false })),
      repeatHeader: true,
      wrap: "auto",
    }),
    divider: (): PdfDocumentBlock => ({
      type: "svg",
      data: "M 0 0 L 460 0",
      width: 460,
      height: 1,
      fill: "none",
      stroke: "#CBD5E1",
      strokeWidth: 0.5,
      alt: "divider",
    }),
    spacer: (node): PdfDocumentBlock => ({ type: "spacer", height: node.heightPx }),
    page_break: (): PdfDocumentBlock => ({ type: "pageBreak" }),
    barcode: (node): PdfDocumentBlock => ({
      type: "barcode",
      format: "code128",
      data: node.value,
      align: "center",
    }),
    qr_code: (node): PdfDocumentBlock => ({
      type: "barcode",
      format: "qr",
      data: node.value,
      align: "center",
    }),
  })

const toImageBlocks = (
  node: Extract<DocumentNode, { _tag: "image" }>,
  request: DocumentRenderRequest,
  resolveAsset: PdfNativeAssetResolver | undefined,
  budget: AssetBudget,
) =>
  Effect.gen(function* () {
    const bytes = yield* loadAsset(request, node.assetId, resolveAsset, budget)

    const blocks: PdfDocumentBlock[] = [
      {
        type: "image",
        data: bytes,
        alt: node.alt,
        align: "center",
      },
    ]

    return { blocks, assetBytes: bytes.byteLength }
  })

const toSignatureBlocks = (
  node: Extract<DocumentNode, { _tag: "signature" }>,
  request: DocumentRenderRequest,
  resolveAsset: PdfNativeAssetResolver | undefined,
  budget: AssetBudget,
) =>
  Effect.gen(function* () {
    const bytes = yield* loadAsset(request, node.assetId, resolveAsset, budget)

    const blocks: PdfDocumentBlock[] = [
      { type: "paragraph", text: node.label },
      { type: "image", data: bytes, alt: node.label, align: "center" },
    ]

    return { blocks, assetBytes: bytes.byteLength }
  })

const toPdfBlocks = (
  nodes: ReadonlyArray<DocumentNode>,
  request: DocumentRenderRequest,
  resolveAsset: PdfNativeAssetResolver | undefined,
  policy: DocumentRenderPolicy,
) =>
  Effect.gen(function* () {
    const result = { blocks: new Array<PdfDocumentBlock>(), assetBytes: 0 }

    for (const node of nodes) {
      const budget = { usedBytes: result.assetBytes, policy }

      const blockResult = yield* Match.value(node).pipe(
        Match.tag("image", (image) => toImageBlocks(image, request, resolveAsset, budget)),
        Match.tag("signature", (signature) =>
          toSignatureBlocks(signature, request, resolveAsset, budget),
        ),
        Match.orElse((rest) => Effect.succeed({ blocks: [toStaticPdfBlock(rest)], assetBytes: 0 })),
      )

      result.assetBytes += blockResult.assetBytes
      yield* validateAssetBytes(result.assetBytes, policy)
      result.blocks.push(...blockResult.blocks)
    }

    return result
  })

const decodeInput = (input: DocumentRenderInput) =>
  Effect.gen(function* () {
    const context = yield* Schema.decodeUnknownEffect(DocumentContext)(input.context)
    const ast = yield* Schema.decodeUnknownEffect(DocumentAst)(input.ast)
    const request = yield* Schema.decodeUnknownEffect(DocumentRenderRequest)(input.request)

    return { context, ast, request }
  })

const validateInputReferences = (
  context: DocumentContext,
  ast: DocumentAst,
  request: DocumentRenderRequest,
) => {
  if (
    context.tenantId !== request.tenantId ||
    context.snapshotId !== request.snapshotId ||
    context.snapshotChecksum !== request.snapshotChecksum
  ) {
    return Effect.fail(
      rendererFailure(
        "input-validation",
        "document context does not match the render request snapshot",
        undefined,
      ),
    )
  }

  if (
    ast.astId !== request.astId ||
    ast.snapshotId !== request.snapshotId ||
    ast.checksum !== request.astChecksum
  ) {
    return Effect.fail(
      rendererFailure(
        "input-validation",
        "document AST does not match the render request",
        undefined,
      ),
    )
  }

  return Effect.succeed(undefined)
}

const validateInputIntegrity = (
  context: DocumentContext,
  ast: DocumentAst,
  request: DocumentRenderRequest,
) =>
  Effect.gen(function* () {
    const snapshot = yield* createDocumentSnapshot({
      snapshotId: context.snapshotId,
      tenantId: context.tenantId,
      source: context.source,
      capturedAt: context.capturedAt,
      schemaVersion: context.schemaVersion,
      payload: context.data,
    })

    const verifiedAst = yield* createDocumentAst(ast)
    const verifiedRequest = yield* createDocumentRenderRequest(request)

    if (
      snapshot.checksum !== context.snapshotChecksum ||
      verifiedAst.checksum !== ast.checksum ||
      verifiedRequest.renderFingerprint !== request.renderFingerprint ||
      verifiedRequest.fenceScope !== request.fenceScope ||
      ast.nodes.length !== request.astNodeCount
    ) {
      return yield* Effect.fail(
        rendererFailure(
          "input-validation",
          "document render input failed integrity validation",
          undefined,
        ),
      )
    }
  })

const validateAssetBytes = (assetBytes: number, policy: DocumentRenderPolicy) =>
  assetBytes > policy.maxAssetBytes
    ? Effect.fail(
        new DocumentRenderLimitExceeded({
          limit: "asset_bytes",
          actual: assetBytes,
          maximum: policy.maxAssetBytes,
        }),
      )
    : Effect.succeed(undefined)

const validatePageCount = (pageCount: number, policy: DocumentRenderPolicy) =>
  pageCount > policy.maxPages
    ? Effect.fail(
        new DocumentRenderLimitExceeded({
          limit: "pages",
          actual: pageCount,
          maximum: policy.maxPages,
        }),
      )
    : Effect.succeed(undefined)

const makePdfLayout = (policy: DocumentRenderPolicy): Partial<PdfLayoutOptions> => ({
  creationDate: deterministicCreationDate,
  maxBlocks: policy.maxAstNodes,
  tagged: "pdfa2u",
  strict: true,
  compress: false,
  onDiagnostic: () => undefined,
})

const inspectPdfLayout = (params: PdfDocumentParams, layout: Partial<PdfLayoutOptions>) =>
  Effect.tryPromise({
    try: async () => await inspectDocumentLayout(params, layout),
    catch: (cause) =>
      rendererFailure("layout-inspection", "pdfnative layout inspection failed", cause),
  })

const generatePdfBytes = (params: PdfDocumentParams, layout: Partial<PdfLayoutOptions>) =>
  Effect.tryPromise({
    try: async () => await buildDocumentPDFBytes(params, layout),
    catch: (cause) => rendererFailure("pdf-generation", "pdfnative PDF generation failed", cause),
  })

const makeDocumentArtifact = (
  request: DocumentRenderRequest,
  bytes: Uint8Array,
  pageCount: number,
) =>
  Effect.gen(function* () {
    const contentHash = yield* sha256Hex(bytes)

    const metadata = yield* Schema.decodeUnknownEffect(DocumentArtifact)({
      artifactId: uuidv7(),
      fingerprintVersion: request.fingerprintVersion,
      tenantId: request.tenantId,
      snapshotId: request.snapshotId,
      astId: request.astId,
      templateId: request.templateId,
      templateVersion: request.templateVersion,
      documentSchemaVersion: request.documentSchemaVersion,
      rendererFamily: request.rendererFamily,
      rendererVersion: request.rendererVersion,
      assetVersions: request.assetVersions,
      renderFingerprint: request.renderFingerprint,
      contentHash,
      mediaType: "application/pdf",
      byteLength: bytes.byteLength,
      pageCount,
      status: "ready" satisfies DocumentArtifactStatus,
      createdAt: new Date().toISOString(),
    })

    return { metadata, bytes }
  })

const renderPdfNativeDocument = (
  input: DocumentRenderInput,
  options: PdfNativeRendererOptions,
  policy: DocumentRenderPolicy,
) =>
  Effect.gen(function* () {
    if ("layout" in options) {
      return yield* Effect.fail(
        rendererFailure("input-validation", "renderer layout options are not supported", undefined),
      )
    }

    const { context, ast, request } = yield* decodeInput(input)

    if (request.rendererVersion !== pdfNativeRendererVersion) {
      return yield* Effect.fail(
        rendererFailure(
          "input-validation",
          "renderer version does not match the adapter",
          undefined,
        ),
      )
    }

    yield* validateDocumentRenderPolicy(request, policy)

    if (ast.nodes.length > policy.maxAstNodes) {
      return yield* Effect.fail(
        new DocumentRenderLimitExceeded({
          limit: "ast_nodes",
          actual: ast.nodes.length,
          maximum: policy.maxAstNodes,
        }),
      )
    }

    yield* validateInputReferences(context, ast, request)
    yield* validateInputIntegrity(context, ast, request)

    const { blocks } = yield* toPdfBlocks(ast.nodes, request, options.resolveAsset, policy)
    const fontEntries = yield* loadFontEntries(textValues(ast.nodes))

    const params: PdfDocumentParams = {
      title: `${context.source.type} ${context.source.id}`,
      blocks,
      fontEntries,
      metadata: { author: "RITSEI" },
    }

    const layout = makePdfLayout(policy)
    const inspection = yield* inspectPdfLayout(params, layout)
    yield* validatePageCount(inspection.totalPages, policy)
    const bytes = yield* generatePdfBytes(params, layout)

    if (bytes.byteLength > policy.maxOutputBytes) {
      return yield* Effect.fail(
        new DocumentRenderLimitExceeded({
          limit: "output_bytes",
          actual: bytes.byteLength,
          maximum: policy.maxOutputBytes,
        }),
      )
    }

    return yield* makeDocumentArtifact(request, bytes, inspection.totalPages)
  })

export const makePdfNativeDocumentRenderer = (
  options: PdfNativeRendererOptions = {},
): DocumentRenderer => {
  const policy = options.policy ?? defaultPolicy

  const render = Effect.fn("DocumentRenderer.pdfnative.render")((input: DocumentRenderInput) =>
    renderPdfNativeDocument(input, options, policy),
  )

  return {
    family: "native-transactional",
    render,
  }
}
