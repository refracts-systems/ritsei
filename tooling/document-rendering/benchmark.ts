import * as Effect from "effect/Effect"

import { isMain } from "../entrypoint.ts"

import {
  documentContextFromSnapshot,
  type DocumentContext,
  type DocumentRenderPolicy,
  type DocumentSnapshot,
  createDocumentAst,
  createDocumentRenderRequest,
  createDocumentSnapshot,
  sha256Hex,
} from "../../framework/foundation/mod.ts"
import {
  makePdfNativeDocumentRenderer,
  pdfNativeRendererVersion,
} from "../../framework/platform/mod.ts"
import { documentBenchmarkCorpus } from "./corpus.ts"

const tenantId = "018f0000-0000-7000-8000-000000000001"
const snapshotId = "018f0000-0000-7000-8000-000000000014"
const astId = "018f0000-0000-7000-8000-000000000015"
const sourceId = "018f0000-0000-7000-8000-000000000016"
const timestamp = "2026-09-06T00:00:00.000Z"

const samplePng = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR42mNk+M/wHwAF/gL+U5gAAAAASUVORK5CYII=",
  ),
  (character) => character.charCodeAt(0),
)

const parsedIterations = Number(process.argv.slice(2)[0] ?? "10")

const iterations =
  Number.isInteger(parsedIterations) && parsedIterations > 0 ? parsedIterations : 10

const policy: DocumentRenderPolicy = {
  rendererFamily: "native-transactional",
  capabilities: ["svg"],
  allowJavaScript: false,
  allowNetwork: false,
  maxAstNodes: 100_000,
  maxPages: 100,
  maxAssetBytes: 50_000_000,
}

const renderer = makePdfNativeDocumentRenderer({
  policy,
  resolveAsset: ({ assetId, version }) =>
    Effect.succeed(
      version === "1" && (assetId === "logo-v1" || assetId === "signature-v1")
        ? samplePng
        : undefined,
    ),
})

type BenchmarkFixture = (typeof documentBenchmarkCorpus)[number]

const renderFixture = (
  fixture: BenchmarkFixture,
  snapshot: DocumentSnapshot,
  context: DocumentContext,
  assetHash: string,
  index: number,
) =>
  Effect.gen(function* () {
    const ast = yield* createDocumentAst({
      astId,
      snapshotId,
      documentType: fixture.name,
      astVersion: 1,
      nodes: fixture.nodes,
    })

    const request = yield* createDocumentRenderRequest({
      tenantId,
      fingerprintVersion: 2,
      snapshotId,
      snapshotChecksum: snapshot.checksum,
      astId: ast.astId,
      astChecksum: ast.checksum,
      templateId: "benchmark-default",
      templateVersion: 1,
      documentSchemaVersion: 1,
      rendererFamily: "native-transactional",
      rendererVersion: pdfNativeRendererVersion,
      assetVersions:
        fixture.assetBytes > 0
          ? ["logo-v1", "signature-v1"].map((assetId) => ({
              assetId,
              version: "1",
              contentHash: assetHash,
            }))
          : [],
      capabilities: fixture.capabilities,
      astNodeCount: ast.nodes.length,
      pageCount: fixture.pageCount,
      assetBytes: fixture.assetBytes,
      correlationId: `document-benchmark:${fixture.name}:${index}`,
    })

    return yield* renderer.render({ context, ast, request })
  })

const benchmarkFixture = (fixture: BenchmarkFixture) =>
  fixture.capabilities.includes("paged-media")
    ? Effect.succeed({
        name: fixture.name,
        skipped: true,
        reason: "publishing capability is outside the pdfnative transactional adapter",
      })
    : Effect.gen(function* () {
        const snapshot = yield* createDocumentSnapshot({
          snapshotId,
          tenantId,
          source: { owner: "benchmark", type: "document_fixture", id: sourceId },
          capturedAt: timestamp,
          schemaVersion: 1,
          payload: { fixture: fixture.name, version: 1 },
        })

        const context = documentContextFromSnapshot(snapshot)
        const assetHash = yield* sha256Hex(samplePng)
        const startedAt = performance.now()
        const startedCpu = process.cpuUsage()
        let firstIterationMs = 0
        let lastBytes = 0
        let lastPages = 0
        let lastFingerprint = ""
        let lastContentHash = ""

        for (let index = 0; index < iterations; index += 1) {
          const iterationStartedAt = performance.now()

          const output = yield* renderFixture(fixture, snapshot, context, assetHash, index)

          if (index === 0) firstIterationMs = performance.now() - iterationStartedAt

          lastBytes = output.bytes.byteLength
          lastPages = output.metadata.pageCount
          lastFingerprint = output.metadata.renderFingerprint
          lastContentHash = output.metadata.contentHash
        }

        const elapsedMs = Number((performance.now() - startedAt).toFixed(3))
        const cpu = process.cpuUsage(startedCpu)

        return {
          name: fixture.name,
          iterations,
          elapsedMs,
          averageMs: Number((elapsedMs / iterations).toFixed(3)),
          firstIterationMs: Number(firstIterationMs.toFixed(3)),
          warmAverageMs:
            iterations > 1
              ? Number(((elapsedMs - firstIterationMs) / (iterations - 1)).toFixed(3))
              : null,
          documentsPerSecond: Number(((iterations * 1_000) / elapsedMs).toFixed(3)),
          cpuMs: Number(((cpu.user + cpu.system) / 1_000).toFixed(3)),
          outputBytes: lastBytes,
          pages: lastPages,
          renderFingerprint: lastFingerprint,
          contentHash: lastContentHash,
        }
      })

const benchmark = Effect.all(documentBenchmarkCorpus.map(benchmarkFixture))

if (isMain(import.meta.url)) {
  const results = await Effect.runPromise(benchmark)
  console.log(
    JSON.stringify({
      benchmark: "pdfnative-document-render",
      renderer: pdfNativeRendererVersion,
      activation: "evaluation-only",
      fixtures: results,
      processPeakRssKiB: process.resourceUsage().maxRSS,
      note: "Sequential in-process measurements include AST and request construction. The first iteration is not a cold-process measurement; peak RSS is for the entire process. Publishing and browser profiles remain separate.",
    }),
  )
}
