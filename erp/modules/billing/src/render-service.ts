import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import {
  AuthorizationService,
  scopedCommand,
} from "../../../../framework/modules/authorization/mod.ts"
import { BillingCapabilities } from "./capabilities.ts"
import {
  GetInvoiceRenderInput,
  InvoiceRenderEvaluationService,
  StageInvoiceRenderInput,
} from "./render-contract.ts"
import { InvoiceRenderInputInvalid, validateInvoiceRenderInput } from "./render-input.ts"
import { makePostgresInvoiceRenderStore } from "./render-postgres.ts"

export const makeInvoiceRenderEvaluationService = Effect.gen(function* () {
  const authorization = yield* AuthorizationService
  const authorized = scopedCommand(authorization)
  const store = yield* makePostgresInvoiceRenderStore

  return {
    stage: Effect.fn("BillingRenderEvaluation.stage")(function* (
      input: Schema.Codec.Encoded<typeof StageInvoiceRenderInput>,
    ) {
      const decoded = yield* authorized(
        StageInvoiceRenderInput,
        BillingCapabilities.customerInvoiceCreate,
      )(input)

      const checked = yield* validateInvoiceRenderInput(decoded.input)

      if (decoded.tenantId !== checked.snapshot.tenantId) {
        return yield* Effect.fail(
          new InvoiceRenderInputInvalid({
            tenantId: decoded.tenantId,
            invoiceId: checked.snapshot.source.id,
            reason: "tenant",
          }),
        )
      }

      return yield* store.put(checked)
    }),
    get: Effect.fn("BillingRenderEvaluation.get")(function* (
      input: Schema.Codec.Encoded<typeof GetInvoiceRenderInput>,
    ) {
      const decoded = yield* authorized(
        GetInvoiceRenderInput,
        BillingCapabilities.documentRead,
      )(input)

      return yield* store.find(decoded.tenantId, decoded.invoiceId)
    }),
    getArtifact: Effect.fn("BillingRenderEvaluation.getArtifact")(function* (
      input: Schema.Codec.Encoded<typeof GetInvoiceRenderInput>,
    ) {
      const decoded = yield* authorized(
        GetInvoiceRenderInput,
        BillingCapabilities.documentRead,
      )(input)

      return yield* store.findArtifact(decoded.tenantId, decoded.invoiceId)
    }),
  } satisfies InvoiceRenderEvaluationService
})

export const InvoiceRenderEvaluationLive = Layer.effect(
  InvoiceRenderEvaluationService,
  makeInvoiceRenderEvaluationService,
)
