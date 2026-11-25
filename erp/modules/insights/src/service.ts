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
import { makeGroupReads } from "./group.ts"
import { periodDates } from "./period.ts"

const minor = (value: string) => requireSignedMajorToMinor(value, 2)
const major = (value: bigint) => formatSignedMinor(value, 2)

/** What an owner answered for one figure: its value, or why there is none. */
type Answer<A> =
  | { readonly status: "ok"; readonly value: A }
  | { readonly status: "denied" | "unavailable"; readonly value: null }

/** A figure now and a period earlier. */
type Pair<A> = { readonly current: Answer<A>; readonly previous: Answer<A> }

type Owner = "AuthorizationDenied" | "PostingRuleNotFound"

/**
 * Turns an owner's denial or missing posting rule into an answer instead of a failure, and keeps the
 * denials so a caller denied by every owner can be told so.
 */
const answerer = (denials: Array<AuthorizationDenied>) => {
  const answer = <A, E>(
    effect: Effect.Effect<A, E>,
  ): Effect.Effect<Answer<A>, Exclude<E, { readonly _tag: Owner }>> =>
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

  const pair = <A, E>(read: (current: boolean) => Effect.Effect<A, E>) =>
    Effect.all({ current: answer(read(true)), previous: answer(read(false)) })

  return pair
}

const amount = (figures: Pair<string>) => ({
  status: figures.current.status,
  value: figures.current.value,
  previous: figures.previous.value,
})

const undeliveredOf = (figures: Pair<{ readonly value: string; readonly orders: number }>) => ({
  status: figures.current.status,
  value: figures.current.value?.value ?? null,
  previous: figures.previous.value?.value ?? null,
  orders: figures.current.value?.orders ?? null,
  previousOrders: figures.previous.value?.orders ?? null,
})

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
    const pair = answerer(denials)

    /** The date a balance is read at: this period's last day, or the previous period's. */
    const lastDay = (current: boolean) => (current ? dates.to : dates.previousTo)

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

    const netSales = (current: boolean) =>
      billing
        .netSales({
          ...scope,
          from: current ? dates.from : dates.previousFrom,
          to: lastDay(current),
        })
        .pipe(Effect.map((sales) => sales.netSales))

    const roleBalance = (role: "cash" | "inventory", current: boolean) =>
      ledger
        .roleBalance({ ...scope, role, asOf: lastDay(current) })
        .pipe(Effect.map((balance) => balance.balance))

    const undelivered = (current: boolean) =>
      salesDocuments
        .getUndeliveredOrders({ ...scope, asOf: lastDay(current) })
        .pipe(Effect.map((result) => ({ value: result.value, orders: result.orders })))

    const sales = yield* pair(netSales)
    const receivable = yield* pair((current) => overdue("receivable", lastDay(current)))
    const payable = yield* pair((current) => overdue("payable", lastDay(current)))
    const cash = yield* pair((current) => roleBalance("cash", current))
    const stock = yield* pair((current) => roleBalance("inventory", current))
    const toDeliver = yield* pair(undelivered)

    // Settlement answers both overdue figures, so it is left out of the count of owners asked.
    const asked = [sales, receivable, cash, toDeliver, stock]

    if (asked.every((figures) => figures.current.status === "denied")) {
      return yield* Effect.fail(denials[0]!)
    }

    return {
      legalEntityId: decoded.legalEntityId,
      period: decoded.period,
      from: dates.from,
      to: dates.to,
      previousPeriod: dates.previousPeriod,
      netSales: amount(sales),
      receivableOverdue: amount(receivable),
      payableOverdue: amount(payable),
      cash: amount(cash),
      confirmedUndelivered: undeliveredOf(toDeliver),
      inventoryValue: amount(stock),
    } satisfies Kpis
  })

  const group = yield* makeGroupReads(kpisOf)

  return { kpis: kpisOf, ...group } satisfies InsightsService
})

export const InsightsLive = Layer.effect(InsightsService, makeInsightsService)
