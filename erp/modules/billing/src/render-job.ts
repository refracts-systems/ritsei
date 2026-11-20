import * as Schema from "effect/Schema"

import { DocumentRenderJobPayload, Uuid } from "../../../../framework/foundation/mod.ts"

/** Billing's evaluation job binds the generic render request to its invoice owner. */
export const InvoiceRenderJobPayload = Schema.Struct({
  ...DocumentRenderJobPayload.fields,
  invoiceId: Uuid,
})
