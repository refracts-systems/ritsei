import { and, desc, eq, inArray, lte } from "drizzle-orm"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import {
  exchangeRates,
  legalEntityAccountingConfigurations,
} from "../../../../db/schema/accounting.ts"
import {
  CalendarDate,
  Database,
  type DatabaseFailure,
  Uuid,
} from "../../../../framework/foundation/mod.ts"
import { Principal } from "../../../../framework/modules/auth/mod.ts"
import {
  type AuthorizationDenied,
  AuthorizationService,
  scopedCommand,
} from "../../../../framework/modules/authorization/mod.ts"
import { AccountingCapabilities } from "./capabilities.ts"

const ScopedInput = { principal: Principal, tenantId: Uuid }
const Currency = Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/))

/** A rate as a decimal string with at most ten decimals, above zero. */
export const RateText = Schema.String.check(
  Schema.isPattern(/^(?!0+(\.0+)?$)\d{1,18}(\.\d{1,10})?$/),
)

export const SetExchangeRateInput = Schema.Struct({
  ...ScopedInput,
  fromCurrency: Currency,
  toCurrency: Currency,
  rateDate: CalendarDate,
  rate: RateText,
})

export const FindExchangeRateInput = Schema.Struct({
  ...ScopedInput,
  fromCurrency: Currency,
  toCurrency: Currency,
  asOf: CalendarDate,
})

export const ExchangeRate = Schema.Struct({
  fromCurrency: Currency,
  toCurrency: Currency,
  rateDate: CalendarDate,
  rate: RateText,
})

export type ExchangeRate = Schema.Schema.Type<typeof ExchangeRate>

export const LegalEntityCurrenciesInput = Schema.Struct({
  ...ScopedInput,
  legalEntityIds: Schema.Array(Uuid).check(Schema.isMaxLength(500)),
})

export class ExchangeRateInvalid extends Schema.TaggedError<ExchangeRateInvalid>()(
  "ExchangeRateInvalid",
  { tenantId: Uuid, reason: Schema.String },
) {}

type CommonFailure = AuthorizationDenied | DatabaseFailure | Schema.SchemaError

export interface ExchangeRateService {
  /** Enters or corrects the rate of one day; the same day replaces the earlier entry. */
  readonly set: (
    input: Schema.Codec.Encoded<typeof SetExchangeRateInput>,
  ) => Effect.Effect<ExchangeRate, ExchangeRateInvalid | CommonFailure>
  /** The latest rate on or before a day, or null when none was entered. */
  readonly find: (
    input: Schema.Codec.Encoded<typeof FindExchangeRateInput>,
  ) => Effect.Effect<ExchangeRate | null, CommonFailure>
  /** The base currency of each legal entity that has accounting configured. */
  readonly legalEntityCurrencies: (
    input: Schema.Codec.Encoded<typeof LegalEntityCurrenciesInput>,
  ) => Effect.Effect<ReadonlyMap<string, string>, CommonFailure>
}

export const ExchangeRateService = Context.Service<ExchangeRateService>(
  "RITSEI/ExchangeRateService",
)

export const makeExchangeRateService = Effect.gen(function* () {
  const database = yield* Database
  const authorization = yield* AuthorizationService
  const authorized = scopedCommand(authorization)

  const set = Effect.fn("ExchangeRateService.set")(function* (
    input: Schema.Codec.Encoded<typeof SetExchangeRateInput>,
  ) {
    const decoded = yield* authorized(
      SetExchangeRateInput,
      AccountingCapabilities.exchangeRateConfigure,
    )(input)

    if (decoded.fromCurrency === decoded.toCurrency) {
      return yield* Effect.fail(
        new ExchangeRateInvalid({
          tenantId: decoded.tenantId,
          reason: "a rate is between two different currencies",
        }),
      )
    }

    yield* database.query(
      (db) =>
        db
          .insert(exchangeRates)
          .values({
            tenantId: decoded.tenantId,
            fromCurrency: decoded.fromCurrency,
            toCurrency: decoded.toCurrency,
            rateDate: decoded.rateDate,
            rate: decoded.rate,
            enteredBy: decoded.principal.userAccountId,
          })
          .onConflictDoUpdate({
            target: [
              exchangeRates.tenantId,
              exchangeRates.fromCurrency,
              exchangeRates.toCurrency,
              exchangeRates.rateDate,
            ],
            set: { rate: decoded.rate, enteredBy: decoded.principal.userAccountId },
          }),
      "accounting.exchange_rate.set",
    )

    return {
      fromCurrency: decoded.fromCurrency,
      toCurrency: decoded.toCurrency,
      rateDate: decoded.rateDate,
      rate: decoded.rate,
    }
  })

  const find = Effect.fn("ExchangeRateService.find")(function* (
    input: Schema.Codec.Encoded<typeof FindExchangeRateInput>,
  ) {
    const decoded = yield* authorized(
      FindExchangeRateInput,
      AccountingCapabilities.ledgerRead,
    )(input)

    const [row] = yield* database.query(
      (db) =>
        db
          .select()
          .from(exchangeRates)
          .where(
            and(
              eq(exchangeRates.tenantId, decoded.tenantId),
              eq(exchangeRates.fromCurrency, decoded.fromCurrency),
              eq(exchangeRates.toCurrency, decoded.toCurrency),
              lte(exchangeRates.rateDate, decoded.asOf),
            ),
          )
          .orderBy(desc(exchangeRates.rateDate))
          .limit(1),
      "accounting.exchange_rate.find",
    )

    return row === undefined
      ? null
      : {
          fromCurrency: row.fromCurrency,
          toCurrency: row.toCurrency,
          rateDate: row.rateDate,
          // The column keeps ten decimals; the text drops trailing zeros for the contract.
          rate: row.rate.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, ""),
        }
  })

  const legalEntityCurrencies = Effect.fn("ExchangeRateService.legalEntityCurrencies")(function* (
    input: Schema.Codec.Encoded<typeof LegalEntityCurrenciesInput>,
  ) {
    const decoded = yield* authorized(
      LegalEntityCurrenciesInput,
      AccountingCapabilities.legalEntityRead,
    )(input)

    if (decoded.legalEntityIds.length === 0) return new Map<string, string>()

    const rows = yield* database.query(
      (db) =>
        db
          .select({
            legalEntityId: legalEntityAccountingConfigurations.legalEntityId,
            baseCurrency: legalEntityAccountingConfigurations.baseCurrency,
          })
          .from(legalEntityAccountingConfigurations)
          .where(
            and(
              eq(legalEntityAccountingConfigurations.tenantId, decoded.tenantId),
              inArray(legalEntityAccountingConfigurations.legalEntityId, [
                ...decoded.legalEntityIds,
              ]),
            ),
          ),
      "accounting.legal_entity.currencies",
    )

    return new Map(rows.map((row) => [row.legalEntityId, row.baseCurrency]))
  })

  return { set, find, legalEntityCurrencies } satisfies ExchangeRateService
})

export const ExchangeRatesLive = Layer.effect(ExchangeRateService, makeExchangeRateService)
