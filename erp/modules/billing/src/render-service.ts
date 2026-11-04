import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import { Database } from "../../../../framework/foundation/mod.ts"
import {
  AuthorizationService,
  scopedCommand,
} from "../../../../framework/modules/authorization/mod.ts"
import { PartyService } from "../../party/mod.ts"
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
  const database = yield* Database
  const parties = yield* PartyService
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

      return yield* database.withTransaction(
        Effect.gen(function* () {
          const prior = yield* store.find(decoded.tenantId, checked.snapshot.source.id)

          if (prior !== null) return yield* store.put(checked)

          const legalEntity = yield* parties.getLegalEntity({
            principal: decoded.principal,
            tenantId: decoded.tenantId,
            legalEntityId: checked.snapshot.payload.legalEntityId,
          })

          const issuer = yield* parties.getDetail({
            principal: decoded.principal,
            tenantId: decoded.tenantId,
            partyId: legalEntity.organizationId,
          })

          const customer = yield* parties.getDetail({
            principal: decoded.principal,
            tenantId: decoded.tenantId,
            partyId: checked.snapshot.payload.partyId,
          })

          if (issuer.party.name !== checked.snapshot.payload.issuerName) {
            return yield* Effect.fail(
              new InvoiceRenderInputInvalid({
                tenantId: decoded.tenantId,
                invoiceId: checked.snapshot.source.id,
                reason: "issuer_name",
              }),
            )
          }

          if (customer.party.name !== checked.snapshot.payload.customerName) {
            return yield* Effect.fail(
              new InvoiceRenderInputInvalid({
                tenantId: decoded.tenantId,
                invoiceId: checked.snapshot.source.id,
                reason: "customer_name",
              }),
            )
          }

          return yield* store.put(checked)
        }),
        "billing.render_input.verify_parties",
      )
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
