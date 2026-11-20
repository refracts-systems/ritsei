import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import {
  canonicalizeJson,
  Database,
  // This is a pure payload builder, not an Effect service constructor.
  // eslint-disable-next-line anti-slop-effect/no-service-constructor-imports
  makeDocumentRenderJobPayload,
  sha256Hex,
  Uuid,
} from "../../../../framework/foundation/mod.ts"
import {
  ProcessDocumentJobTypes,
  ProcessJobCompleteInput,
  ProcessService,
} from "../../process/mod.ts"
import { InvoiceDocumentAstInput } from "./document.ts"
import { InvoiceRenderArtifact } from "./render-contract.ts"
import { InvoiceRenderJobPayload } from "./render-job.ts"
import { makePostgresInvoiceRenderStore } from "./render-postgres.ts"

export const CompleteInvoiceRender = Schema.Struct({
  ...ProcessJobCompleteInput.fields,
  invoiceId: Uuid,
  artifactId: InvoiceDocumentAstInput.fields.astId,
  content: Schema.Uint8Array,
  pageCount: InvoiceRenderArtifact.fields.pageCount,
})

export class InvoiceRenderCompletionConflict extends Schema.TaggedError<InvoiceRenderCompletionConflict>()(
  "InvoiceRenderCompletionConflict",
  {
    tenantId: Uuid,
    invoiceId: Uuid,
    reason: Schema.Literals(["invalid_output", "input_missing", "job_mismatch", "artifact_exists"]),
  },
) {}

/** Worker-only evaluation operation; lease possession is verified by Process. */
export const makeInvoiceRenderCompletionService = Effect.gen(function* () {
  const database = yield* Database
  const process = yield* ProcessService
  const store = yield* makePostgresInvoiceRenderStore

  return {
    complete: Effect.fn("BillingRenderCompletion.complete")(function* (
      input: Schema.Codec.Encoded<typeof CompleteInvoiceRender>,
    ) {
      const decoded = yield* Schema.decodeUnknownEffect(CompleteInvoiceRender)(input)

      const conflict = (
        reason: "invalid_output" | "input_missing" | "job_mismatch" | "artifact_exists",
      ) =>
        new InvoiceRenderCompletionConflict({
          tenantId: decoded.tenantId,
          invoiceId: decoded.invoiceId,
          reason,
        })

      if (
        decoded.content.length < 5 ||
        decoded.content.length > 50_000_000 ||
        decoded.content[0] !== 0x25 ||
        decoded.content[1] !== 0x50 ||
        decoded.content[2] !== 0x44 ||
        decoded.content[3] !== 0x46 ||
        decoded.content[4] !== 0x2d
      ) {
        return yield* Effect.fail(conflict("invalid_output"))
      }

      const content = Uint8Array.from(decoded.content)
      const contentHash = yield* sha256Hex(content)

      return yield* database.withTransaction(
        Effect.gen(function* () {
          const job = yield* process.completeFencedJob(decoded)
          const stored = yield* store.find(decoded.tenantId, decoded.invoiceId)

          if (stored === null) return yield* Effect.fail(conflict("input_missing"))

          const expected = {
            ...(yield* makeDocumentRenderJobPayload(stored.request)),
            invoiceId: decoded.invoiceId,
          }

          const payload = yield* Schema.decodeUnknownEffect(InvoiceRenderJobPayload)(
            job.payload,
          ).pipe(Effect.catchTag("SchemaError", () => Effect.fail(conflict("job_mismatch"))))

          if (
            job.jobType !== ProcessDocumentJobTypes.invoiceRender ||
            job.fenceScope !== stored.request.fenceScope ||
            job.idempotencyKey !== expected.idempotencyKey ||
            canonicalizeJson(payload) !== canonicalizeJson(expected)
          ) {
            return yield* Effect.fail(conflict("job_mismatch"))
          }

          const artifact = {
            artifactId: decoded.artifactId,
            tenantId: decoded.tenantId,
            invoiceId: decoded.invoiceId,
            snapshotId: stored.snapshot.snapshotId,
            astId: stored.ast.astId,
            renderFingerprint: stored.request.renderFingerprint,
            contentHash,
            content,
            pageCount: decoded.pageCount,
          } satisfies InvoiceRenderArtifact

          const inserted = yield* store.insertArtifact(
            artifact,
            job.fenceScope,
            job.leaseGeneration,
          )

          if (!inserted) return yield* Effect.fail(conflict("artifact_exists"))

          return artifact
        }),
        "billing.render_artifact.complete",
      )
    }),
  }
})

export type InvoiceRenderCompletionService = Effect.Success<
  typeof makeInvoiceRenderCompletionService
>

export const InvoiceRenderCompletionService = Context.Service<InvoiceRenderCompletionService>(
  "RITSEI/InvoiceRenderCompletionService",
)

export const InvoiceRenderCompletionLive = Layer.effect(
  InvoiceRenderCompletionService,
  makeInvoiceRenderCompletionService,
)
