import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  type DatabaseFailure,
  FinancialMajorAmount,
  formatSignedMinor,
  requireExactMajorToMinor,
  Uuid,
  TrimmedText,
} from "../../../../framework/foundation/mod.ts"
import { Principal } from "../../../../framework/modules/auth/mod.ts"
import type { AuthorizationDenied } from "../../../../framework/modules/authorization/mod.ts"
import type { TaxCodeAlreadyExists, TaxCodeNotFound, TaxProductNotFound } from "./errors.ts"

const Text = TrimmedText(128)
const ScopedInput = { principal: Principal, tenantId: Uuid }

/** A percent with up to four decimals between 0 and 100, for example `11` or `11.5000`. */
export const TaxRate = Schema.String.check(
  Schema.makeFilter(
    (value) => /^\d{1,3}(\.\d{1,4})?$/.test(value) && rateToTenThousandths(value) <= 1_000_000n,
    { expected: "a percent between 0 and 100 with at most four decimals" },
  ),
)

export const TaxDirection = Schema.Literals(["sales", "purchase"])

export type TaxDirection = Schema.Schema.Type<typeof TaxDirection>

export const TaxCode = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  code: Schema.String,
  name: Text,
  /** Normalized to four decimals. */
  rate: Schema.String,
  direction: TaxDirection,
  active: Schema.Boolean,
})

export type TaxCode = Schema.Schema.Type<typeof TaxCode>

export const ProductTaxDefault = Schema.Struct({
  tenantId: Uuid,
  productId: Uuid,
  direction: TaxDirection,
  taxCodeId: Uuid,
})

export type ProductTaxDefault = Schema.Schema.Type<typeof ProductTaxDefault>

export const ComputedTaxLine = Schema.Struct({
  key: Schema.String,
  taxCodeId: Schema.NullOr(Uuid),
  rate: Schema.String,
  base: FinancialMajorAmount,
  tax: FinancialMajorAmount,
})

export const TaxComputation = Schema.Struct({
  lines: Schema.Array(ComputedTaxLine),
  /** Tax per code, for the tax summary of a document. */
  summary: Schema.Array(
    Schema.Struct({ taxCodeId: Uuid, base: FinancialMajorAmount, tax: FinancialMajorAmount }),
  ),
  totalTax: FinancialMajorAmount,
})

export type TaxComputation = Schema.Schema.Type<typeof TaxComputation>

export const ListTaxCodesInput = Schema.Struct({
  ...ScopedInput,
  direction: Schema.optionalKey(TaxDirection),
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 }))),
})

export const CreateTaxCodeInput = Schema.Struct({
  ...ScopedInput,
  code: Text,
  name: Text,
  rate: TaxRate,
  direction: TaxDirection,
})

export const SetProductTaxDefaultInput = Schema.Struct({
  ...ScopedInput,
  productId: Uuid,
  direction: TaxDirection,
  taxCodeId: Uuid,
})

export const DetermineTaxCodesInput = Schema.Struct({
  ...ScopedInput,
  direction: TaxDirection,
  productIds: Schema.Array(Uuid).check(Schema.isMaxLength(500)),
})

/** Tax-exclusive amounts; a line without a tax code is untaxed. */
export const ComputeTaxInput = Schema.Struct({
  ...ScopedInput,
  direction: TaxDirection,
  lines: Schema.Array(
    Schema.Struct({
      key: Schema.String,
      base: FinancialMajorAmount,
      taxCodeId: Schema.NullOr(Uuid),
    }),
  ).check(Schema.isMaxLength(500)),
})

export type CreateTaxCodeCommand = Omit<Schema.Schema.Type<typeof CreateTaxCodeInput>, "principal">

type CommonFailure = AuthorizationDenied | DatabaseFailure | Schema.SchemaError

export interface TaxService {
  readonly listTaxCodes: (
    input: Schema.Codec.Encoded<typeof ListTaxCodesInput>,
  ) => Effect.Effect<ReadonlyArray<TaxCode>, CommonFailure>
  readonly createTaxCode: (
    input: Schema.Codec.Encoded<typeof CreateTaxCodeInput>,
  ) => Effect.Effect<TaxCode, TaxCodeAlreadyExists | CommonFailure>
  readonly setProductTaxDefault: (
    input: Schema.Codec.Encoded<typeof SetProductTaxDefaultInput>,
  ) => Effect.Effect<ProductTaxDefault, TaxCodeNotFound | TaxProductNotFound | CommonFailure>
  /** The default tax code id per product, or null when the product has none. */
  readonly determineTaxCodes: (
    input: Schema.Codec.Encoded<typeof DetermineTaxCodesInput>,
  ) => Effect.Effect<ReadonlyMap<string, string | null>, CommonFailure>
  readonly computeTax: (
    input: Schema.Codec.Encoded<typeof ComputeTaxInput>,
  ) => Effect.Effect<TaxComputation, TaxCodeNotFound | CommonFailure>
}

export const TaxService = Context.Service<TaxService>("RITSEI/TaxService")

/** `11.5` → 115000 ten-thousandths of a percent. */
export const rateToTenThousandths = (rate: string): bigint => {
  const [whole = "0", fraction = ""] = rate.split(".")

  return BigInt(whole) * 10_000n + BigInt(fraction.padEnd(4, "0").slice(0, 4))
}

export const normalizeRate = (rate: string): string => {
  const scaled = rateToTenThousandths(rate)

  return `${scaled / 10_000n}.${(scaled % 10_000n).toString().padStart(4, "0")}`
}

/** Tax on a tax-exclusive base, rounded half up to the cent. */
export const taxOn = (base: string, rate: string): string => {
  const numerator = requireExactMajorToMinor(base, 2) * rateToTenThousandths(rate)
  const denominator = 1_000_000n

  return formatSignedMinor((numerator * 2n + denominator) / (denominator * 2n), 2)
}
