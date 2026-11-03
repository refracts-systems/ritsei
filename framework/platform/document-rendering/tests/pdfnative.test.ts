import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
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
  UnsupportedDocumentCapability,
} from "../../../foundation/mod.ts"
import { makePdfNativeDocumentRenderer } from "../mod.ts"

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
  maxPages: 20,
  maxAssetBytes: 100_000,
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

    const request = yield* createDocumentRenderRequest({
      tenantId,
      snapshotId,
      snapshotChecksum: snapshot.checksum,
      astId: ast.astId,
      astChecksum: ast.checksum,
      templateId: "purchase-order-default",
      templateVersion: 1,
      documentSchemaVersion: 1,
      rendererFamily: "native-transactional",
      rendererVersion: "pdfnative@1.7.0",
      assetVersions: ["logo-v1", "signature-v1"],
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

  it.effect("passes the verified tenant to the asset resolver", () =>
    Effect.gen(function* () {
      const input = yield* renderInput()
      const resolvedTenants: string[] = []

      const scopedRenderer = makePdfNativeDocumentRenderer({
        policy,
        resolveAsset: ({ tenantId: assetTenant }) => {
          resolvedTenants.push(assetTenant)

          return Effect.succeed(assetTenant === tenantId ? pngBytes : undefined)
        },
      })

      yield* scopedRenderer.render(input)
      assert.deepStrictEqual(resolvedTenants, [tenantId, tenantId])

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
      assert.strictEqual(resolvedTenants.at(-1), otherTenantId)
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
