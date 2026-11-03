import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Predicate from "effect/Predicate"

import { FencingContext } from "../concurrency/mod.ts"
import {
  DocumentArtifact,
  DocumentArtifactConflict,
  DocumentArtifactInvalidContent,
  DocumentArtifactLookup,
  DocumentArtifactRecord,
  DocumentArtifactStaleWriter,
  DocumentArtifactStore,
  type DocumentArtifactWrite,
  documentRenderFenceScope,
  sha256Hex,
} from "./contract.ts"

const artifactKey = (tenantId: string, renderFingerprint: string) =>
  `${tenantId}:${renderFingerprint}`

const copyArtifact = (metadata: DocumentArtifact): DocumentArtifact => ({
  ...metadata,
  assetVersions: metadata.assetVersions.map((asset) => ({ ...asset })),
})

const artifactIdOf = (input: DocumentArtifactWrite["metadata"] | undefined) =>
  Predicate.isObjectOrArray(input) && "artifactId" in input && Predicate.isString(input.artifactId)
    ? input.artifactId
    : "unknown"

const decodeArtifactWrite = (input: DocumentArtifactWrite) =>
  Effect.gen(function* () {
    if (!Predicate.isObjectOrArray(input)) {
      return yield* Effect.fail(
        new DocumentArtifactInvalidContent({
          artifactId: "unknown",
          reason: "artifact write must be an object",
        }),
      )
    }

    // Every field is still checked: callers outside TypeScript may send anything.
    const write: Partial<DocumentArtifactWrite> = input

    if (!(write.bytes instanceof Uint8Array)) {
      return yield* Effect.fail(
        new DocumentArtifactInvalidContent({
          artifactId: artifactIdOf(write.metadata),
          reason: "artifact content must be a Uint8Array",
        }),
      )
    }

    const metadata = yield* Schema.decodeUnknownEffect(DocumentArtifact)(write.metadata)
    const fencing = yield* Schema.decodeUnknownEffect(FencingContext)(write.fencing)

    return { metadata: copyArtifact(metadata), bytes: write.bytes.slice(), fencing }
  })

const persistArtifact = (
  artifacts: Map<string, DocumentArtifactRecord>,
  artifactIds: Map<string, string>,
  generations: Map<string, bigint>,
  write: DocumentArtifactWrite,
) =>
  Effect.gen(function* () {
    const key = artifactKey(write.metadata.tenantId, write.metadata.renderFingerprint)
    const existing = artifacts.get(key)
    const existingKey = artifactIds.get(write.metadata.artifactId)

    if (existingKey !== undefined && existingKey !== key) {
      return yield* Effect.fail(
        new DocumentArtifactConflict({
          tenantId: write.metadata.tenantId,
          renderFingerprint: write.metadata.renderFingerprint,
          reason: "artifact identity is already bound to another tenant or render fingerprint",
        }),
      )
    }

    if (existing !== undefined) {
      if (
        existing.metadata.contentHash !== write.metadata.contentHash ||
        existing.metadata.byteLength !== write.metadata.byteLength
      ) {
        return yield* Effect.fail(
          new DocumentArtifactConflict({
            tenantId: write.metadata.tenantId,
            renderFingerprint: write.metadata.renderFingerprint,
            reason: "render fingerprint already has different artifact content",
          }),
        )
      }

      generations.set(write.fencing.scope, BigInt(write.fencing.generation))

      return copyArtifact(existing.metadata)
    }

    const stored: DocumentArtifactRecord = {
      metadata: copyArtifact(write.metadata),
      bytes: write.bytes.slice(),
    }

    artifacts.set(key, stored)
    artifactIds.set(write.metadata.artifactId, key)
    generations.set(write.fencing.scope, BigInt(write.fencing.generation))

    return copyArtifact(write.metadata)
  })

export const makeMemoryDocumentArtifactStore = (): DocumentArtifactStore => {
  const artifacts = new Map<string, DocumentArtifactRecord>()
  const artifactIds = new Map<string, string>()
  const generations = new Map<string, bigint>()

  const put = Effect.fn("DocumentArtifactStore.memory.put")(function* (
    input: DocumentArtifactWrite,
  ) {
    const write = yield* decodeArtifactWrite(input)

    if (write.fencing.scope !== documentRenderFenceScope(write.metadata)) {
      return yield* Effect.fail(
        new DocumentArtifactInvalidContent({
          artifactId: write.metadata.artifactId,
          reason: "fencing scope does not match the tenant and render fingerprint",
        }),
      )
    }

    const contentHash = yield* sha256Hex(write.bytes)

    if (
      contentHash !== write.metadata.contentHash ||
      write.bytes.byteLength !== write.metadata.byteLength
    ) {
      return yield* Effect.fail(
        new DocumentArtifactInvalidContent({
          artifactId: write.metadata.artifactId,
          reason: "artifact metadata does not match its bytes",
        }),
      )
    }

    const incomingGeneration = BigInt(write.fencing.generation)
    const currentGeneration = generations.get(write.fencing.scope)

    if (currentGeneration !== undefined && incomingGeneration < currentGeneration) {
      return yield* Effect.fail(
        new DocumentArtifactStaleWriter({
          fenceScope: write.fencing.scope,
          receivedGeneration: write.fencing.generation,
          currentGeneration: currentGeneration.toString(),
        }),
      )
    }

    return yield* persistArtifact(artifacts, artifactIds, generations, write)
  })

  const get = Effect.fn("DocumentArtifactStore.memory.get")(function* (
    input: Schema.Codec.Encoded<typeof DocumentArtifactLookup>,
  ) {
    const decoded = yield* Schema.decodeUnknownEffect(DocumentArtifactLookup)(input)
    const found = artifacts.get(artifactKey(decoded.tenantId, decoded.renderFingerprint))

    return found === undefined
      ? undefined
      : { metadata: copyArtifact(found.metadata), bytes: found.bytes.slice() }
  })

  return { put, get }
}

export const makeMemoryDocumentArtifactLayer = () =>
  Layer.succeed(DocumentArtifactStore, makeMemoryDocumentArtifactStore())
