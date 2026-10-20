import * as Effect from "effect/Effect"

import { isMain } from "../entrypoint.ts"

import {
  documentContextFromSnapshot,
  type DocumentRenderPolicy,
  createDocumentAst,
  createDocumentRenderRequest,
  createDocumentSnapshot,
} from "../../framework/foundation/mod.ts"
import { makePdfNativeDocumentRenderer } from "../../framework/platform/mod.ts"
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
  resolveAsset: (assetId) =>
    Effect.succeed(assetId === "logo-v1" || assetId === "signature-v1" ? samplePng : undefined),
})

type BenchmarkFixture = (typeof documentBenchmarkCorpus)[number]

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
        const startedAt = performance.now()
        let lastBytes = 0
        let lastPages = 0
        let lastFingerprint = ""

        for (let index = 0; index < iterations; index += 1) {
          const ast = yield* createDocumentAst({
            astId,
            snapshotId,
            documentType: fixture.name,
            astVersion: 1,
            nodes: fixture.nodes,
          })
          const request = yield* createDocumentRenderRequest({
            tenantId,
            snapshotId,
            snapshotChecksum: snapshot.checksum,
            astId: ast.astId,
            astChecksum: ast.checksum,
            templateId: "benchmark-default",
            templateVersion: 1,
            documentSchemaVersion: 1,
            rendererFamily: "native-transactional",
            rendererVersion: "pdfnative@1.7.0",
            assetVersions: fixture.assetBytes > 0 ? ["sample-assets@1"] : [],
            capabilities: fixture.capabilities,
            astNodeCount: ast.nodes.length,
            pageCount: fixture.pageCount,
            assetBytes: fixture.assetBytes,
            correlationId: `document-benchmark:${fixture.name}:${index}`,
          })
          const output = yield* renderer.render({ context, ast, request })
          lastBytes = output.bytes.byteLength
          lastPages = output.metadata.pageCount
          lastFingerprint = output.metadata.renderFingerprint
        }

        const elapsedMs = Number((performance.now() - startedAt).toFixed(3))
        return {
          name: fixture.name,
          iterations,
          elapsedMs,
          averageMs: Number((elapsedMs / iterations).toFixed(3)),
          outputBytes: lastBytes,
          pages: lastPages,
          renderFingerprint: lastFingerprint,
        }
      })

const benchmark = Effect.all(documentBenchmarkCorpus.map(benchmarkFixture))

if (isMain(import.meta.url)) {
  const results = await Effect.runPromise(benchmark)
  console.log(
    JSON.stringify({
      benchmark: "pdfnative-document-render",
      renderer: "pdfnative@1.7.0",
      activation: "evaluation-only",
      fixtures: results,
      note: "This measures the RITSEI native adapter; publishing and browser profiles remain separate.",
    }),
  )
}
