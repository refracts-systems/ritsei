import * as Effect from "effect/Effect"

import {
  AuthorizationService,
  scopedCommand,
} from "../../../../framework/modules/authorization/mod.ts"
import { TaxCapabilities } from "./capabilities.ts"
import {
  AddTaxCodeRateInput,
  ComputeTaxInput,
  CreateTaxCodeInput,
  DetermineTaxCodesInput,
  ListTaxCodesInput,
  SetProductTaxDefaultInput,
  type TaxService,
} from "./contract.ts"
import { TaxCodeNotFound } from "./errors.ts"
import type { TaxStore } from "./store.ts"
import { computeTaxLines, firstUnusableCode } from "./tax-decisions.ts"
import type * as Schema from "effect/Schema"

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

    const addTaxCodeRate = Effect.fn("TaxService.addTaxCodeRate")(function* (
      input: Schema.Codec.Encoded<typeof AddTaxCodeRateInput>,
    ) {
      const decoded = yield* authorized(AddTaxCodeRateInput, TaxCapabilities.taxRateSchedule)(input)
      const { principal: _principal, ...value } = decoded

      return yield* store.addTaxCodeRate(value)
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

      const stored = yield* store.getTaxCodes(decoded.tenantId, ids)
      const unusable = firstUnusableCode(stored, decoded.direction, decoded.lines)

      if (unusable !== undefined) {
        return yield* Effect.fail(
          new TaxCodeNotFound({ tenantId: decoded.tenantId, taxCodeId: unusable }),
        )
      }

      // The rate in force depends on the transaction date, so periods are read only with one.
      const periods =
        decoded.date === undefined
          ? []
          : yield* store.ratePeriodsUpTo(decoded.tenantId, ids, decoded.date)

      return computeTaxLines({
        date: decoded.date,
        codes: stored,
        periods,
        lines: decoded.lines,
      })
    })

    return {
      listTaxCodes,
      createTaxCode,
      addTaxCodeRate,
      setProductTaxDefault,
      determineTaxCodes,
      computeTax,
    } satisfies TaxService
  })
