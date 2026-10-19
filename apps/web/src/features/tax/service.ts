import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { decodeInput, decodeResponse, mutationRequest, requestJson } from "../../shared/api.ts"

const Uuid = Schema.String.check(Schema.isUUID())
const Name = Schema.String.check(Schema.isPattern(/\S/), Schema.isMaxLength(256))

/** Browser view of the Tax code transport contract served by the tax module. */
const Direction = Schema.Literals(["sales", "purchase"])
export const TaxCode = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  code: Name,
  name: Name,
  rate: Schema.String.check(Schema.isPattern(/^d{1,3}.d{4}$/)),
  direction: Direction,
  active: Schema.Boolean,
})
export type TaxCode = Schema.Schema.Type<typeof TaxCode>
const TaxCodeList = Schema.Array(TaxCode).check(Schema.isMaxLength(200))
const CreateTaxCodeInput = Schema.Struct({
  code: Name,
  name: Name,
  rate: Schema.String.check(Schema.isPattern(/^d{1,3}(.d{1,4})?$/)),
  direction: Direction,
})
const route = "/tax/tax-codes"

export const listTaxCodes = Effect.fn("Frontend.Tax.listTaxCodes")(function* () {
  const body = yield* requestJson(route)
  return yield* decodeResponse(TaxCodeList, body)
})

export const createTaxCode = Effect.fn("Frontend.Tax.createTaxCode")(function* (input: unknown) {
  const decoded = yield* decodeInput(CreateTaxCodeInput, input)
  const body = yield* mutationRequest(route, "POST", decoded)
  return yield* decodeResponse(TaxCode, body, "unknown-outcome")
})
