import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

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
  sha256Hex,
} from "./contract.ts"

const artifactKey = (tenantId: string, renderFingerprint: string) =>
  `${tenantId}:${renderFingerprint}`

const artifactIdOf = (input: unknown) =>
  typeof input === "object" &&
  input !== null &&
  "artifactId" in input &&
  typeof input.artifactId === "string"
    ? input.artifactId
    : "unknown"

const decodeArtifactWrite = (input: unknown) =>
  Effect.gen(function* () {
    if (typeof input !== "object" || input === null) {
      return yield* Effect.fail(
        new DocumentArtifactInvalidContent({
          artifactId: "unknown",
          reason: "artifact write must be an object",
        }),
      )
    }
    const write = input as Partial<DocumentArtifactWrite>
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
    return { metadata, bytes: write.bytes, fencing } satisfies DocumentArtifactWrite
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
    const existingFingerprint = artifactIds.get(write.metadata.artifactId)
    if (
      existingFingerprint !== undefined &&
      existingFingerprint !== write.metadata.renderFingerprint
    ) {
      return yield* Effect.fail(
        new DocumentArtifactConflict({
          tenantId: write.metadata.tenantId,
          renderFingerprint: write.metadata.renderFingerprint,
          reason: "artifact identity is already bound to another render fingerprint",
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
      return existing.metadata
    }

    const stored: DocumentArtifactRecord = {
      metadata: write.metadata,
      bytes: write.bytes.slice(),
    }
    artifacts.set(key, stored)
    artifactIds.set(write.metadata.artifactId, write.metadata.renderFingerprint)
    generations.set(write.fencing.scope, BigInt(write.fencing.generation))
    return write.metadata
  })

export const makeMemoryDocumentArtifactStore = (): DocumentArtifactStore => {
  const artifacts = new Map<string, DocumentArtifactRecord>()
  const artifactIds = new Map<string, string>()
  const generations = new Map<string, bigint>()

  const put = Effect.fn("DocumentArtifactStore.memory.put")(function* (input: unknown) {
    const write = yield* decodeArtifactWrite(input)
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

  const get = Effect.fn("DocumentArtifactStore.memory.get")(function* (input: unknown) {
    const decoded = yield* Schema.decodeUnknownEffect(DocumentArtifactLookup)(input)
    const found = artifacts.get(artifactKey(decoded.tenantId, decoded.renderFingerprint))
    return found === undefined
      ? undefined
      : { metadata: found.metadata, bytes: found.bytes.slice() }
  })

  return { put, get }
}

export const makeMemoryDocumentArtifactLayer = () =>
  Layer.succeed(DocumentArtifactStore, makeMemoryDocumentArtifactStore())
