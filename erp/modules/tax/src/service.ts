import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  formatSignedMinor,
  requireExactMajorToMinor,
} from "../../../../framework/foundation/mod.ts"
import type { Principal } from "../../../../framework/modules/auth/mod.ts"
import { AuthorizationService } from "../../../../framework/modules/authorization/mod.ts"
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

const minor = (value: string) => requireExactMajorToMinor(value, 2)
const major = (value: bigint) => formatSignedMinor(value, 2)

export const makeTaxServiceFromStore = <R>(storeEffect: Effect.Effect<TaxStore, never, R>) =>
  Effect.gen(function* () {
    const store = yield* storeEffect
    const authorization = yield* AuthorizationService
    const authorize = (
      input: { principal: Schema.Schema.Type<typeof Principal>; tenantId: string },
      capability: string,
    ) =>
      authorization.authorize({ principal: input.principal, tenantId: input.tenantId, capability })

    const listTaxCodes = Effect.fn("TaxService.listTaxCodes")(function* (input: unknown) {
      const decoded = yield* Schema.decodeUnknownEffect(ListTaxCodesInput)(input)
      yield* authorize(decoded, TaxCapabilities.taxCodeRead)
      return yield* store.listTaxCodes(decoded.tenantId, decoded.direction, decoded.limit ?? 200)
    })

    const createTaxCode = Effect.fn("TaxService.createTaxCode")(function* (input: unknown) {
      const decoded = yield* Schema.decodeUnknownEffect(CreateTaxCodeInput)(input)
      yield* authorize(decoded, TaxCapabilities.taxCodeCreate)
      const { principal: _principal, ...command } = decoded
      return yield* store.createTaxCode({ ...command, code: command.code.toUpperCase() })
    })

    const setProductTaxDefault = Effect.fn("TaxService.setProductTaxDefault")(function* (
      input: unknown,
    ) {
      const decoded = yield* Schema.decodeUnknownEffect(SetProductTaxDefaultInput)(input)
      yield* authorize(decoded, TaxCapabilities.productTaxConfigure)
      const { principal: _principal, ...value } = decoded
      return yield* store.setProductTaxDefault(value)
    })

    const determineTaxCodes = Effect.fn("TaxService.determineTaxCodes")(function* (input: unknown) {
      const decoded = yield* Schema.decodeUnknownEffect(DetermineTaxCodesInput)(input)
      yield* authorize(decoded, TaxCapabilities.taxCodeRead)
      const defaults = yield* store.productTaxDefaults(
        decoded.tenantId,
        decoded.direction,
        decoded.productIds,
      )
      const byProduct = new Map(defaults.map((value) => [value.productId, value.taxCodeId]))
      return new Map(
        decoded.productIds.map((productId) => [productId, byProduct.get(productId) ?? null]),
      ) as ReadonlyMap<string, string | null>
    })

    const computeTax = Effect.fn("TaxService.computeTax")(function* (input: unknown) {
      const decoded = yield* Schema.decodeUnknownEffect(ComputeTaxInput)(input)
      yield* authorize(decoded, TaxCapabilities.taxCodeRead)
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
