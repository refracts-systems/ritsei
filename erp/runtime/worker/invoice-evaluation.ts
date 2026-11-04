import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"

import {
  canonicalizeJson,
  documentContextFromSnapshot,
  type DocumentRenderer,
  // This is a pure payload builder, not an Effect service constructor.
  // eslint-disable-next-line anti-slop-effect/no-service-constructor-imports
  makeDocumentRenderJobPayload,
  Uuid,
} from "../../../framework/foundation/mod.ts"
import { Principal } from "../../../framework/modules/auth/mod.ts"
import { AuthorizationService } from "../../../framework/modules/authorization/mod.ts"
import {
  BillingCapabilities,
  InvoiceRenderCompletionService,
  InvoiceRenderEvaluationService,
  InvoiceRenderJobPayload,
} from "../../modules/billing/mod.ts"
import { ProcessDocumentJobTypes, ProcessService } from "../../modules/process/mod.ts"

export const InvoiceEvaluationWorkerInput = Schema.Struct({
  tenantId: Uuid,
  workerId: Schema.String.check(Schema.isPattern(/\S/)),
  principal: Principal,
})

export const InvoiceEvaluationRenderer = Context.Service<DocumentRenderer>(
  "RITSEI/InvoiceEvaluationRenderer",
)

export class InvoiceEvaluationJobInvalid extends Schema.TaggedError<InvoiceEvaluationJobInvalid>()(
  "InvoiceEvaluationJobInvalid",
  { tenantId: Uuid, jobId: Uuid },
) {}

/** Candidate worker for disposable databases only. It is not wired into the production worker. */
export const runInvoiceEvaluationOnce = Effect.fn("InvoiceEvaluationWorker.runOnce")(function* (
  input: Schema.Codec.Encoded<typeof InvoiceEvaluationWorkerInput>,
) {
  const decoded = yield* Schema.decodeUnknownEffect(InvoiceEvaluationWorkerInput)(input)
  const authorization = yield* AuthorizationService
  const process = yield* ProcessService
  const billing = yield* InvoiceRenderEvaluationService
  const completion = yield* InvoiceRenderCompletionService
  const renderer = yield* InvoiceEvaluationRenderer
  const clock = yield* Clock.Clock

  yield* authorization.authorize({
    principal: decoded.principal,
    tenantId: decoded.tenantId,
    capability: BillingCapabilities.documentRead,
  })

  const job = yield* process.claimJob({
    tenantId: decoded.tenantId,
    workerId: decoded.workerId,
    jobType: ProcessDocumentJobTypes.invoiceRender,
  })

  if (job === null) return { status: "idle", jobId: null, invoiceId: null } as const

  if (job.leaseToken === null) return yield* Effect.die("claimed invoice render job lacks a lease")

  const lease = {
    tenantId: decoded.tenantId,
    workerId: decoded.workerId,
    jobId: job.jobId,
    leaseToken: job.leaseToken,
    leaseGeneration: job.leaseGeneration,
  }

  const invalid = () =>
    new InvoiceEvaluationJobInvalid({ tenantId: decoded.tenantId, jobId: job.jobId })

  let candidate:
    | {
        invoiceId: string
        artifactId: string
        renderFingerprint: string
        contentHash: string
      }
    | undefined

  const result = yield* Effect.result(
    Effect.gen(function* () {
      const payload = yield* Schema.decodeUnknownEffect(InvoiceRenderJobPayload)(job.payload).pipe(
        Effect.catchTag("SchemaError", () => Effect.fail(invalid())),
      )

      const staged = yield* billing.get({
        principal: decoded.principal,
        tenantId: decoded.tenantId,
        invoiceId: payload.invoiceId,
      })

      if (staged === null) return yield* Effect.fail(invalid())

      const expected = {
        ...(yield* makeDocumentRenderJobPayload(staged.request)),
        invoiceId: payload.invoiceId,
      }

      if (
        job.fenceScope !== expected.fenceScope ||
        job.idempotencyKey !== expected.idempotencyKey ||
        canonicalizeJson(payload) !== canonicalizeJson(expected)
      ) {
        return yield* Effect.fail(invalid())
      }

      const rendered = yield* renderer.render({
        context: documentContextFromSnapshot(staged.snapshot),
        ast: staged.ast,
        request: staged.request,
      })

      candidate = {
        invoiceId: payload.invoiceId,
        artifactId: rendered.metadata.artifactId,
        renderFingerprint: staged.request.renderFingerprint,
        contentHash: rendered.metadata.contentHash,
      }

      yield* completion.complete({
        ...lease,
        invoiceId: payload.invoiceId,
        artifactId: rendered.metadata.artifactId,
        content: rendered.bytes,
        pageCount: rendered.metadata.pageCount,
      })

      return { status: "completed", jobId: job.jobId, invoiceId: payload.invoiceId } as const
    }),
  )

  if (Result.isSuccess(result)) return result.success

  if (Predicate.isTagged(result.failure, "DatabaseFailure") && candidate !== undefined) {
    const reconciliation = yield* Effect.result(
      billing.getArtifact({
        principal: decoded.principal,
        tenantId: decoded.tenantId,
        invoiceId: candidate.invoiceId,
      }),
    )

    if (
      Result.isSuccess(reconciliation) &&
      reconciliation.success !== null &&
      reconciliation.success.artifactId === candidate.artifactId &&
      reconciliation.success.renderFingerprint === candidate.renderFingerprint &&
      reconciliation.success.contentHash === candidate.contentHash
    ) {
      return { status: "completed", jobId: job.jobId, invoiceId: candidate.invoiceId } as const
    }
  }

  if (
    !Predicate.isTagged(result.failure, "DatabaseFailure") &&
    !Predicate.isTagged(result.failure, "ProcessJobLeaseLost")
  ) {
    yield* process.failJob({
      ...lease,
      error: "invoice_render_evaluation_failed",
      retryAt: new Date(clock.currentTimeMillisUnsafe() + 60_000).toISOString(),
    })
  }

  return yield* Effect.fail(result.failure)
})
