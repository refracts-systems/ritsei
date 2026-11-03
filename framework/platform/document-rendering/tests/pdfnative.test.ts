import { assert, describe, it } from "@effect/vitest"
import { execFileSync } from "node:child_process"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { extractText, validatePdfUA } from "pdfnative"

import {
  DocumentAssetUnavailable,
  DocumentBarcodeNode,
  documentContextFromSnapshot,
  DocumentDividerNode,
  DocumentImageNode,
  DocumentPageBreakNode,
  DocumentQrCodeNode,
  DocumentRenderInput,
  DocumentRendererFailure,
  DocumentRenderLimitExceeded,
  type DocumentRenderPolicy,
  DocumentSignatureNode,
  DocumentTableNode,
  DocumentTextNode,
  createDocumentAst,
  createDocumentRenderRequest,
  createDocumentSnapshot,
  sha256Hex,
  UnsupportedDocumentCapability,
} from "../../../foundation/mod.ts"
import { makePdfNativeDocumentRenderer, pdfNativeRendererVersion } from "../mod.ts"

const tenantId = "018f0000-0000-7000-8000-000000000001"
const snapshotId = "018f0000-0000-7000-8000-000000000002"
const astId = "018f0000-0000-7000-8000-000000000003"
const sourceId = "018f0000-0000-7000-8000-000000000004"
const timestamp = "2026-09-06T00:00:00.000Z"
const multilingualText = "فاتورة شراء / 仕入注文 / 구매 주문"

const pngBytes = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR42mNk+M/wHwAF/gL+U5gAAAAASUVORK5CYII=",
  ),
  (character) => character.charCodeAt(0),
)

const policy: DocumentRenderPolicy = {
  rendererFamily: "native-transactional",
  capabilities: ["svg"],
  allowJavaScript: false,
  allowNetwork: false,
  maxAstNodes: 100,
  maxTableRows: 1_000,
  maxPages: 20,
  maxAssetBytes: 100_000,
  maxImagePixels: 1_000_000,
  maxOutputBytes: 2_000_000,
}

const renderInput = () =>
  Effect.gen(function* () {
    const snapshot = yield* createDocumentSnapshot({
      snapshotId,
      tenantId,
      source: { owner: "procurement", type: "purchase_order", id: sourceId },
      capturedAt: timestamp,
      schemaVersion: 1,
      payload: { status: "confirmed", total: "25.00" },
    })

    const context = documentContextFromSnapshot(snapshot)

    const ast = yield* createDocumentAst({
      astId,
      snapshotId,
      documentType: "purchase_order",
      astVersion: 1,
      nodes: [
        DocumentTextNode.make({ value: "PURCHASE ORDER" }),
        DocumentTextNode.make({ value: multilingualText }),
        DocumentTableNode.make({
          headers: ["Item", "Quantity", "Unit Price"],
          rows: Array.from({ length: 80 }, (_, index) => [`ITEM-${index + 1}`, "2", "12.50"]),
        }),
        DocumentDividerNode.make({}),
        DocumentImageNode.make({ assetId: "logo-v1", alt: "Company logo" }),
        DocumentBarcodeNode.make({ value: "PO-2026-0001" }),
        DocumentQrCodeNode.make({ value: "https://example.invalid/po/0001" }),
        DocumentSignatureNode.make({ assetId: "signature-v1", label: "Approved by" }),
      ],
    })

    const assetHash = yield* sha256Hex(pngBytes)

    const request = yield* createDocumentRenderRequest({
      fingerprintVersion: 2,
      tenantId,
      snapshotId,
      snapshotChecksum: snapshot.checksum,
      astId: ast.astId,
      astChecksum: ast.checksum,
      templateId: "purchase-order-default",
      templateVersion: 1,
      documentSchemaVersion: 1,
      rendererFamily: "native-transactional",
      rendererVersion: pdfNativeRendererVersion,
      assetVersions: [
        { assetId: "logo-v1", version: "1", contentHash: assetHash },
        { assetId: "signature-v1", version: "2", contentHash: assetHash },
      ],
      capabilities: ["svg"],
      astNodeCount: ast.nodes.length,
      pageCount: 20,
      assetBytes: pngBytes.byteLength * 2,
      correlationId: "pdfnative-conformance",
    })

    return { context, ast, request } satisfies DocumentRenderInput
  })

const renderer = makePdfNativeDocumentRenderer({
  policy,
  resolveAsset: ({ assetId }) =>
    Effect.succeed(assetId === "logo-v1" || assetId === "signature-v1" ? pngBytes : undefined),
})

describe("pdfnative document renderer", () => {
  it.effect("renders the benchmark corpus with identical bytes across process timezones", () =>
    Effect.gen(function* () {
      const benchmark = (timezone: string) =>
        Effect.sync(() =>
          execFileSync(
            process.execPath,
            ["--import", "tsx", "tooling/document-rendering/benchmark.ts", "1"],
            {
              encoding: "utf8",
              env: { ...process.env, TZ: timezone },
              timeout: 25_000,
            },
          ),
        )

      const benchmarkResult = Schema.Struct({
        fixtures: Schema.Array(
          Schema.Struct({
            name: Schema.String,
            contentHash: Schema.optionalKey(Schema.String),
            skipped: Schema.optionalKey(Schema.Boolean),
          }),
        ),
      })

      const utc = yield* Schema.decodeUnknownEffect(benchmarkResult)(
        JSON.parse(yield* benchmark("UTC")),
      )

      const bangkok = yield* Schema.decodeUnknownEffect(benchmarkResult)(
        JSON.parse(yield* benchmark("Asia/Bangkok")),
      )

      const evidence = (result: typeof utc) =>
        result.fixtures
          .filter((fixture) => fixture.skipped !== true)
          .map(({ name, contentHash }) => ({ name, contentHash }))

      assert.isAbove(evidence(utc).length, 1)
      assert.isTrue(evidence(utc).every((fixture) => fixture.contentHash !== undefined))
      assert.deepStrictEqual(evidence(utc), evidence(bangkok))
    }),
  )

  it.effect("renders the AST corpus with deterministic PDF bytes", () =>
    Effect.gen(function* () {
      const input = yield* renderInput()
      const first = yield* renderer.render(input)
      const second = yield* renderer.render(input)

      assert.strictEqual(first.metadata.status, "ready")
      assert.strictEqual(input.context.capturedAt, timestamp)
      assert.deepStrictEqual([...first.bytes], [...second.bytes])
      assert.strictEqual(first.metadata.contentHash, second.metadata.contentHash)
      assert.strictEqual(first.metadata.renderFingerprint, second.metadata.renderFingerprint)
      assert.strictEqual(first.metadata.fingerprintVersion, 2)
      assert.deepStrictEqual(first.metadata.assetVersions, input.request.assetVersions)
      assert.strictEqual(first.metadata.mediaType, "application/pdf")
      assert.isAbove(first.metadata.pageCount, 1)
      assert.strictEqual(String.fromCharCode(...first.bytes.slice(0, 5)), "%PDF-")

      const pages = extractText(first.bytes).map((page) => page.text)
      const text = pages.join("\n")

      assert.include(text, "PURCHASE ORDER")
      assert.include(text.normalize("NFKC"), "仕入注文")
      assert.include(text, "구매 주문")

      // pdfnative's extractor reads ToUnicode in visual order, not tagged /ActualText.
      const actualText = Buffer.from(multilingualText, "utf16le")
        .swap16()
        .toString("hex")
        .toUpperCase()

      assert.include(
        new TextDecoder("latin1").decode(first.bytes),
        `/ActualText <FEFF${actualText}>`,
      )

      const pdf = new TextDecoder("latin1").decode(first.bytes)
      const fontResources = [...pdf.matchAll(/\/Font <<\s*([^>]*)>>/g)]
      assert.isAbove(fontResources.length, 0)

      for (const [, resource] of fontResources) {
        const fontNames = [...resource.matchAll(/\/(\S+)\s+\d+\s+\d+\s+R/g)].map(
          (match) => match[1],
        )

        assert.isAbove(fontNames.length, 0)
        assert.strictEqual(new Set(fontNames).size, fontNames.length)
      }

      const tablePages = pages.filter((page) => /ITEM-\d+/.test(page))
      assert.isAbove(tablePages.length, 1)

      for (const page of tablePages) {
        assert.include(page, "Item")
        assert.include(page, "Quantity")
        assert.include(page, "Unit Price")
      }

      const rows = text.match(/ITEM-\d+/g) ?? []
      assert.deepStrictEqual(
        rows,
        Array.from({ length: 80 }, (_, index) => `ITEM-${index + 1}`),
      )
      assert.isTrue(validatePdfUA(first.bytes).valid)
    }),
  )

  it.effect("places content after an explicit page break on a new page", () =>
    Effect.gen(function* () {
      const input = yield* renderInput()

      const ast = yield* createDocumentAst({
        astId,
        snapshotId,
        documentType: "purchase_order",
        astVersion: 1,
        nodes: [
          DocumentTextNode.make({ value: "BEFORE BREAK" }),
          DocumentPageBreakNode.make({}),
          DocumentTextNode.make({ value: "AFTER BREAK" }),
        ],
      })

      const request = yield* createDocumentRenderRequest({
        ...input.request,
        astChecksum: ast.checksum,
        astNodeCount: ast.nodes.length,
      })

      const result = yield* renderer.render({ ...input, ast, request })
      const pages = extractText(result.bytes).map((page) => page.text)

      assert.strictEqual(pages.length, 2)
      assert.include(pages[0], "BEFORE BREAK")
      assert.notInclude(pages[0], "AFTER BREAK")
      assert.include(pages[1], "AFTER BREAK")
    }),
  )

  it.effect("rejects a request for a different renderer version", () =>
    Effect.gen(function* () {
      const input = yield* renderInput()

      const request = yield* createDocumentRenderRequest({
        ...input.request,
        rendererVersion: "pdfnative@0.0.0",
      })

      const failure = yield* Effect.flip(renderer.render({ ...input, request }))
      assert.instanceOf(failure, DocumentRendererFailure)
      assert.strictEqual(failure.operation, "input-validation")
    }),
  )

  it.effect("rejects provider layout options that are not bound to the fingerprint", () =>
    Effect.gen(function* () {
      const input = yield* renderInput()
      const options = { policy }
      Reflect.set(options, "layout", { headerTemplate: "{date}" })

      const failure = yield* Effect.flip(makePdfNativeDocumentRenderer(options).render(input))
      assert.instanceOf(failure, DocumentRendererFailure)
      assert.strictEqual(failure.operation, "input-validation")
    }),
  )

  it.effect("fails closed when the native policy does not support a capability", () =>
    Effect.gen(function* () {
      const input = yield* renderInput()

      const unsupported = yield* Effect.flip(
        renderer.render({
          ...input,
          request: { ...input.request, capabilities: ["paged-media"] },
        }),
      )

      assert.instanceOf(unsupported, UnsupportedDocumentCapability)
    }),
  )

  it.effect("rejects render input whose content or identity does not match its checksums", () =>
    Effect.gen(function* () {
      const input = yield* renderInput()
      const changedId = "018f0000-0000-7000-8000-000000000099"

      const understatedRequest = yield* createDocumentRenderRequest({
        ...input.request,
        astNodeCount: 1,
      })

      const tamperedInputs: ReadonlyArray<DocumentRenderInput> = [
        { ...input, ast: { ...input.ast, astId: changedId } },
        {
          ...input,
          ast: {
            ...input.ast,
            nodes: [DocumentTextNode.make({ value: "CHANGED" }), ...input.ast.nodes.slice(1)],
          },
        },
        { ...input, context: { ...input.context, data: { total: "99.00" } } },
        {
          ...input,
          context: { ...input.context, source: { ...input.context.source, id: changedId } },
        },
        { ...input, context: { ...input.context, schemaVersion: 2 } },
        { ...input, request: { ...input.request, renderFingerprint: "a".repeat(64) } },
        { ...input, request: { ...input.request, fenceScope: "changed-scope" } },
        { ...input, request: understatedRequest },
      ]

      for (const tampered of tamperedInputs) {
        const failure = yield* Effect.flip(renderer.render(tampered))
        assert.instanceOf(failure, DocumentRendererFailure)
        assert.strictEqual(failure.operation, "input-validation")
      }
    }),
  )

  it.effect("rejects an understated node count before rendering", () =>
    Effect.gen(function* () {
      const input = yield* renderInput()

      const ast = yield* createDocumentAst({
        ...input.ast,
        nodes: Array.from({ length: policy.maxAstNodes + 1 }, () =>
          DocumentTextNode.make({ value: "ROW" }),
        ),
      })

      const request = yield* createDocumentRenderRequest({
        ...input.request,
        astChecksum: ast.checksum,
        astNodeCount: 1,
      })

      const failure = yield* Effect.flip(renderer.render({ ...input, ast, request }))
      assert.instanceOf(failure, DocumentRenderLimitExceeded)
      assert.strictEqual(failure.limit, "ast_nodes")
      assert.strictEqual(failure.actual, policy.maxAstNodes + 1)
    }),
  )

  it.effect("passes the verified tenant and asset version to the resolver", () =>
    Effect.gen(function* () {
      const input = yield* renderInput()
      const resolvedAssets: { tenantId: string; assetId: string; version: string }[] = []

      const scopedRenderer = makePdfNativeDocumentRenderer({
        policy,
        resolveAsset: (asset) => {
          resolvedAssets.push(asset)

          return Effect.succeed(asset.tenantId === tenantId ? pngBytes : undefined)
        },
      })

      yield* scopedRenderer.render(input)
      assert.deepStrictEqual(resolvedAssets, [
        { tenantId, assetId: "logo-v1", version: "1" },
        { tenantId, assetId: "signature-v1", version: "2" },
      ])

      const otherTenantId = "018f0000-0000-7000-8000-000000000099"

      const otherSnapshot = yield* createDocumentSnapshot({
        snapshotId,
        tenantId: otherTenantId,
        source: input.context.source,
        capturedAt: input.context.capturedAt,
        schemaVersion: input.context.schemaVersion,
        payload: input.context.data,
      })

      const otherRequest = yield* createDocumentRenderRequest({
        ...input.request,
        tenantId: otherTenantId,
        snapshotChecksum: otherSnapshot.checksum,
      })

      const missing = yield* Effect.flip(
        scopedRenderer.render({
          ...input,
          context: documentContextFromSnapshot(otherSnapshot),
          request: otherRequest,
        }),
      )

      assert.instanceOf(missing, DocumentAssetUnavailable)
      assert.strictEqual(resolvedAssets.at(-1)?.tenantId, otherTenantId)
    }),
  )

  it.effect("stops resolving assets once the total byte limit is exceeded", () =>
    Effect.gen(function* () {
      const input = yield* renderInput()
      const resolvedIds: string[] = []

      const limitedRenderer = makePdfNativeDocumentRenderer({
        policy: { ...policy, maxAssetBytes: pngBytes.byteLength },
        resolveAsset: ({ assetId }) => {
          resolvedIds.push(assetId)

          return Effect.succeed(pngBytes)
        },
      })

      const ast = yield* createDocumentAst({
        ...input.ast,
        nodes: [
          ...input.ast.nodes,
          DocumentImageNode.make({ assetId: "extra-v1", alt: "Additional image" }),
        ],
      })

      const request = yield* createDocumentRenderRequest({
        ...input.request,
        astChecksum: ast.checksum,
        astNodeCount: ast.nodes.length,
        assetBytes: 0,
      })

      const failure = yield* Effect.flip(limitedRenderer.render({ ...input, ast, request }))
      assert.instanceOf(failure, DocumentRenderLimitExceeded)
      assert.strictEqual(failure.limit, "asset_bytes")
      assert.strictEqual(failure.actual, pngBytes.byteLength * 2)
      assert.deepStrictEqual(resolvedIds, ["logo-v1", "signature-v1"])
    }),
  )

  it.effect("rejects tables exceeding the total row budget", () =>
    Effect.gen(function* () {
      const input = yield* renderInput()

      const ast = yield* createDocumentAst({
        ...input.ast,
        nodes: [
          DocumentTableNode.make({ headers: ["Item"], rows: [["First"]] }),
          DocumentTableNode.make({ headers: ["Item"], rows: [["Second"]] }),
        ],
      })

      const request = yield* createDocumentRenderRequest({
        ...input.request,
        astChecksum: ast.checksum,
        astNodeCount: ast.nodes.length,
      })

      const limitedRenderer = makePdfNativeDocumentRenderer({
        policy: { ...policy, maxTableRows: 1 },
      })

      const failure = yield* Effect.flip(limitedRenderer.render({ ...input, ast, request }))
      assert.instanceOf(failure, DocumentRenderLimitExceeded)
      assert.strictEqual(failure.limit, "table_rows")
      assert.strictEqual(failure.actual, 2)
      assert.strictEqual(failure.maximum, 1)
    }),
  )

  it.effect("rejects generated PDFs exceeding the output byte limit", () =>
    Effect.gen(function* () {
      const input = yield* renderInput()

      const limitedRenderer = makePdfNativeDocumentRenderer({
        policy: { ...policy, maxOutputBytes: 1 },
        resolveAsset: () => Effect.succeed(pngBytes),
      })

      const failure = yield* Effect.flip(limitedRenderer.render(input))
      assert.instanceOf(failure, DocumentRenderLimitExceeded)
      assert.strictEqual(failure.limit, "output_bytes")
      assert.isAbove(failure.actual, 1)
      assert.strictEqual(failure.maximum, 1)
    }),
  )

  it.effect("rejects images exceeding the pixel budget before rendering", () =>
    Effect.gen(function* () {
      const input = yield* renderInput()
      const oversized = Uint8Array.from(pngBytes)
      const header = new DataView(oversized.buffer)
      header.setUint32(16, 2)
      header.setUint32(20, 2)
      const contentHash = yield* sha256Hex(oversized)

      const request = yield* createDocumentRenderRequest({
        ...input.request,
        assetVersions: input.request.assetVersions.map((asset) =>
          asset.assetId === "logo-v1" ? { ...asset, contentHash } : asset,
        ),
      })

      const limitedRenderer = makePdfNativeDocumentRenderer({
        policy: { ...policy, maxImagePixels: 1 },
        resolveAsset: () => Effect.succeed(oversized),
      })

      const failure = yield* Effect.flip(limitedRenderer.render({ ...input, request }))
      assert.instanceOf(failure, DocumentRenderLimitExceeded)
      assert.strictEqual(failure.limit, "image_pixels")
      assert.strictEqual(failure.actual, 4)
      assert.strictEqual(failure.maximum, 1)
    }),
  )

  it.effect("rejects assets that are absent from the manifest before calling the resolver", () =>
    Effect.gen(function* () {
      const input = yield* renderInput()
      let calls = 0

      const unmanifestedRequest = yield* createDocumentRenderRequest({
        ...input.request,
        assetVersions: input.request.assetVersions.filter((asset) => asset.assetId !== "logo-v1"),
      })

      const scopedRenderer = makePdfNativeDocumentRenderer({
        policy,
        resolveAsset: () => {
          calls += 1

          return Effect.succeed(pngBytes)
        },
      })

      const failure = yield* Effect.flip(
        scopedRenderer.render({ ...input, request: unmanifestedRequest }),
      )

      assert.instanceOf(failure, DocumentAssetUnavailable)
      assert.strictEqual(failure.assetId, "logo-v1")
      assert.strictEqual(calls, 0)
    }),
  )

  it.effect("rejects asset bytes that do not match the versioned content hash", () =>
    Effect.gen(function* () {
      const input = yield* renderInput()

      const changedRenderer = makePdfNativeDocumentRenderer({
        policy,
        resolveAsset: () => Effect.succeed(Uint8Array.from([1, 2, 3])),
      })

      const failure = yield* Effect.flip(changedRenderer.render(input))
      assert.instanceOf(failure, DocumentAssetUnavailable)
      assert.strictEqual(failure.assetId, "logo-v1")
      assert.strictEqual(failure.reason, "asset content does not match its version")
    }),
  )

  it.effect("renders the verified copy if the resolver mutates its original bytes", () =>
    Effect.gen(function* () {
      const input = yield* renderInput()
      const baseline = yield* renderer.render(input)
      const mutableBytes = Uint8Array.from(pngBytes)

      const mutableRenderer = makePdfNativeDocumentRenderer({
        policy,
        resolveAsset: ({ assetId }) => {
          if (assetId === "logo-v1") return Effect.succeed(mutableBytes)

          mutableBytes.fill(0)

          return Effect.succeed(pngBytes)
        },
      })

      const result = yield* mutableRenderer.render(input)
      assert.deepStrictEqual([...result.bytes], [...baseline.bytes])
    }),
  )

  it.effect("reports a missing asset as a typed failure", () =>
    Effect.gen(function* () {
      const input = yield* renderInput()

      const missingAssetRenderer = makePdfNativeDocumentRenderer({
        policy,
        resolveAsset: () => Effect.succeed(undefined),
      })

      const missing = yield* Effect.flip(missingAssetRenderer.render(input))
      assert.instanceOf(missing, DocumentAssetUnavailable)
    }),
  )
})
