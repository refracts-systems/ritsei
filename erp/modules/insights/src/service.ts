import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import {
  formatSignedMinor,
  requireSignedMajorToMinor,
} from "../../../../framework/foundation/mod.ts"
import type { AuthorizationDenied } from "../../../../framework/modules/authorization/mod.ts"
import { GeneralLedgerService } from "../../accounting/mod.ts"
import { BillingService } from "../../billing/mod.ts"
import { SalesDocumentService } from "../../sales/mod.ts"
import { SettlementService } from "../../settlement/mod.ts"
import { InsightsService, type Kpis, KpisInput } from "./contract.ts"
import { periodDates } from "./period.ts"

const minor = (value: string) => requireSignedMajorToMinor(value, 2)
const major = (value: bigint) => formatSignedMinor(value, 2)

/** What an owner answered for one figure: its value, or why there is none. */
type Answer<A> =
  | { readonly status: "ok"; readonly value: A }
  | { readonly status: "denied" | "unavailable"; readonly value: null }

export const makeInsightsService = Effect.gen(function* () {
  const ledger = yield* GeneralLedgerService
  const billing = yield* BillingService
  const salesDocuments = yield* SalesDocumentService
  const settlement = yield* SettlementService

  const kpisOf = Effect.fn("InsightsService.kpis")(function* (
    input: Schema.Codec.Encoded<typeof KpisInput>,
  ) {
    const decoded = yield* Schema.decodeUnknownEffect(KpisInput)(input)

    const dates = periodDates(decoded.period)

    const scope = {
      principal: decoded.principal,
      tenantId: decoded.tenantId,
      legalEntityId: decoded.legalEntityId,
    }

    // An owner that denies the caller leaves its figure out instead of showing a zero; only a
    // caller denied by every owner is told so.
    const denials: Array<AuthorizationDenied> = []

    const answer = <A, E>(
      effect: Effect.Effect<A, E>,
    ): Effect.Effect<
      Answer<A>,
      Exclude<E, { readonly _tag: "AuthorizationDenied" | "PostingRuleNotFound" }>
    > =>
      // SAFETY: the `catch` below removes exactly the two tags the return type excludes.
      effect.pipe(
        Effect.map((value): Answer<A> => ({ status: "ok", value })),
        Effect.catch((error) => {
          // SAFETY: every owner failure is a tagged error; the tag is only read.
          const tag = (error as { readonly _tag?: string })._tag

          if (tag === "AuthorizationDenied") {
            // SAFETY: the tag was just checked to be `AuthorizationDenied`.
            denials.push(error as AuthorizationDenied)

            return Effect.succeed<Answer<A>>({ status: "denied", value: null })
          }

          return tag === "PostingRuleNotFound"
            ? Effect.succeed<Answer<A>>({ status: "unavailable", value: null })
            : Effect.fail(error)
        }),
      ) as never

    const overdue = (side: "receivable" | "payable", asOf: string) =>
      settlement
        .aging({ ...scope, side, asOf })
        .pipe(
          Effect.map((report) =>
            major(
              [
                report.totals.days1To30,
                report.totals.days31To60,
                report.totals.days61To90,
                report.totals.over90,
              ].reduce((sum, bucket) => sum + minor(bucket), 0n),
            ),
          ),
        )

    const netSales = (from: string, to: string) =>
      billing.netSales({ ...scope, from, to }).pipe(Effect.map((sales) => sales.netSales))

    const roleBalance = (role: "cash" | "inventory", asOf: string) =>
      ledger.roleBalance({ ...scope, role, asOf }).pipe(Effect.map((balance) => balance.balance))

    const undelivered = (asOf: string) =>
      salesDocuments
        .getUndeliveredOrders({ ...scope, asOf })
        .pipe(Effect.map((result) => ({ value: result.value, orders: result.orders })))

    const both = <A, E>(read: (current: boolean) => Effect.Effect<A, E>) =>
      Effect.all({ current: answer(read(true)), previous: answer(read(false)) })

    const kpi = (figures: {
      readonly current: Answer<string>
      readonly previous: Answer<string>
    }) => ({
      status: figures.current.status,
      value: figures.current.value,
      previous: figures.previous.value,
    })

    const sales = yield* both((now) =>
      now ? netSales(dates.from, dates.to) : netSales(dates.previousFrom, dates.previousTo),
    )

    const receivable = yield* both((now) =>
      overdue("receivable", now ? dates.to : dates.previousTo),
    )

    const payable = yield* both((now) => overdue("payable", now ? dates.to : dates.previousTo))
    const cash = yield* both((now) => roleBalance("cash", now ? dates.to : dates.previousTo))
    const stock = yield* both((now) => roleBalance("inventory", now ? dates.to : dates.previousTo))
    const undeliveredOrders = yield* both((now) => undelivered(now ? dates.to : dates.previousTo))

    // Settlement answers both overdue figures, so its denial counts once.
    const answered = [sales, receivable, cash, undeliveredOrders, stock].map(
      (figures) => figures.current.status,
    )

    if (answered.every((status) => status === "denied")) return yield* Effect.fail(denials[0]!)

    return {
      legalEntityId: decoded.legalEntityId,
      period: decoded.period,
      from: dates.from,
      to: dates.to,
      previousPeriod: dates.previousPeriod,
      netSales: kpi(sales),
      receivableOverdue: kpi(receivable),
      payableOverdue: kpi(payable),
      cash: kpi(cash),
      confirmedUndelivered: {
        status: undeliveredOrders.current.status,
        value: undeliveredOrders.current.value?.value ?? null,
        previous: undeliveredOrders.previous.value?.value ?? null,
        orders: undeliveredOrders.current.value?.orders ?? null,
        previousOrders: undeliveredOrders.previous.value?.orders ?? null,
      },
      inventoryValue: kpi(stock),
    } satisfies Kpis
  })

  return { kpis: kpisOf } satisfies InsightsService
})

export const InsightsLive = Layer.effect(InsightsService, makeInsightsService)
