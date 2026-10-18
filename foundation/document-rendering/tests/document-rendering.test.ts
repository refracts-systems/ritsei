import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import {
  canonicalizeJson,
  DocumentArtifactConflict,
  DocumentArtifactStaleWriter,
  DocumentRenderLimitExceeded,
  DocumentRenderPolicyViolation,
  makeDocumentRenderJobPayload,
  makeDocumentRenderRequest,
  makeDocumentSnapshot,
  makeMemoryDocumentArtifactStore,
  sha256Hex,
  validateDocumentRenderPolicy,
} from "../mod.ts"

const tenantId = "018f0000-0000-7000-8000-000000000001"
const snapshotId = "018f0000-0000-7000-8000-000000000002"
const astId = "018f0000-0000-7000-8000-000000000003"
const artifactId = "018f0000-0000-7000-8000-000000000004"
const sourceId = "018f0000-0000-7000-8000-000000000005"
const timestamp = "2026-09-06T00:00:00.000Z"
const hashA = "a".repeat(64)
const hashB = "b".repeat(64)

const requestInput = (correlationId = "document-correlation") => ({
  tenantId,
  snapshotId,
  snapshotChecksum: hashA,
  astId,
  astChecksum: hashB,
  templateId: "purchase-order-default",
  templateVersion: 1,
  documentSchemaVersion: 1,
  rendererFamily: "static-html" as const,
  rendererVersion: "contract-test",
  assetVersions: [],
  capabilities: ["css", "paged-media"] as const,
  astNodeCount: 6,
  pageCount: 1,
  assetBytes: 0,
  correlationId,
})

describe("document rendering contracts", () => {
  it("canonicalizes object key order", () => {
    assert.strictEqual(
      canonicalizeJson({ z: 1, a: { d: 2, c: [true, null] } }),
      canonicalizeJson({ a: { c: [true, null], d: 2 }, z: 1 }),
    )
  })

  it.effect("creates deterministic snapshots and render job identity", () =>
    Effect.gen(function*() {
      const first = yield* makeDocumentSnapshot({
        snapshotId,
        tenantId,
        source: { owner: "procurement", type: "purchase_order", id: sourceId },
        capturedAt: timestamp,
        schemaVersion: 1,
        payload: { total: "12.50", lines: [{ quantity: "1" }] },
      })
      const second = yield* makeDocumentSnapshot({
        snapshotId,
        tenantId,
        source: { owner: "procurement", type: "purchase_order", id: sourceId },
        capturedAt: "2026-09-06T01:00:00.000Z",
        schemaVersion: 1,
        payload: { lines: [{ quantity: "1" }], total: "12.50" },
      })
      assert.strictEqual(first.checksum, second.checksum)

      const request = yield* makeDocumentRenderRequest(requestInput())
      const replay = yield* makeDocumentRenderRequest(requestInput("different-correlation"))
      assert.strictEqual(request.renderFingerprint, replay.renderFingerprint)
      assert.strictEqual(request.fenceScope, replay.fenceScope)

      const job = yield* makeDocumentRenderJobPayload(request)
      assert.strictEqual(
        job.idempotencyKey,
        `document-render:${tenantId}:${request.renderFingerprint}`,
      )
      assert.strictEqual(job.fenceScope, request.fenceScope)
      assert.strictEqual(job.jobVersion, 1)
    }))

  it.effect("rejects static HTML capabilities that require JavaScript", () =>
    Effect.gen(function*() {
      const requirements = {
        ...requestInput(),
        capabilities: ["css", "javascript"] as const,
      }
      const policy = {
        rendererFamily: "static-html" as const,
        capabilities: ["css", "javascript"] as const,
        allowJavaScript: false,
        allowNetwork: false,
        maxAstNodes: 10,
        maxPages: 2,
        maxAssetBytes: 1_024,
      }
      const error = yield* Effect.flip(validateDocumentRenderPolicy(requirements, policy))
      assert.instanceOf(error, DocumentRenderPolicyViolation)
      assert.strictEqual(error.reason, "javascript_disabled")
    }))

  it.effect("rejects render inputs over the declared budget", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(validateDocumentRenderPolicy(
        requestInput(),
        {
          rendererFamily: "static-html",
          capabilities: ["css", "paged-media"],
          allowJavaScript: false,
          allowNetwork: false,
          maxAstNodes: 5,
          maxPages: 1,
          maxAssetBytes: 0,
        },
      ))
      assert.instanceOf(error, DocumentRenderLimitExceeded)
      assert.strictEqual(error.limit, "ast_nodes")
      assert.strictEqual(error.actual, 6)
    }))

  it.effect("deduplicates artifacts and rejects stale writers", () =>
    Effect.gen(function*() {
      const store = makeMemoryDocumentArtifactStore()
      const bytes = new Uint8Array([1, 2, 3])
      const contentHash = yield* sha256Hex(bytes)
      const metadata = {
        artifactId,
        tenantId,
        snapshotId,
        astId,
        templateId: "purchase-order-default",
        templateVersion: 1,
        documentSchemaVersion: 1,
        rendererFamily: "native-transactional" as const,
        rendererVersion: "contract-test",
        assetVersions: [],
        renderFingerprint: hashA,
        contentHash,
        mediaType: "application/json",
        byteLength: bytes.byteLength,
        pageCount: 1,
        status: "ready" as const,
        createdAt: timestamp,
      }
      const first = yield* store.put({
        metadata,
        bytes,
        fencing: { scope: "document-render:scope", generation: "1" },
      })
      const replay = yield* store.put({
        metadata: { ...metadata, artifactId: "018f0000-0000-7000-8000-000000000006" },
        bytes,
        fencing: { scope: "document-render:scope", generation: "1" },
      })
      assert.strictEqual(replay.artifactId, first.artifactId)

      const stale = yield* Effect.flip(store.put({
        metadata,
        bytes,
        fencing: { scope: "document-render:scope", generation: "0" },
      }))
      assert.instanceOf(stale, DocumentArtifactStaleWriter)

      const conflictBytes = new Uint8Array([1, 2, 3, 4])
      const conflict = yield* Effect.flip(store.put({
        metadata: {
          ...metadata,
          contentHash: yield* sha256Hex(conflictBytes),
          byteLength: conflictBytes.byteLength,
        },
        bytes: conflictBytes,
        fencing: { scope: "document-render:scope", generation: "2" },
      }))
      assert.instanceOf(conflict, DocumentArtifactConflict)

      const stored = yield* store.get({ tenantId, renderFingerprint: hashA })
      assert.isDefined(stored)
      assert.deepStrictEqual([...stored!.bytes], [1, 2, 3])
    }))
})
