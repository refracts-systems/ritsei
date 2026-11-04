import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  type DatabaseFailure,
  type DocumentHashFailure,
  Uuid,
} from "../../../../framework/foundation/mod.ts"
import { Principal } from "../../../../framework/modules/auth/mod.ts"
import type { AuthorizationDenied } from "../../../../framework/modules/authorization/mod.ts"
import type { BillingDocumentNotFound } from "./errors.ts"
import {
  InvoiceRenderInput as InvoiceRenderInputSchema,
  type InvoiceRenderInputInvalid,
} from "./render-input.ts"

export type InvoiceRenderInput = Schema.Schema.Type<typeof InvoiceRenderInputSchema>

export const StageInvoiceRenderInput = Schema.Struct({
  principal: Principal,
  tenantId: Uuid,
  input: InvoiceRenderInputSchema,
})

export const GetInvoiceRenderInput = Schema.Struct({
  principal: Principal,
  tenantId: Uuid,
  invoiceId: Uuid,
})

export class InvoiceRenderInputConflict extends Schema.TaggedError<InvoiceRenderInputConflict>()(
  "InvoiceRenderInputConflict",
  {
    tenantId: Uuid,
    invoiceId: Uuid,
    reason: Schema.Literals(["invoice_mismatch", "existing_input", "identity_in_use"]),
  },
) {}

type StageFailure =
  | AuthorizationDenied
  | DatabaseFailure
  | BillingDocumentNotFound
  | DocumentHashFailure
  | InvoiceRenderInputConflict
  | InvoiceRenderInputInvalid
  | Schema.SchemaError

/** Isolated evaluation only; this layer is not composed into the production runtime. */
export interface InvoiceRenderEvaluationService {
  readonly stage: (
    input: Schema.Codec.Encoded<typeof StageInvoiceRenderInput>,
  ) => Effect.Effect<InvoiceRenderInput, StageFailure>
  readonly get: (
    input: Schema.Codec.Encoded<typeof GetInvoiceRenderInput>,
  ) => Effect.Effect<
    InvoiceRenderInput | null,
    AuthorizationDenied | DatabaseFailure | Schema.SchemaError
  >
}

export const InvoiceRenderEvaluationService = Context.Service<InvoiceRenderEvaluationService>(
  "RITSEI/InvoiceRenderEvaluationService",
)
