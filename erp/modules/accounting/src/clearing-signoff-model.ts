/**
 * The migration sign-off staged for ADR-0124 phase 4 (`ACC-OPEN-3`). Production reads the clearing
 * balance and the opening journal in one request against the table-backed ledger. On the Effect
 * Cluster host the clearing balance is a view of the ledger's events that catches up, and the
 * sign-off query waits for it (`waitsFor`) so that a balance the view has not reached yet is never
 * signed off or refused. This model states the view and the verdict; it has no cutover.
 *
 * - **Three verdicts, the production ones.** No opening journal dated on or before the cutoff is
 *   `OpeningJournalNotPosted`, even when the balance happens to be zero; a clearing balance other
 *   than exactly zero at the cutoff is `MigrationClearingNotZero` with the balance; otherwise the
 *   sign-off passes and names the opening journal.
 * - **The balance is as of the cutoff.** A movement dated after it does not count.
 * - **The owner loads are separate commands** that bring the clearing back to zero, as the
 *   inventory and billing loads do.
 *
 * Not modelled: the chart, the roles, and the journal lines, which are Accounting's. The wait's
 * timeout (`ConsistencyTimeout`, 10 seconds) exists only on the cluster host and is not provable
 * here. Test-only: not exported from `mod.ts`.
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import {
  formatSignedMinor,
  requireSignedMajorToMinor,
} from "../../../../framework/foundation/mod.ts"

const minor = (value: string) => requireSignedMajorToMinor(value, 2)
const major = (value: bigint) => formatSignedMinor(value, 2)

// ---------------------------------------------------------------- the ledger

export const LegalEntityId = Schema.String.pipe(Schema.brand("ClearingLegalEntityId"))

/** The opening journal: one per legal entity. Its clearing line plugs the net of the control accounts. */
export class OpeningPosted extends Domain.Event("ClearingOpeningPosted", {
  postingDate: Schema.String,
  clearing: Schema.String,
}) {}

/** An owner's load against clearing, with the signed amount it moves. */
export class ClearingMoved extends Domain.Event("ClearingMoved", {
  sourceId: Schema.String,
  postingDate: Schema.String,
  amount: Schema.String,
}) {}

export class PostOpening extends Domain.Command("PostClearingOpening", {
  target: LegalEntityId,
  input: { postingDate: Schema.String, clearing: Schema.String },
  events: [OpeningPosted],
}) {}

export class PostOwnerLoad extends Domain.Command("PostClearingOwnerLoad", {
  target: LegalEntityId,
  input: { sourceId: Schema.String, postingDate: Schema.String, amount: Schema.String },
  events: [ClearingMoved],
}) {}

const Ledger = Schema.Struct({
  opening: Schema.Boolean,
  sources: Schema.Array(Schema.String),
})

/** One opening journal per legal entity, and one load per owner source. */
export class EntityLedger extends Domain.Aggregate("ClearingEntityLedger", {
  id: LegalEntityId,
  state: Ledger,
  initial: { opening: false, sources: [] },
  commands: [PostOpening, PostOwnerLoad],
  decide: {
    PostClearingOpening: (s, cmd) =>
      s.opening
        ? []
        : [new OpeningPosted({ postingDate: cmd.postingDate, clearing: cmd.clearing })],
    PostClearingOwnerLoad: (s, cmd) =>
      s.sources.includes(cmd.sourceId)
        ? []
        : [
            new ClearingMoved({
              sourceId: cmd.sourceId,
              postingDate: cmd.postingDate,
              amount: cmd.amount,
            }),
          ],
  },
  evolve: {
    ClearingOpeningPosted: (s) => ({ ...s, opening: true }),
    ClearingMoved: (s, e) => ({ ...s, sources: [...s.sources, e.sourceId] }),
  },
}) {}

// ---------------------------------------------------------------- the view

type Movement = { readonly date: string; readonly amount: bigint }

export class ClearingStore extends Context.Service<
  ClearingStore,
  { readonly movements: Array<Movement>; readonly openings: Array<string> }
>()("Pilot/ClearingStore") {}

export const MemoryClearingStore = Layer.sync(ClearingStore, () => ({
  movements: new Array<Movement>(),
  openings: new Array<string>(),
}))

export class ClearingBalance extends Domain.Projection("ClearingBalance", {
  from: [EntityLedger],
  key: EntityLedger,
  on: [OpeningPosted, ClearingMoved],
}) {}

export const ClearingBalanceLive = ClearingBalance.toLayer(
  Effect.gen(function* () {
    const store = yield* ClearingStore

    return Effect.fn(function* (batch) {
      for (const { event } of batch) {
        if (Predicate.isTagged(event, "ClearingOpeningPosted")) {
          store.openings.push(event.postingDate)
          store.movements.push({ date: event.postingDate, amount: minor(event.clearing) })
        } else {
          store.movements.push({ date: event.postingDate, amount: minor(event.amount) })
        }
      }

      yield* Effect.void
    })
  }),
)

export const Verified = Schema.TaggedStruct("Verified", { asOf: Schema.String })
export const NotZero = Schema.TaggedStruct("MigrationClearingNotZero", { balance: Schema.String })
export const NotPosted = Schema.TaggedStruct("OpeningJournalNotPosted", {})

export class VerifyClearing extends Domain.Query("VerifyClearing", {
  input: { asOf: Schema.String },
  success: Schema.Union([Verified, NotZero, NotPosted]),
  waitsFor: [ClearingBalance],
}) {}

export const VerifyClearingLive = VerifyClearing.toLayer(
  Effect.gen(function* () {
    const store = yield* ClearingStore

    return Effect.fn(function* ({ asOf }) {
      // A zero balance with no opening journal means nothing was loaded, not that it reconciles.
      if (!store.openings.some((date) => date <= asOf)) {
        return yield* Effect.succeed(NotPosted.make({}))
      }

      const balance = store.movements
        .filter((movement) => movement.date <= asOf)
        .reduce((sum, movement) => sum + movement.amount, 0n)

      return yield* Effect.succeed(
        balance === 0n ? Verified.make({ asOf }) : NotZero.make({ balance: major(balance) }),
      )
    })
  }),
)

export class AccountingClearingSignoff extends Domain.Model("AccountingClearingSignoff", {
  aggregates: [EntityLedger],
  projections: [ClearingBalance],
  queries: [VerifyClearing],
}) {}

export const AccountingClearingSignoffHandlers = Layer.mergeAll(
  ClearingBalanceLive,
  VerifyClearingLive,
).pipe(Layer.provide(MemoryClearingStore))
