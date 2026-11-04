import type * as Effect from "effect/Effect"
import type * as Schema from "effect/Schema"

import type { DatabaseFailure, DocumentHashFailure } from "../../../../framework/foundation/mod.ts"
import type { BillingDocumentNotFound } from "./errors.ts"
import type {
  InvoiceRenderArtifact,
  InvoiceRenderInput,
  InvoiceRenderInputConflict,
} from "./render-contract.ts"

export interface InvoiceRenderStore {
  readonly put: (
    input: InvoiceRenderInput,
  ) => Effect.Effect<
    InvoiceRenderInput,
    | DatabaseFailure
    | DocumentHashFailure
    | BillingDocumentNotFound
    | InvoiceRenderInputConflict
    | Schema.SchemaError
  >
  readonly find: (
    tenantId: string,
    invoiceId: string,
  ) => Effect.Effect<InvoiceRenderInput | null, DatabaseFailure>
  readonly findArtifact: (
    tenantId: string,
    invoiceId: string,
  ) => Effect.Effect<InvoiceRenderArtifact | null, DatabaseFailure>
}
