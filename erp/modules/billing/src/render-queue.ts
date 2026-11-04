import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import {
  canonicalizeJson,
  Database,
  DurableJobEnqueuer,
  // This is a pure payload builder, not an Effect service constructor.
  // eslint-disable-next-line anti-slop-effect/no-service-constructor-imports
  makeDocumentRenderJobPayload,
  Uuid,
} from "../../../../framework/foundation/mod.ts"
import { ProcessDocumentJobTypes } from "../../process/mod.ts"
import { InvoiceRenderEvaluationService, StageInvoiceRenderInput } from "./render-contract.ts"

export class InvoiceRenderQueueConflict extends Schema.TaggedError<InvoiceRenderQueueConflict>()(
  "InvoiceRenderQueueConflict",
  { tenantId: Uuid, invoiceId: Uuid },
) {}

/** Isolated evaluation only; production posting does not enqueue a render job. */
export const makeInvoiceRenderQueueEvaluationService = Effect.gen(function* () {
  const database = yield* Database
  const billing = yield* InvoiceRenderEvaluationService
  const jobs = yield* DurableJobEnqueuer

  return {
    stageAndEnqueue: Effect.fn("BillingRenderQueueEvaluation.stageAndEnqueue")(function* (
      input: Schema.Codec.Encoded<typeof StageInvoiceRenderInput>,
    ) {
      return yield* database.withTransaction(
        Effect.gen(function* () {
          const staged = yield* billing.stage(input)

          const payload = {
            ...(yield* makeDocumentRenderJobPayload(staged.request)),
            invoiceId: staged.snapshot.source.id,
          }

          const job = yield* jobs.enqueue({
            tenantId: staged.snapshot.tenantId,
            jobType: ProcessDocumentJobTypes.invoiceRender,
            idempotencyKey: payload.idempotencyKey,
            priority: 0,
            payload,
            correlationId: payload.correlationId,
            fenceScope: payload.fenceScope,
          })

          if (
            job.tenantId !== staged.snapshot.tenantId ||
            job.jobType !== ProcessDocumentJobTypes.invoiceRender ||
            job.idempotencyKey !== payload.idempotencyKey ||
            job.fenceScope !== payload.fenceScope ||
            job.priority !== 0 ||
            job.correlationId !== payload.correlationId ||
            canonicalizeJson(job.payload) !== canonicalizeJson(payload)
          ) {
            return yield* Effect.fail(
              new InvoiceRenderQueueConflict({
                tenantId: staged.snapshot.tenantId,
                invoiceId: staged.snapshot.source.id,
              }),
            )
          }

          return { input: staged, jobId: job.jobId }
        }),
        "billing.render_input.enqueue",
      )
    }),
  }
})

export type InvoiceRenderQueueEvaluationService = Effect.Success<
  typeof makeInvoiceRenderQueueEvaluationService
>

export const InvoiceRenderQueueEvaluationService =
  Context.Service<InvoiceRenderQueueEvaluationService>("RITSEI/InvoiceRenderQueueEvaluationService")

export const InvoiceRenderQueueEvaluationLive = Layer.effect(
  InvoiceRenderQueueEvaluationService,
  makeInvoiceRenderQueueEvaluationService,
)
