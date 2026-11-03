import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  canonicalizeJson,
  DocumentArtifactConflict,
  DocumentArtifactInvalidContent,
  DocumentArtifactStaleWriter,
  DocumentRenderJobPayload,
  DocumentRenderRequest,
  DocumentRenderLimitExceeded,
  DocumentRenderPolicyViolation,
  makeDocumentRenderJobPayload,
  createDocumentRenderRequest,
  createDocumentSnapshot,
  documentRenderFenceScope,
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
  fingerprintVersion: 2 as const,
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

  it("orders object keys by UTF-16 code units independently of locale", () => {
    assert.strictEqual(
      canonicalizeJson({ é: 1, z: 2, a: 3, A: 4, "😀": 5, "\uE000": 6, _: 7 }),
      '{"A":4,"_":7,"a":3,"z":2,"é":1,"😀":5,"\uE000":6}',
    )
  })

  it.effect("creates deterministic snapshots and render job identity", () =>
    Effect.gen(function* () {
      const first = yield* createDocumentSnapshot({
        snapshotId,
        tenantId,
        source: { owner: "procurement", type: "purchase_order", id: sourceId },
        capturedAt: timestamp,
        schemaVersion: 1,
        payload: { total: "12.50", lines: [{ quantity: "1" }] },
      })

      const second = yield* createDocumentSnapshot({
        snapshotId,
        tenantId,
        source: { owner: "procurement", type: "purchase_order", id: sourceId },
        capturedAt: "2026-09-06T01:00:00.000Z",
        schemaVersion: 1,
        payload: { lines: [{ quantity: "1" }], total: "12.50" },
      })

      assert.strictEqual(first.checksum, second.checksum)

      const request = yield* createDocumentRenderRequest(requestInput())
      const replay = yield* createDocumentRenderRequest(requestInput("different-correlation"))
      assert.strictEqual(request.renderFingerprint, replay.renderFingerprint)
      assert.strictEqual(request.fenceScope, replay.fenceScope)

      const job = yield* makeDocumentRenderJobPayload(request)
      assert.strictEqual(
        job.idempotencyKey,
        `document-render:${tenantId}:${request.renderFingerprint}`,
      )
      assert.strictEqual(job.fenceScope, request.fenceScope)
      assert.strictEqual(job.jobVersion, 2)
      assert.strictEqual(job.fingerprintVersion, 2)
    }),
  )

  it.effect("binds asset identities, versions and bytes to the versioned fingerprint", () =>
    Effect.gen(function* () {
      const asset = { assetId: "logo", version: "1", contentHash: hashA }

      const variants = [
        asset,
        { ...asset, assetId: "logo-other" },
        { ...asset, version: "2" },
        { ...asset, contentHash: hashB },
      ]

      const requests = yield* Effect.all(
        variants.map((entry) =>
          createDocumentRenderRequest({ ...requestInput(), assetVersions: [entry] }),
        ),
      )

      assert.strictEqual(new Set(requests.map((entry) => entry.renderFingerprint)).size, 4)

      const original = requests[0]!

      const otherTenant = yield* createDocumentRenderRequest({
        ...requestInput(),
        tenantId: "018f0000-0000-7000-8000-000000000007",
        assetVersions: [asset],
      })

      assert.notStrictEqual(otherTenant.renderFingerprint, original.renderFingerprint)

      const job = yield* makeDocumentRenderJobPayload(original)
      assert.deepStrictEqual(job.assetVersions, [asset])
      yield* Schema.decodeUnknownEffect(DocumentRenderJobPayload)(job)

      const oldJob = yield* Effect.flip(
        Schema.decodeUnknownEffect(DocumentRenderJobPayload)({ ...job, jobVersion: 1 }),
      )

      const oldRequest = yield* Effect.flip(
        Schema.decodeUnknownEffect(DocumentRenderRequest)({ ...original, fingerprintVersion: 1 }),
      )

      const oldManifest = yield* Effect.flip(
        Schema.decodeUnknownEffect(DocumentRenderJobPayload)({
          ...job,
          assetVersions: ["logo-v1"],
        }),
      )

      assert.instanceOf(oldJob, Schema.SchemaError)
      assert.instanceOf(oldRequest, Schema.SchemaError)
      assert.instanceOf(oldManifest, Schema.SchemaError)
    }),
  )

  it.effect("rejects duplicate asset identities in the same render", () =>
    Effect.gen(function* () {
      const asset = { assetId: "logo", version: "1", contentHash: hashA }

      const error = yield* Effect.flip(
        createDocumentRenderRequest({
          ...requestInput(),
          assetVersions: [asset, { ...asset, version: "2" }],
        }),
      )

      assert.instanceOf(error, Schema.SchemaError)
    }),
  )

  it.effect("rejects static HTML capabilities that require JavaScript", () =>
    Effect.gen(function* () {
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
        maxImagePixels: 1_000_000,
      }

      const error = yield* Effect.flip(validateDocumentRenderPolicy(requirements, policy))
      assert.instanceOf(error, DocumentRenderPolicyViolation)
      assert.strictEqual(error.reason, "javascript_disabled")
    }),
  )

  it.effect("rejects render inputs over the declared budget", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        validateDocumentRenderPolicy(requestInput(), {
          rendererFamily: "static-html",
          capabilities: ["css", "paged-media"],
          allowJavaScript: false,
          allowNetwork: false,
          maxAstNodes: 5,
          maxPages: 1,
          maxAssetBytes: 0,
          maxImagePixels: 1_000_000,
        }),
      )

      assert.instanceOf(error, DocumentRenderLimitExceeded)
      assert.strictEqual(error.limit, "ast_nodes")
      assert.strictEqual(error.actual, 6)
    }),
  )

  it.effect("deduplicates artifacts and rejects stale writers", () =>
    Effect.gen(function* () {
      const store = makeMemoryDocumentArtifactStore()
      const bytes = new Uint8Array([1, 2, 3])
      const contentHash = yield* sha256Hex(bytes)

      const metadata = {
        artifactId,
        fingerprintVersion: 2 as const,
        tenantId,
        snapshotId,
        astId,
        templateId: "purchase-order-default",
        templateVersion: 1,
        documentSchemaVersion: 1,
        rendererFamily: "native-transactional" as const,
        rendererVersion: "contract-test",
        assetVersions: [{ assetId: "logo", version: "1", contentHash: hashB }],
        renderFingerprint: hashA,
        contentHash,
        mediaType: "application/json",
        byteLength: bytes.byteLength,
        pageCount: 1,
        status: "ready" as const,
        createdAt: timestamp,
      }

      const scope = documentRenderFenceScope(metadata)

      const first = yield* store.put({
        metadata,
        bytes,
        fencing: { scope, generation: "1" },
      })

      const replay = yield* store.put({
        metadata: { ...metadata, artifactId: "018f0000-0000-7000-8000-000000000006" },
        bytes,
        fencing: { scope, generation: "1" },
      })

      assert.strictEqual(replay.artifactId, first.artifactId)

      const stale = yield* Effect.flip(
        store.put({
          metadata,
          bytes,
          fencing: { scope, generation: "0" },
        }),
      )

      assert.instanceOf(stale, DocumentArtifactStaleWriter)

      const wrongScope = yield* Effect.flip(
        store.put({
          metadata,
          bytes,
          fencing: { scope: "document-render:other-scope", generation: "0" },
        }),
      )

      assert.instanceOf(wrongScope, DocumentArtifactInvalidContent)

      const otherTenantId = "018f0000-0000-7000-8000-000000000007"
      const otherTenantMetadata = { ...metadata, tenantId: otherTenantId }

      const crossTenant = yield* Effect.flip(
        store.put({
          metadata: otherTenantMetadata,
          bytes,
          fencing: { scope: documentRenderFenceScope(otherTenantMetadata), generation: "1" },
        }),
      )

      assert.instanceOf(crossTenant, DocumentArtifactConflict)
      assert.isUndefined(yield* store.get({ tenantId: otherTenantId, renderFingerprint: hashA }))

      const distinctArtifact = {
        ...otherTenantMetadata,
        artifactId: "018f0000-0000-7000-8000-000000000008",
      }

      yield* store.put({
        metadata: distinctArtifact,
        bytes,
        fencing: { scope: documentRenderFenceScope(distinctArtifact), generation: "1" },
      })

      const otherTenantArtifact = yield* store.get({
        tenantId: otherTenantId,
        renderFingerprint: hashA,
      })

      assert.strictEqual(otherTenantArtifact!.metadata.artifactId, distinctArtifact.artifactId)

      const conflictBytes = new Uint8Array([1, 2, 3, 4])

      const conflict = yield* Effect.flip(
        store.put({
          metadata: {
            ...metadata,
            contentHash: yield* sha256Hex(conflictBytes),
            byteLength: conflictBytes.byteLength,
          },
          bytes: conflictBytes,
          fencing: { scope, generation: "2" },
        }),
      )

      assert.instanceOf(conflict, DocumentArtifactConflict)

      const stored = yield* store.get({ tenantId, renderFingerprint: hashA })
      assert.isDefined(stored)
      assert.deepStrictEqual([...stored!.bytes], [1, 2, 3])

      Reflect.set(first, "pageCount", 9)
      Reflect.set(first.assetVersions[0]!, "version", "changed")
      Reflect.set(stored!.metadata, "pageCount", 10)
      Reflect.set(stored!.metadata.assetVersions[0]!, "version", "changed-again")
      stored!.bytes[0] = 9
      bytes[1] = 9

      const reread = yield* store.get({ tenantId, renderFingerprint: hashA })
      assert.strictEqual(reread!.metadata.pageCount, 1)
      assert.deepStrictEqual(reread!.metadata.assetVersions, [
        { assetId: "logo", version: "1", contentHash: hashB },
      ])
      assert.deepStrictEqual([...reread!.bytes], [1, 2, 3])
    }),
  )
})
