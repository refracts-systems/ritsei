import * as Effect from "effect/Effect"

import { uuidv7 } from "../../../../framework/foundation/mod.ts"
import {
  normalizeRate,
  type ProductTaxDefault,
  type TaxCode,
  type TaxCodeRate,
} from "./contract.ts"
import { TaxCodeAlreadyExists, TaxCodeNotFound, TaxCodeRateAlreadyExists } from "./errors.ts"
import type { TaxStore } from "./store.ts"

/** Deterministic test store; product existence is not checked without the product schema. */
export const makeTaxMemoryStore = (): TaxStore => {
  const codes: TaxCode[] = []
  const periods: TaxCodeRate[] = []
  const defaults = new Map<string, ProductTaxDefault>()

  const defaultKey = (tenantId: string, productId: string, direction: string) =>
    `${tenantId}:${productId}:${direction}`

  return {
    listTaxCodes: (tenantId, direction, limit) =>
      Effect.sync(() =>
        codes
          .filter(
            (code) =>
              code.tenantId === tenantId &&
              (direction === undefined || code.direction === direction),
          )
          .toSorted((left, right) => left.code.localeCompare(right.code))
          .slice(0, limit),
      ),
    getTaxCodes: (tenantId, ids) =>
      Effect.sync(() =>
        codes.filter((code) => code.tenantId === tenantId && ids.includes(code.id)),
      ),
    createTaxCode: (command) =>
      Effect.suspend(() => {
        if (
          codes.some((code) => code.tenantId === command.tenantId && code.code === command.code)
        ) {
          return Effect.fail(
            new TaxCodeAlreadyExists({ tenantId: command.tenantId, code: command.code }),
          )
        }

        const code: TaxCode = {
          id: uuidv7(),
          tenantId: command.tenantId,
          code: command.code,
          name: command.name,
          rate: normalizeRate(command.rate),
          direction: command.direction,
          active: true,
        }

        codes.push(code)

        return Effect.succeed(code)
      }),
    addTaxCodeRate: (value) =>
      Effect.suspend((): Effect.Effect<TaxCodeRate, TaxCodeNotFound | TaxCodeRateAlreadyExists> => {
        if (
          !codes.some((code) => code.tenantId === value.tenantId && code.id === value.taxCodeId)
        ) {
          return Effect.fail(
            new TaxCodeNotFound({ tenantId: value.tenantId, taxCodeId: value.taxCodeId }),
          )
        }

        if (
          periods.some(
            (period) =>
              period.tenantId === value.tenantId &&
              period.taxCodeId === value.taxCodeId &&
              period.effectiveFrom === value.effectiveFrom,
          )
        ) {
          return Effect.fail(new TaxCodeRateAlreadyExists(value))
        }

        const period = { ...value, rate: normalizeRate(value.rate) }
        periods.push(period)

        return Effect.succeed(period)
      }),
    ratePeriodsUpTo: (tenantId, taxCodeIds, date) =>
      Effect.sync(() =>
        periods.filter(
          (period) =>
            period.tenantId === tenantId &&
            taxCodeIds.includes(period.taxCodeId) &&
            period.effectiveFrom <= date,
        ),
      ),
    setProductTaxDefault: (value) =>
      Effect.suspend(() => {
        const code = codes.find(
          (candidate) =>
            candidate.tenantId === value.tenantId &&
            candidate.id === value.taxCodeId &&
            candidate.direction === value.direction,
        )

        if (code === undefined) {
          return Effect.fail(
            new TaxCodeNotFound({ tenantId: value.tenantId, taxCodeId: value.taxCodeId }),
          )
        }

        defaults.set(defaultKey(value.tenantId, value.productId, value.direction), value)

        return Effect.succeed(value)
      }),
    productTaxDefaults: (tenantId, direction, productIds) =>
      Effect.sync(() =>
        productIds.flatMap((productId) => {
          const value = defaults.get(defaultKey(tenantId, productId, direction))

          return value === undefined ? [] : [value]
        }),
      ),
  }
}
