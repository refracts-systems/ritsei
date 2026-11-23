/**
 * Bank matching staged for ADR-0124 phase 5 (`SET-BANK-3`). Production locks the statement line,
 * then the payment, reads what is already matched on each, and records the match only if the
 * amount fits both, all in one transaction. On the Effect Cluster host the line and the payment are
 * separate aggregates that commit on their own pools, so the capacity of each becomes a hold that
 * its own aggregate decides, and a match is a saga: hold on the line, hold on the payment, then
 * record. This model states that staging and nothing else; there is no cutover, and whether the
 * rule moves or stays on its PostgreSQL transaction is the owner's decision.
 *
 * - **Each capacity is one aggregate.** The line holds what its matches took out of its open
 *   amount, the payment what they took out of its cash (amount less withholding), so two matches of
 *   one line or one payment serialize in that aggregate and the sum never exceeds either.
 * - **A refused payment hold compensates the line hold.** Between the two holds the line's capacity
 *   is held for a match that may still fail, so another match of the same line can be refused for
 *   capacity that comes back moments later. The failed match stays recorded and its id is spent.
 * - **A repeated match id records nothing,** whether it recorded or failed.
 * - **Reversal releases both holds and keeps the match.** A reversed match is marked, never
 *   deleted; reversing twice is safe; the freed capacity can be matched again.
 *
 * What changes for the caller: the refusal names the capacity that refused (the line first), where
 * production reports the smaller of the two as `available`. Not modelled: the legal entity, bank
 * account and direction check (`BankMatchMismatch`, a comparison of the two records), the
 * capability, who matched, and the report. Test-only: not exported from `mod.ts`.
 */
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import { Activity, Workflow } from "effect/workflow"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"

const Holds = Schema.Record(Schema.String, Schema.String)

const sum = (holds: Record<string, string>) =>
  Object.values(holds).reduce((total, amount) => total + BigInt(amount), 0n)

// ---------------------------------------------------------------- the statement line

export const LineId = Schema.String.pipe(Schema.brand("MatchLineId"))

export class LineExceedsAvailable extends Domain.Rejection("LineExceedsAvailable", {
  available: Schema.String,
}) {}

export class LineOpened extends Domain.Event("MatchLineOpened", { amount: Schema.String }) {}

export class LineHeld extends Domain.Event("MatchLineHeld", {
  matchId: Schema.String,
  amount: Schema.String,
}) {}

export class LineReleased extends Domain.Event("MatchLineReleased", { matchId: Schema.String }) {}

export class OpenLine extends Domain.Command("OpenMatchLine", {
  target: LineId,
  input: { amount: Schema.String },
  events: [LineOpened],
}) {}

export class HoldOnLine extends Domain.Command("HoldOnLine", {
  target: LineId,
  input: { matchId: Schema.String, amount: Schema.String },
  events: [LineHeld],
  rejects: [LineExceedsAvailable],
}) {}

export class ReleaseLine extends Domain.Command("ReleaseLine", {
  target: LineId,
  input: { matchId: Schema.String },
  events: [LineReleased],
}) {}

const Capacity = Schema.Struct({ total: Schema.String, holds: Holds })

/** The unmatched amount of a statement line: its amount less the holds of active matches. */
export class MatchLine extends Domain.Aggregate("MatchLine", {
  id: LineId,
  state: Capacity,
  initial: { total: "0", holds: {} },
  commands: [OpenLine, HoldOnLine, ReleaseLine],
  decide: {
    OpenMatchLine: (s, cmd) => (s.total === "0" ? [new LineOpened({ amount: cmd.amount })] : []),
    HoldOnLine: (s, cmd) => {
      if (s.holds[cmd.matchId] !== undefined) return []

      const available = BigInt(s.total) - sum(s.holds)

      return BigInt(cmd.amount) > available
        ? new LineExceedsAvailable({ available: String(available) })
        : [new LineHeld({ matchId: cmd.matchId, amount: cmd.amount })]
    },
    ReleaseLine: (s, cmd) =>
      s.holds[cmd.matchId] === undefined ? [] : [new LineReleased({ matchId: cmd.matchId })],
  },
  evolve: {
    MatchLineOpened: (s, e) => ({ ...s, total: e.amount }),
    MatchLineHeld: (s, e) => ({ ...s, holds: { ...s.holds, [e.matchId]: e.amount } }),
    MatchLineReleased: (s, e) => ({
      ...s,
      holds: Object.fromEntries(Object.entries(s.holds).filter(([id]) => id !== e.matchId)),
    }),
  },
}) {}

// ---------------------------------------------------------------- the payment

export const PaymentId = Schema.String.pipe(Schema.brand("MatchPaymentId"))

export class PaymentExceedsAvailable extends Domain.Rejection("PaymentExceedsAvailable", {
  available: Schema.String,
}) {}

export class PaymentOpened extends Domain.Event("MatchPaymentOpened", { cash: Schema.String }) {}

export class PaymentHeld extends Domain.Event("MatchPaymentHeld", {
  matchId: Schema.String,
  amount: Schema.String,
}) {}

export class PaymentReleased extends Domain.Event("MatchPaymentReleased", {
  matchId: Schema.String,
}) {}

export class OpenPayment extends Domain.Command("OpenMatchPayment", {
  target: PaymentId,
  /** The cash: the payment amount less any withholding. */
  input: { cash: Schema.String },
  events: [PaymentOpened],
}) {}

export class HoldOnPayment extends Domain.Command("HoldOnPayment", {
  target: PaymentId,
  input: { matchId: Schema.String, amount: Schema.String },
  events: [PaymentHeld],
  rejects: [PaymentExceedsAvailable],
}) {}

export class ReleasePayment extends Domain.Command("ReleasePayment", {
  target: PaymentId,
  input: { matchId: Schema.String },
  events: [PaymentReleased],
}) {}

/** The unmatched cash of a payment: its cash less the holds of active matches. */
export class MatchPayment extends Domain.Aggregate("MatchPayment", {
  id: PaymentId,
  state: Capacity,
  initial: { total: "0", holds: {} },
  commands: [OpenPayment, HoldOnPayment, ReleasePayment],
  decide: {
    OpenMatchPayment: (s, cmd) => (s.total === "0" ? [new PaymentOpened({ cash: cmd.cash })] : []),
    HoldOnPayment: (s, cmd) => {
      if (s.holds[cmd.matchId] !== undefined) return []

      const available = BigInt(s.total) - sum(s.holds)

      return BigInt(cmd.amount) > available
        ? new PaymentExceedsAvailable({ available: String(available) })
        : [new PaymentHeld({ matchId: cmd.matchId, amount: cmd.amount })]
    },
    ReleasePayment: (s, cmd) =>
      s.holds[cmd.matchId] === undefined ? [] : [new PaymentReleased({ matchId: cmd.matchId })],
  },
  evolve: {
    MatchPaymentOpened: (s, e) => ({ ...s, total: e.cash }),
    MatchPaymentHeld: (s, e) => ({ ...s, holds: { ...s.holds, [e.matchId]: e.amount } }),
    MatchPaymentReleased: (s, e) => ({
      ...s,
      holds: Object.fromEntries(Object.entries(s.holds).filter(([id]) => id !== e.matchId)),
    }),
  },
}) {}

// ---------------------------------------------------------------- the match

export const MatchId = Schema.String.pipe(Schema.brand("BankMatchId"))

export class BankMatchNotFound extends Domain.Rejection("BankMatchNotFound") {}

const Link = {
  lineId: Schema.String,
  paymentId: Schema.String,
  amount: Schema.String,
}

export class MatchRequested extends Domain.Event("BankMatchRequested", Link) {}

export class MatchRecorded extends Domain.Event("BankMatchRecorded", {}) {}

/** The match stopped at a capacity that refused it. */
export class MatchFailed extends Domain.Event("BankMatchFailed", {}) {}

export class ReversalRequested extends Domain.Event("BankMatchReversalRequested", Link) {}

export class MatchReversed extends Domain.Event("BankMatchReversed", {}) {}

export class RequestMatch extends Domain.Command("RequestBankMatch", {
  target: MatchId,
  input: Link,
  events: [MatchRequested],
}) {}

export class MarkRecorded extends Domain.Command("MarkBankMatchRecorded", {
  target: MatchId,
  input: {},
  events: [MatchRecorded],
}) {}

export class FailMatch extends Domain.Command("FailBankMatch", {
  target: MatchId,
  input: {},
  events: [MatchFailed],
}) {}

export class ReverseMatch extends Domain.Command("ReverseBankMatch", {
  target: MatchId,
  input: {},
  events: [ReversalRequested],
  rejects: [BankMatchNotFound],
}) {}

export class MarkReversed extends Domain.Command("MarkBankMatchReversed", {
  target: MatchId,
  input: {},
  events: [MatchReversed],
}) {}

const None = Schema.TaggedStruct("None", {})
const Requested = Schema.TaggedStruct("Requested", Link)
const Recorded = Schema.TaggedStruct("Recorded", Link)
const Failed = Schema.TaggedStruct("Failed", {})
const Reversing = Schema.TaggedStruct("Reversing", Link)
const Reversed = Schema.TaggedStruct("Reversed", {})

const linkOf = ({
  lineId,
  paymentId,
  amount,
}: {
  lineId: string
  paymentId: string
  amount: string
}) => ({
  lineId,
  paymentId,
  amount,
})

export class BankMatch extends Domain.Aggregate("BankMatch", {
  id: MatchId,
  state: Schema.Union([None, Requested, Recorded, Failed, Reversing, Reversed]),
  initial: None.make({}),
  commands: [RequestMatch, MarkRecorded, FailMatch, ReverseMatch, MarkReversed],
  decide: {
    RequestBankMatch: (s, cmd) =>
      Predicate.isTagged(s, "None") ? [new MatchRequested(linkOf(cmd))] : [],
    MarkBankMatchRecorded: (s) => (Predicate.isTagged(s, "Requested") ? [new MatchRecorded()] : []),
    FailBankMatch: (s) => (Predicate.isTagged(s, "Requested") ? [new MatchFailed()] : []),
    ReverseBankMatch: (s) => {
      if (Predicate.isTagged(s, "Recorded")) return [new ReversalRequested(linkOf(s))]

      // Reversing twice, or while it is reversing, is safe; a match that never recorded is not found.
      return Predicate.isTagged(s, "Reversing") || Predicate.isTagged(s, "Reversed")
        ? []
        : new BankMatchNotFound()
    },
    MarkBankMatchReversed: (s) => (Predicate.isTagged(s, "Reversing") ? [new MatchReversed()] : []),
  },
  evolve: {
    BankMatchRequested: (_, e) => Requested.make(linkOf(e)),
    BankMatchRecorded: (s) => (Predicate.isTagged(s, "Requested") ? Recorded.make(linkOf(s)) : s),
    BankMatchFailed: () => Failed.make({}),
    BankMatchReversalRequested: (_, e) => Reversing.make(linkOf(e)),
    BankMatchReversed: () => Reversed.make({}),
  },
}) {}

// ---------------------------------------------------------------- the sagas

type Run = Schema.Struct<typeof Link>["Type"] & { readonly key: typeof MatchId.Type }

export class HoldMatch extends Domain.Saga("HoldMatch", {
  key: MatchId,
  input: Link,
  rejects: [LineExceedsAvailable, PaymentExceedsAvailable],
}) {}

export class ReleaseMatch extends Domain.Saga("ReleaseMatch", {
  key: MatchId,
  input: Link,
}) {}

export const HoldMatchLive = HoldMatch.toLayer(
  Effect.gen(function* () {
    const lines = yield* MatchLine
    const payments = yield* MatchPayment
    const matches = yield* BankMatch

    return Effect.fn(function* ({ key, lineId, paymentId, amount }: Run) {
      // The match is recorded as failed after the compensation ran; its id is spent.
      yield* Workflow.addFinalizer((exit) =>
        Exit.isFailure(exit)
          ? matches.send(key, new FailMatch({})).pipe(Effect.asVoid, Effect.orDie)
          : Effect.void,
      )

      yield* Activity.make({
        name: "hold-line",
        error: LineExceedsAvailable,
        execute: lines
          .send(LineId.make(lineId), new HoldOnLine({ matchId: key, amount }))
          .pipe(Effect.asVoid),
      }).pipe(
        HoldMatch.withCompensation(() =>
          Activity.make({
            name: "release-line",
            execute: lines
              .send(LineId.make(lineId), new ReleaseLine({ matchId: key }))
              .pipe(Effect.asVoid, Effect.orDie),
          }),
        ),
      )

      yield* Activity.make({
        name: "hold-payment",
        error: PaymentExceedsAvailable,
        execute: payments
          .send(PaymentId.make(paymentId), new HoldOnPayment({ matchId: key, amount }))
          .pipe(Effect.asVoid),
      })

      yield* Activity.make({
        name: "recorded",
        execute: matches.send(key, new MarkRecorded({})).pipe(Effect.asVoid, Effect.orDie),
      })
    })
  }),
)

export const ReleaseMatchLive = ReleaseMatch.toLayer(
  Effect.gen(function* () {
    const lines = yield* MatchLine
    const payments = yield* MatchPayment
    const matches = yield* BankMatch

    return Effect.fn(function* ({ key, lineId, paymentId }: Run) {
      yield* Activity.make({
        name: "release-line",
        execute: lines
          .send(LineId.make(lineId), new ReleaseLine({ matchId: key }))
          .pipe(Effect.asVoid, Effect.orDie),
      })

      yield* Activity.make({
        name: "release-payment",
        execute: payments
          .send(PaymentId.make(paymentId), new ReleasePayment({ matchId: key }))
          .pipe(Effect.asVoid, Effect.orDie),
      })

      yield* Activity.make({
        name: "reversed",
        execute: matches.send(key, new MarkReversed({})).pipe(Effect.asVoid, Effect.orDie),
      })
    })
  }),
)

/** Starts the holds once the match is requested. */
export class MatchHolding extends Domain.Policy("MatchHolding", {
  from: BankMatch,
  on: [MatchRequested],
}) {}

export const MatchHoldingLive = MatchHolding.toLayer(
  Effect.gen(function* () {
    const runs = yield* HoldMatch

    return Effect.fn(function* ({ source, event }) {
      yield* runs.start(source, linkOf(event))
    })
  }),
)

/** Starts the releases once the reversal is requested. */
export class MatchReleasing extends Domain.Policy("MatchReleasing", {
  from: BankMatch,
  on: [ReversalRequested],
}) {}

export const MatchReleasingLive = MatchReleasing.toLayer(
  Effect.gen(function* () {
    const runs = yield* ReleaseMatch

    return Effect.fn(function* ({ source, event }) {
      yield* runs.start(source, linkOf(event))
    })
  }),
)

export class SettlementBankMatching extends Domain.Model("SettlementBankMatching", {
  aggregates: [MatchLine, MatchPayment, BankMatch],
  policies: [MatchHolding, MatchReleasing],
  sagas: [HoldMatch, ReleaseMatch],
}) {}

export const SettlementBankMatchingHandlers = Layer.mergeAll(
  HoldMatchLive,
  ReleaseMatchLive,
  MatchHoldingLive,
  MatchReleasingLive,
)
