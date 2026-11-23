/**
 * Valued stock moves staged for ADR-0124 phase 4 (`INV-VAL-1`, `INV-VAL-2`). Production locks the
 * balances and valuations in item order, posts one journal for the document, and writes movements,
 * valuation, and one entry per item in one transaction. On the Effect Cluster host each item is its
 * own aggregate and commits on its own pool, so the same facts become steps: a saga moves each
 * item, then posts the document's journal. This model states that staging and nothing else; there
 * is no cutover, and it uses the production amounts (`costIssue`, `valueReceipt`).
 *
 * - **One item, one valuation.** An item aggregate holds the on-hand quantity and value for a legal
 *   entity and item. Every move records `onHandAfter` and `valueAfter`, so a reader replays the
 *   valuation from the events, and the last units take the remaining value.
 * - **A document moves an item at most once.** The item remembers each document it moved, so a
 *   retry returns without a second event.
 * - **A refused item reverses the items moved before it.** All-or-nothing in production becomes a
 *   reversal here; the journal is posted only after every item moved, so none is left to reverse.
 * - **One journal per document,** keyed by the document, so the journal's reference leads back to
 *   the document and a repeated post is a no-op. A document with no value posts nothing.
 *
 * Not modelled: warehouse balances and availability, counts (`inventory_adjustment`), the posting
 * roles, and the period check of the journal. Test-only: not exported from `mod.ts`.
 */
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import { Activity, Workflow } from "effect/workflow"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import { costIssue, valueReceipt } from "./valuation.ts"

// ---------------------------------------------------------------- the document

export const DocumentId = Schema.String.pipe(Schema.brand("StockDocumentId"))

const MoveLine = Schema.Struct({
  itemId: Schema.String,
  /** Signed: a receipt is positive, an issue negative. */
  quantity: Schema.String,
  /** A receipt's value in minor units; null takes the moving average. */
  receiptValue: Schema.NullOr(Schema.String),
})

export class MoveRecorded extends Domain.Event("MoveRecorded", {
  legalEntityId: Schema.String,
  lines: Schema.Array(MoveLine),
}) {}

export class RecordMove extends Domain.Command("RecordMove", {
  target: DocumentId,
  input: { legalEntityId: Schema.String, lines: Schema.Array(MoveLine) },
  events: [MoveRecorded],
}) {}

const Unrecorded = Schema.TaggedStruct("Unrecorded", {})
const Recorded = Schema.TaggedStruct("Recorded", {})

/** The document that asks for the move; a repeated id records nothing. */
export class StockDocument extends Domain.Aggregate("StockDocument", {
  id: DocumentId,
  state: Schema.Union([Unrecorded, Recorded]),
  initial: Unrecorded.make({}),
  commands: [RecordMove],
  decide: {
    RecordMove: (s, cmd) =>
      Predicate.isTagged(s, "Unrecorded")
        ? [new MoveRecorded({ legalEntityId: cmd.legalEntityId, lines: cmd.lines })]
        : [],
  },
  evolve: {
    MoveRecorded: () => Recorded.make({}),
  },
}) {}

// ---------------------------------------------------------------- the item

/** `<legal entity>/<item>`. */
export const ItemId = Schema.String.pipe(Schema.brand("ValuedItemId"))

export class StockValuationUnavailable extends Domain.Rejection("StockValuationUnavailable", {
  itemId: Schema.String,
}) {}

export class StockMoved extends Domain.Event("StockMoved", {
  documentId: Schema.String,
  quantity: Schema.String,
  value: Schema.String,
  onHandAfter: Schema.String,
  valueAfter: Schema.String,
}) {}

export class MoveReversed extends Domain.Event("MoveReversed", {
  documentId: Schema.String,
  onHandAfter: Schema.String,
  valueAfter: Schema.String,
}) {}

export class MoveStock extends Domain.Command("MoveStock", {
  target: ItemId,
  input: {
    documentId: Schema.String,
    itemId: Schema.String,
    quantity: Schema.String,
    receiptValue: Schema.NullOr(Schema.String),
  },
  events: [StockMoved],
  rejects: [StockValuationUnavailable],
}) {}

export class ReverseMove extends Domain.Command("ReverseMove", {
  target: ItemId,
  input: { documentId: Schema.String },
  events: [MoveReversed],
}) {}

const Valued = Schema.Struct({
  quantity: Schema.String,
  value: Schema.String,
  moved: Schema.Record(
    Schema.String,
    Schema.Struct({ quantity: Schema.String, value: Schema.String }),
  ),
})

export class ValuedItem extends Domain.Aggregate("ValuedItem", {
  id: ItemId,
  state: Valued,
  initial: { quantity: "0", value: "0", moved: {} },
  commands: [MoveStock, ReverseMove],
  decide: {
    MoveStock: (s, cmd) => {
      if (s.moved[cmd.documentId] !== undefined) return []

      const valuation = { quantity: BigInt(s.quantity), value: BigInt(s.value) }
      const quantity = BigInt(cmd.quantity)

      const base = { itemId: cmd.itemId, quantity }

      const planned =
        cmd.receiptValue === null ? base : { ...base, receiptValue: BigInt(cmd.receiptValue) }

      const valued =
        quantity < 0n ? costIssue(planned, valuation) : valueReceipt(planned, valuation)

      if (!Predicate.isTagged(valued, "Valued")) {
        return new StockValuationUnavailable({ itemId: cmd.itemId })
      }

      return [
        new StockMoved({
          documentId: cmd.documentId,
          quantity: cmd.quantity,
          value: String(valued.line.value),
          onHandAfter: String(valuation.quantity + quantity),
          valueAfter: String(valuation.value + valued.line.value),
        }),
      ]
    },
    ReverseMove: (s, cmd) => {
      const moved = s.moved[cmd.documentId]

      return moved === undefined
        ? []
        : [
            new MoveReversed({
              documentId: cmd.documentId,
              onHandAfter: String(BigInt(s.quantity) - BigInt(moved.quantity)),
              valueAfter: String(BigInt(s.value) - BigInt(moved.value)),
            }),
          ]
    },
  },
  evolve: {
    StockMoved: (s, e) => ({
      quantity: e.onHandAfter,
      value: e.valueAfter,
      moved: { ...s.moved, [e.documentId]: { quantity: e.quantity, value: e.value } },
    }),
    MoveReversed: (s, e) => ({
      quantity: e.onHandAfter,
      value: e.valueAfter,
      moved: Object.fromEntries(Object.entries(s.moved).filter(([id]) => id !== e.documentId)),
    }),
  },
}) {}

// ---------------------------------------------------------------- the journal

/** `inventory/<document type>/<document id>`: the reference leads back to the document. */
export const JournalRef = Schema.String.pipe(Schema.brand("StockJournalRef"))

export const journalRef = (documentId: string) => JournalRef.make(`inventory/${documentId}`)

/** Gains debit inventory and losses credit it; both in minor units. */
export class MoveJournalPosted extends Domain.Event("MoveJournalPosted", {
  gainsMinor: Schema.String,
  lossesMinor: Schema.String,
}) {}

export class PostMoveJournal extends Domain.Command("PostMoveJournal", {
  target: JournalRef,
  input: { gainsMinor: Schema.String, lossesMinor: Schema.String },
  events: [MoveJournalPosted],
}) {}

const Unposted = Schema.TaggedStruct("Unposted", {})
const Posted = Schema.TaggedStruct("Posted", {})

export class MoveJournal extends Domain.Aggregate("MoveJournal", {
  id: JournalRef,
  state: Schema.Union([Unposted, Posted]),
  initial: Unposted.make({}),
  commands: [PostMoveJournal],
  decide: {
    PostMoveJournal: (s, cmd) =>
      Predicate.isTagged(s, "Unposted")
        ? [new MoveJournalPosted({ gainsMinor: cmd.gainsMinor, lossesMinor: cmd.lossesMinor })]
        : [],
  },
  evolve: {
    MoveJournalPosted: () => Posted.make({}),
  },
}) {}

// ---------------------------------------------------------------- the status

export class MoveApplied extends Domain.Event("MoveApplied", {}) {}

/** The move stopped; the items it had moved are reversed and a person decides what happens next. */
export class MoveParked extends Domain.Event("MoveParked", { reason: Schema.String }) {}

export class MarkMoveApplied extends Domain.Command("MarkMoveApplied", {
  target: DocumentId,
  input: {},
  events: [MoveApplied],
}) {}

export class ParkMove extends Domain.Command("ParkMove", {
  target: DocumentId,
  input: { reason: Schema.String },
  events: [MoveParked],
}) {}

const Applying = Schema.TaggedStruct("Applying", {})
const Applied = Schema.TaggedStruct("Applied", {})
const Parked = Schema.TaggedStruct("Parked", { reason: Schema.String })

export class MoveStatus extends Domain.Aggregate("MoveStatus", {
  id: DocumentId,
  state: Schema.Union([Applying, Applied, Parked]),
  initial: Applying.make({}),
  commands: [MarkMoveApplied, ParkMove],
  decide: {
    MarkMoveApplied: (s) => (Predicate.isTagged(s, "Applying") ? [new MoveApplied()] : []),
    ParkMove: (s, cmd) =>
      Predicate.isTagged(s, "Applying") ? [new MoveParked({ reason: cmd.reason })] : [],
  },
  evolve: {
    MoveApplied: () => Applied.make({}),
    MoveParked: (_, e) => Parked.make({ reason: e.reason }),
  },
}) {}

// ---------------------------------------------------------------- the saga

const MoveInput = { legalEntityId: Schema.String, lines: Schema.Array(MoveLine) }

type Run = Schema.Struct<typeof MoveInput>["Type"] & { readonly key: typeof DocumentId.Type }

export class ApplyMove extends Domain.Saga("ApplyMove", {
  key: DocumentId,
  input: MoveInput,
  rejects: [StockValuationUnavailable],
}) {}

const Moved = Schema.Struct({ taken: Schema.Boolean, value: Schema.String })

export const ApplyMoveLive = ApplyMove.toLayer(
  Effect.gen(function* () {
    const items = yield* ValuedItem
    const journals = yield* MoveJournal
    const statuses = yield* MoveStatus

    return Effect.fn(function* ({ key, legalEntityId, lines }: Run) {
      yield* Workflow.addFinalizer((exit) =>
        Exit.isFailure(exit)
          ? statuses
              .send(key, new ParkMove({ reason: "an item could not be moved" }))
              .pipe(Effect.asVoid, Effect.orDie)
          : Effect.void,
      )

      // Items in item order, as production locks them. Each activity says what this run moved, so
      // a compensation reverses only that.
      const ordered = lines.toSorted((left, right) => left.itemId.localeCompare(right.itemId))

      const moved = yield* Effect.forEach(ordered, ({ itemId, quantity, receiptValue }) => {
        const target = ItemId.make(`${legalEntityId}/${itemId}`)

        return Activity.make({
          name: `move:${itemId}`,
          success: Moved,
          error: StockValuationUnavailable,
          execute: items
            .send(target, new MoveStock({ documentId: key, itemId, quantity, receiptValue }))
            .pipe(
              Effect.map((receipt) => {
                const values = receipt.events.flatMap((event) =>
                  Predicate.isTagged(event, "StockMoved") ? [event.value] : [],
                )

                return { taken: values.length > 0, value: values[0] ?? "0" }
              }),
            ),
        }).pipe(
          ApplyMove.withCompensation((result) =>
            result.taken
              ? Activity.make({
                  name: `reverse:${itemId}`,
                  execute: items
                    .send(target, new ReverseMove({ documentId: key }))
                    .pipe(Effect.asVoid, Effect.orDie),
                })
              : Effect.void,
          ),
        )
      })

      // The journal follows the items, so a refused item leaves nothing to reverse in it.
      const values = moved.map((line) => BigInt(line.value))
      const gains = values.reduce((sum, value) => (value > 0n ? sum + value : sum), 0n)
      const losses = values.reduce((sum, value) => (value < 0n ? sum - value : sum), 0n)

      if (gains > 0n || losses > 0n) {
        yield* Activity.make({
          name: "journal",
          execute: journals
            .send(
              journalRef(key),
              new PostMoveJournal({ gainsMinor: String(gains), lossesMinor: String(losses) }),
            )
            .pipe(Effect.asVoid, Effect.orDie),
        })
      }

      yield* Activity.make({
        name: "applied",
        execute: statuses.send(key, new MarkMoveApplied({})).pipe(Effect.asVoid, Effect.orDie),
      })
    })
  }),
)

/** Starts the move once the document is recorded. */
export class MoveApplication extends Domain.Policy("MoveApplication", {
  from: StockDocument,
  on: [MoveRecorded],
}) {}

export const MoveApplicationLive = MoveApplication.toLayer(
  Effect.gen(function* () {
    const runs = yield* ApplyMove

    return Effect.fn(function* ({ source, event }) {
      yield* runs.start(source, { legalEntityId: event.legalEntityId, lines: event.lines })
    })
  }),
)

export class InventoryValuedMove extends Domain.Model("InventoryValuedMove", {
  aggregates: [StockDocument, ValuedItem, MoveJournal, MoveStatus],
  policies: [MoveApplication],
  sagas: [ApplyMove],
}) {}

export const InventoryValuedMoveHandlers = Layer.mergeAll(ApplyMoveLive, MoveApplicationLive)
