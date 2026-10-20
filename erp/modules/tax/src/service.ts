import * as Effect from "effect/Effect"

import {
  formatSignedMinor,
  requireExactMajorToMinor,
} from "../../../../framework/foundation/mod.ts"
import {
  AuthorizationService,
  scopedCommand,
} from "../../../../framework/modules/authorization/mod.ts"
import { TaxCapabilities } from "./capabilities.ts"
import {
  ComputeTaxInput,
  CreateTaxCodeInput,
  DetermineTaxCodesInput,
  ListTaxCodesInput,
  SetProductTaxDefaultInput,
  taxOn,
  type TaxService,
} from "./contract.ts"
import { TaxCodeNotFound } from "./errors.ts"
import type { TaxStore } from "./store.ts"
import type * as Schema from "effect/Schema"

const minor = (value: string) => requireExactMajorToMinor(value, 2)
const major = (value: bigint) => formatSignedMinor(value, 2)

export const makeTaxServiceFromStore = <R>(storeEffect: Effect.Effect<TaxStore, never, R>) =>
  Effect.gen(function* () {
    const store = yield* storeEffect
    const authorization = yield* AuthorizationService
    const authorized = scopedCommand(authorization)

    const listTaxCodes = Effect.fn("TaxService.listTaxCodes")(function* (
      input: Schema.Codec.Encoded<typeof ListTaxCodesInput>,
    ) {
      const decoded = yield* authorized(ListTaxCodesInput, TaxCapabilities.taxCodeRead)(input)
      return yield* store.listTaxCodes(decoded.tenantId, decoded.direction, decoded.limit ?? 200)
    })

    const createTaxCode = Effect.fn("TaxService.createTaxCode")(function* (
      input: Schema.Codec.Encoded<typeof CreateTaxCodeInput>,
    ) {
      const decoded = yield* authorized(CreateTaxCodeInput, TaxCapabilities.taxCodeCreate)(input)
      const { principal: _principal, ...command } = decoded
      return yield* store.createTaxCode({ ...command, code: command.code.toUpperCase() })
    })

    const setProductTaxDefault = Effect.fn("TaxService.setProductTaxDefault")(function* (
      input: Schema.Codec.Encoded<typeof SetProductTaxDefaultInput>,
    ) {
      const decoded = yield* authorized(
        SetProductTaxDefaultInput,
        TaxCapabilities.productTaxConfigure,
      )(input)
      const { principal: _principal, ...value } = decoded
      return yield* store.setProductTaxDefault(value)
    })

    const determineTaxCodes = Effect.fn("TaxService.determineTaxCodes")(function* (
      input: Schema.Codec.Encoded<typeof DetermineTaxCodesInput>,
    ) {
      const decoded = yield* authorized(DetermineTaxCodesInput, TaxCapabilities.taxCodeRead)(input)
      const defaults = yield* store.productTaxDefaults(
        decoded.tenantId,
        decoded.direction,
        decoded.productIds,
      )
      const byProduct = new Map(defaults.map((value) => [value.productId, value.taxCodeId]))
      return new Map(
        decoded.productIds.map(
          (productId) => [productId, byProduct.get(productId) ?? null] as const,
        ),
      )
    })

    const computeTax = Effect.fn("TaxService.computeTax")(function* (
      input: Schema.Codec.Encoded<typeof ComputeTaxInput>,
    ) {
      const decoded = yield* authorized(ComputeTaxInput, TaxCapabilities.taxCodeRead)(input)
      const ids = [
        ...new Set(
          decoded.lines.flatMap((line) => (line.taxCodeId === null ? [] : [line.taxCodeId])),
        ),
      ]
      const codes = new Map(
        (yield* store.getTaxCodes(decoded.tenantId, ids)).map((code) => [code.id, code]),
      )
      for (const id of ids) {
        const code = codes.get(id)
        if (code === undefined || !code.active || code.direction !== decoded.direction) {
          return yield* Effect.fail(
            new TaxCodeNotFound({ tenantId: decoded.tenantId, taxCodeId: id }),
          )
        }
      }
      const summary = new Map<string, { base: bigint; tax: bigint }>()
      let totalTax = 0n
      const lines = decoded.lines.map((line) => {
        if (line.taxCodeId === null) {
          return { key: line.key, taxCodeId: null, rate: "0.0000", base: line.base, tax: "0.00" }
        }
        const code = codes.get(line.taxCodeId)!
        // Tax is computed per line and rounded half up, so document totals equal line sums.
        const tax = taxOn(line.base, code.rate)
        const current = summary.get(code.id) ?? { base: 0n, tax: 0n }
        summary.set(code.id, {
          base: current.base + minor(line.base),
          tax: current.tax + minor(tax),
        })
        totalTax += minor(tax)
        return { key: line.key, taxCodeId: code.id, rate: code.rate, base: line.base, tax }
      })
      return {
        lines,
        summary: [...summary].map(([taxCodeId, amounts]) => ({
          taxCodeId,
          base: major(amounts.base),
          tax: major(amounts.tax),
        })),
        totalTax: major(totalTax),
      }
    })

    return {
      listTaxCodes,
      createTaxCode,
      setProductTaxDefault,
      determineTaxCodes,
      computeTax,
    } satisfies TaxService
  })
