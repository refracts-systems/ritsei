/**
 * Customer credit staged for ADR-0124 phase 5 (`SAL-CREDIT-1`, `SAL-CREDIT-2`). Production confirms
 * a draft order inside one transaction that locks the customer, reads the receivable balance and
 * the confirmed-not-invoiced amount from Billing, and refuses when they plus the order total pass
 * the limit, so of two orders that fit alone but not together only one is confirmed. On the Effect
 * Cluster host Sales and Billing commit separately and there is no row lock, so the customer's
 * exposure is one aggregate that decides the check and holds a reservation for each confirmed order.
 * This model states that staging and nothing else; there is no cutover.
 *
 * - **The exposure aggregate is the lock.** One aggregate per customer holds the limit, the
 *   receivable balance, and a reservation per confirmed order, so the check and the reservation are
 *   one commit and two orders for the same customer serialize on it (`SAL-CREDIT-2`).
 * - **The reservation is committed before the order is confirmed.** Confirmation is a saga: reserve
 *   credit, claim the confirmation key (`SAL-ORDER-2`), mark the order confirmed. A refusal at the
 *   first step leaves the order a draft with nothing reserved, the production answer. A refusal at
 *   the key claim releases the reservation (the compensation) and returns the order to a draft.
 * - **A retried confirmation is not checked again:** reserving an order that already holds a
 *   reservation records nothing, even after the limit was lowered, as the rule says.
 * - **Committed is reserved totals less invoiced net over those orders, never below zero,** the
 *   production arithmetic. An invoice moves an amount from committed to receivable in one event, so
 *   Billing's lag on an invoice over-counts nothing and never lets an order past the limit.
 * - **Receivable lag is safe only in one direction.** A settlement or credit note that arrives late
 *   keeps the balance too high (an order may be refused that production would allow). A receivable
 *   increase that no reservation preceded (an invoice for no sales order) that arrives late lets an
 *   order past the limit; when it arrives the exposure is over the limit and nothing unconfirms an
 *   order. The accounting owner must accept that lag in writing, or exposure stays on PostgreSQL.
 * - **No limit never refuses** but still reserves, so a limit set later counts those orders.
 * - **Repeated references record nothing,** for invoices and receivable changes.
 *
 * Not modelled: the non-negative limit check, the capability (`sales.credit_limit.configure`), a
 * customer without a party role or legal entity (never gated), cancellation of a confirmed order,
 * and who is told of a refusal. Test-only: not exported from `mod.ts`.
 */
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import { Activity, Workflow } from "effect/workflow"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import {
  formatSignedMinor,
  requireExactMajorToMinor,
} from "../../../../framework/foundation/mod.ts"

const minor = (value: string) =>
  value.startsWith("-")
    ? -requireExactMajorToMinor(value.slice(1), 2)
    : requireExactMajorToMinor(value, 2)

const major = (value: bigint) => formatSignedMinor(value, 2)

// ---------------------------------------------------------------- the exposure

export const CustomerId = Schema.String.pipe(Schema.brand("ExposureCustomerId"))

export class CreditLimitExceeded extends Domain.Rejection("CreditLimitExceeded", {
  creditLimit: Schema.String,
  receivableBalance: Schema.String,
  orderTotal: Schema.String,
}) {}

export class LimitSet extends Domain.Event("CreditLimitSet", {
  creditLimit: Schema.NullOr(Schema.String),
}) {}

export class CreditReserved extends Domain.Event("CreditReserved", {
  orderId: Schema.String,
  total: Schema.String,
}) {}

export class CreditReleased extends Domain.Event("CreditReleased", { orderId: Schema.String }) {}

export class InvoiceCounted extends Domain.Event("InvoiceCounted", {
  reference: Schema.String,
  orderId: Schema.String,
  net: Schema.String,
  total: Schema.String,
}) {}

export class ReceivableChanged extends Domain.Event("ReceivableChanged", {
  reference: Schema.String,
  delta: Schema.String,
}) {}

export class SetCreditLimit extends Domain.Command("SetCreditLimit", {
  target: CustomerId,
  input: { creditLimit: Schema.NullOr(Schema.String) },
  events: [LimitSet],
}) {}

export class ReserveCredit extends Domain.Command("ReserveCredit", {
  target: CustomerId,
  input: { orderId: Schema.String, total: Schema.String },
  events: [CreditReserved],
  rejects: [CreditLimitExceeded],
}) {}

export class ReleaseCredit extends Domain.Command("ReleaseCredit", {
  target: CustomerId,
  input: { orderId: Schema.String },
  events: [CreditReleased],
}) {}

export class CountInvoice extends Domain.Command("CountInvoice", {
  target: CustomerId,
  input: {
    reference: Schema.String,
    orderId: Schema.String,
    net: Schema.String,
    total: Schema.String,
  },
  events: [InvoiceCounted],
}) {}

export class ChangeReceivable extends Domain.Command("ChangeReceivable", {
  target: CustomerId,
  input: { reference: Schema.String, delta: Schema.String },
  events: [ReceivableChanged],
}) {}

const Exposure = Schema.Struct({
  creditLimit: Schema.NullOr(Schema.String),
  receivable: Schema.String,
  /** The total each confirmed order reserved, and the net invoiced against it. */
  reserved: Schema.Record(Schema.String, Schema.String),
  invoiced: Schema.Record(Schema.String, Schema.String),
  references: Schema.Array(Schema.String),
})

type Exposure = typeof Exposure.Type

/** Confirmed orders less what was invoiced against them, never below zero. */
const committedOf = (s: Exposure) => {
  const reserved = Object.values(s.reserved).reduce((sum, total) => sum + minor(total), 0n)

  const invoiced = Object.keys(s.reserved).reduce(
    (sum, orderId) => sum + minor(s.invoiced[orderId] ?? "0.00"),
    0n,
  )

  return reserved > invoiced ? reserved - invoiced : 0n
}

/** One customer's limit, receivable balance, and the credit each confirmed order holds. */
export class CustomerExposure extends Domain.Aggregate("CustomerExposure", {
  id: CustomerId,
  state: Exposure,
  initial: { creditLimit: null, receivable: "0.00", reserved: {}, invoiced: {}, references: [] },
  commands: [SetCreditLimit, ReserveCredit, ReleaseCredit, CountInvoice, ChangeReceivable],
  decide: {
    SetCreditLimit: (s, cmd) =>
      s.creditLimit === cmd.creditLimit ? [] : [new LimitSet({ creditLimit: cmd.creditLimit })],
    ReserveCredit: (s, cmd) => {
      // A retried confirmation of a confirmed order is not checked again.
      if (s.reserved[cmd.orderId] !== undefined) return []

      if (
        s.creditLimit !== null &&
        minor(s.receivable) + committedOf(s) + minor(cmd.total) > minor(s.creditLimit)
      ) {
        return new CreditLimitExceeded({
          creditLimit: s.creditLimit,
          receivableBalance: s.receivable,
          orderTotal: cmd.total,
        })
      }

      return [new CreditReserved({ orderId: cmd.orderId, total: cmd.total })]
    },
    ReleaseCredit: (s, cmd) =>
      s.reserved[cmd.orderId] === undefined ? [] : [new CreditReleased({ orderId: cmd.orderId })],
    CountInvoice: (s, cmd) =>
      s.references.includes(cmd.reference)
        ? []
        : [
            new InvoiceCounted({
              reference: cmd.reference,
              orderId: cmd.orderId,
              net: cmd.net,
              total: cmd.total,
            }),
          ],
    ChangeReceivable: (s, cmd) =>
      s.references.includes(cmd.reference)
        ? []
        : [new ReceivableChanged({ reference: cmd.reference, delta: cmd.delta })],
  },
  evolve: {
    CreditLimitSet: (s, e) => ({ ...s, creditLimit: e.creditLimit }),
    CreditReserved: (s, e) => ({ ...s, reserved: { ...s.reserved, [e.orderId]: e.total } }),
    CreditReleased: (s, e) => ({
      ...s,
      reserved: Object.fromEntries(Object.entries(s.reserved).filter(([id]) => id !== e.orderId)),
    }),
    InvoiceCounted: (s, e) => ({
      ...s,
      receivable: major(minor(s.receivable) + minor(e.total)),
      invoiced: {
        ...s.invoiced,
        [e.orderId]: major(minor(s.invoiced[e.orderId] ?? "0.00") + minor(e.net)),
      },
      references: [...s.references, e.reference],
    }),
    ReceivableChanged: (s, e) => ({
      ...s,
      receivable: major(minor(s.receivable) + minor(e.delta)),
      references: [...s.references, e.reference],
    }),
  },
}) {}

// ---------------------------------------------------------------- the confirmation key

export const KeyId = Schema.String.pipe(Schema.brand("CreditedKeyId"))

export class ClaimHeld extends Domain.Rejection("CreditedClaimHeld", { holder: Schema.String }) {}

export class KeyClaimed extends Domain.Event("CreditedKeyClaimed", { holder: Schema.String }) {}

export class ClaimKey extends Domain.Command("ClaimCreditedKey", {
  target: KeyId,
  input: { holder: Schema.String },
  events: [KeyClaimed],
  rejects: [ClaimHeld],
}) {}

/** A confirmation key belongs to one order; the same order claiming again takes nothing. */
export class KeyClaim extends Domain.Aggregate("KeyClaim", {
  id: KeyId,
  state: Schema.NullOr(Schema.String),
  initial: null,
  commands: [ClaimKey],
  decide: {
    ClaimCreditedKey: (s, cmd) => {
      if (s === null) return [new KeyClaimed({ holder: cmd.holder })]

      return s === cmd.holder ? [] : new ClaimHeld({ holder: s })
    },
  },
  evolve: {
    CreditedKeyClaimed: (_, e) => e.holder,
  },
}) {}

// ---------------------------------------------------------------- the order

export const OrderId = Schema.String.pipe(Schema.brand("CreditedOrderId"))

export class OrderNotFound extends Domain.Rejection("CreditedOrderNotFound") {}

const Terms = {
  customerId: Schema.String,
  total: Schema.String,
  confirmationKey: Schema.String,
}

export class OrderDrafted extends Domain.Event("CreditedOrderDrafted", Terms) {}

export class ConfirmationRequested extends Domain.Event("CreditedConfirmationRequested", {
  ...Terms,
  /** Which try this is: a retry after a refusal runs its own saga. */
  attempt: Schema.Int,
}) {}

export class OrderConfirmed extends Domain.Event("CreditedOrderConfirmed", {}) {}

/** The confirmation stopped at a refusal; the order is a draft again. */
export class ConfirmationRefused extends Domain.Event("CreditedConfirmationRefused", {}) {}

export class DraftOrder extends Domain.Command("DraftCreditedOrder", {
  target: OrderId,
  input: Terms,
  events: [OrderDrafted],
}) {}

export class RequestConfirmation extends Domain.Command("RequestCreditedConfirmation", {
  target: OrderId,
  input: {},
  events: [ConfirmationRequested],
  rejects: [OrderNotFound],
}) {}

export class MarkConfirmed extends Domain.Command("MarkCreditedOrderConfirmed", {
  target: OrderId,
  input: {},
  events: [OrderConfirmed],
}) {}

export class RefuseConfirmation extends Domain.Command("RefuseCreditedConfirmation", {
  target: OrderId,
  input: {},
  events: [ConfirmationRefused],
}) {}

const TermsStruct = Schema.Struct(Terms)

const Absent = Schema.TaggedStruct("Absent", {})
const Draft = Schema.TaggedStruct("Draft", { ...Terms, attempts: Schema.Int })
const Confirming = Schema.TaggedStruct("Confirming", { ...Terms, attempt: Schema.Int })
const Confirmed = Schema.TaggedStruct("Confirmed", Terms)

const termsOf = ({ customerId, total, confirmationKey }: typeof TermsStruct.Type) => ({
  customerId,
  total,
  confirmationKey,
})

export class CreditedOrder extends Domain.Aggregate("CreditedOrder", {
  id: OrderId,
  state: Schema.Union([Absent, Draft, Confirming, Confirmed]),
  initial: Absent.make({}),
  commands: [DraftOrder, RequestConfirmation, MarkConfirmed, RefuseConfirmation],
  decide: {
    DraftCreditedOrder: (s, cmd) =>
      Predicate.isTagged(s, "Absent") ? [new OrderDrafted(termsOf(cmd))] : [],
    RequestCreditedConfirmation: (s) => {
      if (Predicate.isTagged(s, "Absent")) return new OrderNotFound()

      // Only a draft confirms; any other state returns the order as it is.
      return Predicate.isTagged(s, "Draft")
        ? [new ConfirmationRequested({ ...termsOf(s), attempt: s.attempts + 1 })]
        : []
    },
    MarkCreditedOrderConfirmed: (s) =>
      Predicate.isTagged(s, "Confirming") ? [new OrderConfirmed()] : [],
    RefuseCreditedConfirmation: (s) =>
      Predicate.isTagged(s, "Confirming") ? [new ConfirmationRefused()] : [],
  },
  evolve: {
    CreditedOrderDrafted: (_, e) => Draft.make({ ...termsOf(e), attempts: 0 }),
    CreditedConfirmationRequested: (_, e) => Confirming.make({ ...termsOf(e), attempt: e.attempt }),
    CreditedOrderConfirmed: (s) =>
      Predicate.isTagged(s, "Confirming") ? Confirmed.make(termsOf(s)) : s,
    CreditedConfirmationRefused: (s) =>
      Predicate.isTagged(s, "Confirming") ? Draft.make({ ...termsOf(s), attempts: s.attempt }) : s,
  },
}) {}

// ---------------------------------------------------------------- one confirmation attempt

/** `<order>/<attempt>`: a confirmation retried after a refusal is a new run, not a repeat. */
export const AttemptId = Schema.String.pipe(Schema.brand("CreditedAttemptId"))

export const attemptId = (orderId: string, attempt: number) =>
  AttemptId.make(`${orderId}/${attempt}`)

export class AttemptFinished extends Domain.Event("CreditedAttemptFinished", {}) {}

export class FinishAttempt extends Domain.Command("FinishCreditedAttempt", {
  target: AttemptId,
  input: {},
  events: [AttemptFinished],
}) {}

const Running = Schema.TaggedStruct("Running", {})
const Finished = Schema.TaggedStruct("Finished", {})

export class ConfirmAttempt extends Domain.Aggregate("CreditedConfirmAttempt", {
  id: AttemptId,
  state: Schema.Union([Running, Finished]),
  initial: Running.make({}),
  commands: [FinishAttempt],
  decide: {
    FinishCreditedAttempt: (s) => (Predicate.isTagged(s, "Running") ? [new AttemptFinished()] : []),
  },
  evolve: {
    CreditedAttemptFinished: () => Finished.make({}),
  },
}) {}

// ---------------------------------------------------------------- the saga

const ConfirmInput = { orderId: Schema.String, ...Terms }

type ConfirmRun = Schema.Struct<typeof ConfirmInput>["Type"] & {
  readonly key: typeof AttemptId.Type
}

export class ConfirmWithCredit extends Domain.Saga("ConfirmWithCredit", {
  key: AttemptId,
  input: ConfirmInput,
  rejects: [CreditLimitExceeded, ClaimHeld],
}) {}

export const ConfirmWithCreditLive = ConfirmWithCredit.toLayer(
  Effect.gen(function* () {
    const exposures = yield* CustomerExposure
    const claims = yield* KeyClaim
    const orders = yield* CreditedOrder
    const attempts = yield* ConfirmAttempt

    return Effect.fn(function* ({ key, orderId, customerId, total, confirmationKey }: ConfirmRun) {
      // A refusal at any step is recorded on the order after the compensation ran.
      yield* Workflow.addFinalizer((exit) =>
        Exit.isFailure(exit)
          ? orders
              .send(OrderId.make(orderId), new RefuseConfirmation({}))
              .pipe(Effect.asVoid, Effect.orDie)
          : Effect.void,
      )

      yield* Activity.make({
        name: "reserve",
        success: Schema.Boolean,
        error: CreditLimitExceeded,
        execute: exposures
          .send(CustomerId.make(customerId), new ReserveCredit({ orderId, total }))
          .pipe(Effect.map((receipt) => receipt.events.length > 0)),
      }).pipe(
        ConfirmWithCredit.withCompensation((took) =>
          took
            ? Activity.make({
                name: "release",
                execute: exposures
                  .send(CustomerId.make(customerId), new ReleaseCredit({ orderId }))
                  .pipe(Effect.asVoid, Effect.orDie),
              })
            : Effect.void,
        ),
      )

      yield* Activity.make({
        name: "claim",
        error: ClaimHeld,
        execute: claims
          .send(KeyId.make(confirmationKey), new ClaimKey({ holder: orderId }))
          .pipe(Effect.asVoid),
      })

      yield* Activity.make({
        name: "confirmed",
        execute: orders
          .send(OrderId.make(orderId), new MarkConfirmed({}))
          .pipe(Effect.asVoid, Effect.orDie),
      })

      yield* Activity.make({
        name: "finished",
        execute: attempts.send(key, new FinishAttempt({})).pipe(Effect.asVoid, Effect.orDie),
      })
    })
  }),
)

/** Starts the confirmation once it is requested. */
export class ConfirmationStart extends Domain.Policy("CreditedConfirmationStart", {
  from: CreditedOrder,
  on: [ConfirmationRequested],
}) {}

export const ConfirmationStartLive = ConfirmationStart.toLayer(
  Effect.gen(function* () {
    const runs = yield* ConfirmWithCredit

    return Effect.fn(function* ({ source, event }) {
      yield* runs.start(attemptId(source.id, event.attempt), {
        orderId: source.id,
        customerId: event.customerId,
        total: event.total,
        confirmationKey: event.confirmationKey,
      })
    })
  }),
)

export class SalesCredit extends Domain.Model("SalesCredit", {
  aggregates: [CreditedOrder, CustomerExposure, KeyClaim, ConfirmAttempt],
  policies: [ConfirmationStart],
  sagas: [ConfirmWithCredit],
}) {}

export const SalesCreditHandlers = Layer.mergeAll(ConfirmWithCreditLive, ConfirmationStartLive)
