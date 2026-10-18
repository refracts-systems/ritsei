import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { extractText, validatePdfUA } from "pdfnative"

import {
  DocumentAssetUnavailable,
  documentContextFromSnapshot,
  DocumentRenderInput,
  type DocumentRenderPolicy,
  makeDocumentAst,
  makeDocumentRenderRequest,
  makeDocumentSnapshot,
  UnsupportedDocumentCapability,
} from "../../../foundation/mod.ts"
import { makePdfNativeDocumentRenderer } from "../mod.ts"

const tenantId = "018f0000-0000-7000-8000-000000000001"
const snapshotId = "018f0000-0000-7000-8000-000000000002"
const astId = "018f0000-0000-7000-8000-000000000003"
const sourceId = "018f0000-0000-7000-8000-000000000004"
const timestamp = "2026-09-06T00:00:00.000Z"

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
  Effect.gen(function*() {
    const snapshot = yield* makeDocumentSnapshot({
      snapshotId,
      tenantId,
      source: { owner: "procurement", type: "purchase_order", id: sourceId },
      capturedAt: timestamp,
      schemaVersion: 1,
      payload: { status: "confirmed", total: "25.00" },
    })
    const context = documentContextFromSnapshot(snapshot)
    const ast = yield* makeDocumentAst({
      astId,
      snapshotId,
      documentType: "purchase_order",
      astVersion: 1,
      nodes: [
        { _tag: "text", value: "PURCHASE ORDER" },
        { _tag: "text", value: "فاتورة شراء / 仕入注文 / 구매 주문" },
        {
          _tag: "table",
          headers: ["Item", "Quantity", "Unit Price"],
          rows: Array.from({ length: 80 }, (_, index) => [
            `ITEM-${index + 1}`,
            "2",
            "12.50",
          ]),
        },
        { _tag: "divider" },
        { _tag: "image", assetId: "logo-v1", alt: "Company logo" },
        { _tag: "barcode", value: "PO-2026-0001" },
        { _tag: "qr_code", value: "https://example.invalid/po/0001" },
        { _tag: "signature", assetId: "signature-v1", label: "Approved by" },
      ],
    })
    const request = yield* makeDocumentRenderRequest({
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
  resolveAsset: (assetId) =>
    Effect.succeed(assetId === "logo-v1" || assetId === "signature-v1" ? pngBytes : undefined),
})

describe("pdfnative document renderer", () => {
  it.effect("renders the AST corpus with deterministic PDF bytes", () =>
    Effect.gen(function*() {
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

      const text = extractText(first.bytes).map((page) => page.text).join("\n")
      assert.include(text, "PURCHASE ORDER")
      assert.isTrue(validatePdfUA(first.bytes).valid)
    }))

  it.effect("fails closed when the native policy does not support a capability", () =>
    Effect.gen(function*() {
      const input = yield* renderInput()
      const unsupported = yield* Effect.flip(renderer.render({
        ...input,
        request: { ...input.request, capabilities: ["paged-media"] },
      }))
      assert.instanceOf(unsupported, UnsupportedDocumentCapability)
    }))

  it.effect("reports a missing asset as a typed failure", () =>
    Effect.gen(function*() {
      const input = yield* renderInput()
      const missingAssetRenderer = makePdfNativeDocumentRenderer({
        policy,
        resolveAsset: () => Effect.succeed(undefined),
      })
      const missing = yield* Effect.flip(missingAssetRenderer.render(input))
      assert.instanceOf(missing, DocumentAssetUnavailable)
    }))
})
