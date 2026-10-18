import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
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
  sha256Hex,
  validateDocumentRenderPolicy,
} from "../../foundation/mod.ts"

const fontLoader = (load: () => Promise<unknown>): FontLoader => async () => {
  const module = await load()
  const font = typeof module === "object" && module !== null && "default" in module
    ? module.default
    : module
  if (
    typeof font !== "object" || font === null || !("fontName" in font)
    || !("ttfBase64" in font)
  ) {
    throw new TypeError("pdfnative font module did not expose FontData")
  }
  // pdfnative's generated font declarations describe module fields loosely; the runtime object is
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

const deterministicCreationDate = new Date("2000-01-01T00:00:00.000Z")

const defaultPolicy: DocumentRenderPolicy = {
  rendererFamily: "native-transactional",
  capabilities: ["svg"],
  allowJavaScript: false,
  allowNetwork: false,
  maxAstNodes: 100_000,
  maxPages: 10_000,
  maxAssetBytes: 50_000_000,
}

export type PdfNativeAssetResolver = (
  assetId: string,
) => Effect.Effect<
  Uint8Array | undefined,
  DocumentAssetUnavailable | DocumentRendererFailure
>

export type PdfNativeRendererOptions = {
  readonly policy?: DocumentRenderPolicy
  readonly resolveAsset?: PdfNativeAssetResolver
  readonly layout?: Partial<PdfLayoutOptions>
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
      return loaded.filter((entry): entry is { fontData: FontData; lang: string } =>
        entry !== undefined
      )
        .map(({ fontData, lang }, index) => ({
          fontData,
          fontRef: `/F${index + 1}`,
          lang,
        }))
    },
    catch: (cause) => rendererFailure("font-loading", "unable to load registered fonts", cause),
  })

const loadAsset = (
  assetId: string,
  resolveAsset: PdfNativeAssetResolver | undefined,
) =>
  Effect.gen(function*() {
    const bytes = resolveAsset === undefined ? undefined : yield* resolveAsset(assetId)
    if (bytes === undefined) {
      return yield* Effect.fail(
        new DocumentAssetUnavailable({
          assetId,
          reason: "the renderer has no asset bytes for this asset",
        }),
      )
    }
    if (detectImageFormat(bytes) === null) {
      return yield* Effect.fail(
        rendererFailure("asset-loading", "asset is not a supported PNG or JPEG image", { assetId }),
      )
    }
    return bytes
  })

type StaticDocumentNode = Exclude<DocumentNode, { _tag: "image" | "signature" }>

const toStaticPdfBlock = (node: StaticDocumentNode): PdfDocumentBlock => {
  switch (node._tag) {
    case "text":
      return { type: "paragraph", text: node.value }
    case "table":
      return {
        type: "table",
        headers: node.headers,
        rows: node.rows.map((cells) => ({ cells, type: "default", pointed: false })),
        repeatHeader: true,
        wrap: "auto",
      }
    case "divider":
      return {
        type: "svg",
        data: "M 0 0 L 460 0",
        width: 460,
        height: 1,
        fill: "none",
        stroke: "#CBD5E1",
        strokeWidth: 0.5,
        alt: "divider",
      }
    case "spacer":
      return { type: "spacer", height: node.heightPx }
    case "page_break":
      return { type: "pageBreak" }
    case "barcode":
      return { type: "barcode", format: "code128", data: node.value, align: "center" }
    case "qr_code":
      return { type: "barcode", format: "qr", data: node.value, align: "center" }
  }
}

const toImageBlocks = (
  node: Extract<DocumentNode, { _tag: "image" }>,
  resolveAsset: PdfNativeAssetResolver | undefined,
) =>
  Effect.gen(function*() {
    const bytes = yield* loadAsset(node.assetId, resolveAsset)
    const blocks: PdfDocumentBlock[] = [{
      type: "image",
      data: bytes,
      alt: node.alt,
      align: "center",
    }]
    return { blocks, assetBytes: bytes.byteLength }
  })

const toSignatureBlocks = (
  node: Extract<DocumentNode, { _tag: "signature" }>,
  resolveAsset: PdfNativeAssetResolver | undefined,
) =>
  Effect.gen(function*() {
    const bytes = yield* loadAsset(node.assetId, resolveAsset)
    const blocks: PdfDocumentBlock[] = [
      { type: "paragraph", text: node.label },
      { type: "image", data: bytes, alt: node.label, align: "center" },
    ]
    return { blocks, assetBytes: bytes.byteLength }
  })

const toPdfBlocks = (
  nodes: ReadonlyArray<DocumentNode>,
  resolveAsset: PdfNativeAssetResolver | undefined,
) =>
  Effect.gen(function*() {
    const blockResults = yield* Effect.all(
      nodes.map((node) => {
        switch (node._tag) {
          case "image":
            return toImageBlocks(node, resolveAsset)
          case "signature":
            return toSignatureBlocks(node, resolveAsset)
          default:
            return Effect.succeed({ blocks: [toStaticPdfBlock(node)], assetBytes: 0 })
        }
      }),
    )
    const result = { blocks: [] as PdfDocumentBlock[], assetBytes: 0 }
    for (const blockResult of blockResults) {
      result.blocks.push(...blockResult.blocks)
      result.assetBytes += blockResult.assetBytes
    }
    return result
  })

const decodeInput = (input: DocumentRenderInput) =>
  Effect.gen(function*() {
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
    context.tenantId !== request.tenantId
    || context.snapshotId !== request.snapshotId
    || context.snapshotChecksum !== request.snapshotChecksum
  ) {
    return Effect.fail(
      rendererFailure(
        "input-validation",
        "document context does not match the render request snapshot",
        undefined,
      ),
    )
  }
  if (ast.snapshotId !== request.snapshotId || ast.checksum !== request.astChecksum) {
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

const valueOr = <T>(value: T | undefined, fallback: T): T => value === undefined ? fallback : value

const makePdfLayout = (
  options: PdfNativeRendererOptions,
  policy: DocumentRenderPolicy,
): Partial<PdfLayoutOptions> => {
  const provided = options.layout ?? {}
  return {
    ...provided,
    // PDF metadata must not introduce wall-clock or snapshot-capture variance into artifact bytes.
    creationDate: deterministicCreationDate,
    maxBlocks: Math.min(valueOr(provided.maxBlocks, policy.maxAstNodes), policy.maxAstNodes),
    tagged: valueOr(provided.tagged, "pdfa2u"),
    strict: valueOr(provided.strict, true),
    compress: valueOr(provided.compress, false),
    onDiagnostic: valueOr(provided.onDiagnostic, () => undefined),
  }
}

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
  Effect.gen(function*() {
    const contentHash = yield* sha256Hex(bytes)
    const metadata = yield* Schema.decodeUnknownEffect(DocumentArtifact)({
      artifactId: uuidv7(),
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
  Effect.gen(function*() {
    const { context, ast, request } = yield* decodeInput(input)
    yield* validateInputReferences(context, ast, request)
    yield* validateDocumentRenderPolicy(request, policy)

    const { blocks, assetBytes } = yield* toPdfBlocks(ast.nodes, options.resolveAsset)
    yield* validateAssetBytes(assetBytes, policy)
    const fontEntries = yield* loadFontEntries(textValues(ast.nodes))
    const params: PdfDocumentParams = {
      title: `${context.source.type} ${context.source.id}`,
      blocks,
      fontEntries,
      metadata: { author: "RITSEI" },
    }
    const layout = makePdfLayout(options, policy)
    const inspection = yield* inspectPdfLayout(params, layout)
    yield* validatePageCount(inspection.totalPages, policy)
    const bytes = yield* generatePdfBytes(params, layout)
    return yield* makeDocumentArtifact(request, bytes, inspection.totalPages)
  })

export const makePdfNativeDocumentRenderer = (
  options: PdfNativeRendererOptions = {},
): DocumentRenderer => {
  const policy = options.policy ?? defaultPolicy
  const render = Effect.fn("DocumentRenderer.pdfnative.render")((input: DocumentRenderInput) =>
    renderPdfNativeDocument(input, options, policy)
  )

  return {
    family: "native-transactional",
    render,
  }
}
