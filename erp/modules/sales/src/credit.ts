import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import {
  type DatabaseFailure,
  formatSignedMinor,
  requireExactMajorToMinor,
  Uuid,
} from "../../../../framework/foundation/mod.ts"

/**
 * What a customer already owes. Sales asks and Billing answers, so Sales never imports Billing
 * (which depends on Sales); the runtime composes the answer (ADR-0108).
 */
export interface CreditExposure {
  readonly receivableBalance: (input: {
    readonly tenantId: string
    readonly legalEntityId: string
    readonly partyId: string
  }) => Effect.Effect<string, DatabaseFailure>
  /** The net amount already invoiced against these sales orders. */
  readonly invoicedNet: (input: {
    readonly tenantId: string
    readonly orderIds: ReadonlyArray<string>
  }) => Effect.Effect<string, DatabaseFailure>
}

export const CreditExposure = Context.Service<CreditExposure>("RITSEI/SalesCreditExposure")

/** For compositions that have no billing: nobody owes anything. */
export const NoCreditExposureLive = Layer.succeed(CreditExposure, {
  receivableBalance: () => Effect.succeed("0.00"),
  invoicedNet: () => Effect.succeed("0.00"),
})

/**
 * A customer's credit limit and how much of it is used: what they owe on open invoices, plus
 * confirmed orders not yet invoiced. No limit leaves `available` null.
 */
export const CreditStanding = Schema.Struct({
  customerId: Uuid,
  creditLimit: Schema.NullOr(Schema.String),
  receivableBalance: Schema.String,
  /** Confirmed orders less what has been invoiced against them. */
  confirmedNotInvoiced: Schema.String,
  available: Schema.NullOr(Schema.String),
})

export type CreditStanding = Schema.Schema.Type<typeof CreditStanding>

const minor = (value: string) => requireExactMajorToMinor(value.replace(/^-/, ""), 2)

const signed = (value: string) => (value.startsWith("-") ? -minor(value) : minor(value))

/** What confirmed orders still commit: their totals less what was invoiced against them. */
export const committedAmount = (orderTotals: ReadonlyArray<string>, invoicedNet: string) => {
  const committed =
    orderTotals.reduce((sum, total) => sum + signed(total), 0n) - signed(invoicedNet)

  return formatSignedMinor(committed < 0n ? 0n : committed, 2)
}

/** True when what the customer already carries plus the order total goes past the limit. */
export const exceedsCreditLimit = (
  creditLimit: string,
  exposure: { readonly receivableBalance: string; readonly confirmedNotInvoiced: string },
  orderTotal: string,
) =>
  signed(exposure.receivableBalance) + signed(exposure.confirmedNotInvoiced) + signed(orderTotal) >
  signed(creditLimit)

export const standingOf = (
  customerId: string,
  creditLimit: string | null,
  receivableBalance: string,
  confirmedNotInvoiced: string,
): CreditStanding => ({
  customerId,
  creditLimit,
  receivableBalance,
  confirmedNotInvoiced,
  available:
    creditLimit === null
      ? null
      : formatSignedMinor(
          signed(creditLimit) - signed(receivableBalance) - signed(confirmedNotInvoiced),
          2,
        ),
})
