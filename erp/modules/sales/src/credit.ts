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
}

export const CreditExposure = Context.Service<CreditExposure>("RITSEI/SalesCreditExposure")

/** For compositions that have no billing: nobody owes anything. */
export const NoCreditExposureLive = Layer.succeed(CreditExposure, {
  receivableBalance: () => Effect.succeed("0.00"),
})

/** A customer's credit limit and how much of it is used; no limit leaves `available` null. */
export const CreditStanding = Schema.Struct({
  customerId: Uuid,
  creditLimit: Schema.NullOr(Schema.String),
  receivableBalance: Schema.String,
  available: Schema.NullOr(Schema.String),
})

export type CreditStanding = Schema.Schema.Type<typeof CreditStanding>

const minor = (value: string) => requireExactMajorToMinor(value.replace(/^-/, ""), 2)

const signed = (value: string) => (value.startsWith("-") ? -minor(value) : minor(value))

/** True when the balance plus the order total goes past the limit. */
export const exceedsCreditLimit = (creditLimit: string, balance: string, orderTotal: string) =>
  signed(balance) + signed(orderTotal) > signed(creditLimit)

export const standingOf = (
  customerId: string,
  creditLimit: string | null,
  receivableBalance: string,
): CreditStanding => ({
  customerId,
  creditLimit,
  receivableBalance,
  available:
    creditLimit === null
      ? null
      : formatSignedMinor(signed(creditLimit) - signed(receivableBalance), 2),
})
