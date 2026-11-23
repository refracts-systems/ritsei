/**
 * The opening stock load staged for ADR-0124 phase 4 (`INV-OPEN-5`). Production posts the journal
 * and writes the positions in one transaction, so a refusal rolls both back. On the Effect Cluster
 * host the aggregate commits on its own pool, so the same facts become steps: `AcceptOpening`
 * records the load, then a saga posts the journal against migration clearing and loads each
 * position. This model states that staging and nothing else; there is no cutover.
 *
 * - **One journal per opening.** The journal's id is its reference
 *   (`inventory/inventory.opening_stock_load/<openingId>`), so a repeated post is a no-op.
 * - **A refused later step leaves a reversal, not a rollback.** The posted journal stays and a
 *   reversal marked as a failed load follows, so a reader sees one load that failed and not two
 *   business events. Positions this run loaded are unloaded.
 * - **A reversed journal is final.** A retry never posts it again; the opening is parked for a
 *   person, who loads the corrected bundle under a new opening id.
 * - **Value with no amount posts nothing**, as in production.
 *
 * Test-only: not exported from `mod.ts`.
 */
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import { Activity, Workflow } from "effect/workflow"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import { requireExactMajorToMinor } from "../../../../framework/foundation/mod.ts"
import { OpeningAccepted, OpeningLine, OpeningLoad, OpeningLoadId } from "./domain-model.ts"

// ---------------------------------------------------------------- the journal

export const JournalRef = Schema.String.pipe(Schema.brand("OpeningJournalRef"))

export const journalRef = (openingId: string) =>
  JournalRef.make(`inventory/inventory.opening_stock_load/${openingId}`)

export class OpeningJournalPosted extends Domain.Event("OpeningJournalPosted", {
  amountMinor: Schema.String,
}) {}

/** The reversal of a journal whose load failed after it was posted. */
export class OpeningJournalReversedForFailedLoad extends Domain.Event(
  "OpeningJournalReversedForFailedLoad",
  { amountMinor: Schema.String },
) {}

export class PostOpeningJournal extends Domain.Command("PostOpeningJournal", {
  target: JournalRef,
  input: { amountMinor: Schema.String },
  events: [OpeningJournalPosted],
}) {}

export class ReverseOpeningJournal extends Domain.Command("ReverseOpeningJournal", {
  target: JournalRef,
  input: {},
  events: [OpeningJournalReversedForFailedLoad],
}) {}

const Unposted = Schema.TaggedStruct("Unposted", {})
const Posted = Schema.TaggedStruct("Posted", { amountMinor: Schema.String })
const Reversed = Schema.TaggedStruct("Reversed", { amountMinor: Schema.String })

export class OpeningJournal extends Domain.Aggregate("OpeningJournal", {
  id: JournalRef,
  state: Schema.Union([Unposted, Posted, Reversed]),
  initial: Unposted.make({}),
  commands: [PostOpeningJournal, ReverseOpeningJournal],
  decide: {
    PostOpeningJournal: (s, cmd) =>
      Predicate.isTagged(s, "Unposted")
        ? [new OpeningJournalPosted({ amountMinor: cmd.amountMinor })]
        : [],
    ReverseOpeningJournal: (s) =>
      Predicate.isTagged(s, "Posted")
        ? [new OpeningJournalReversedForFailedLoad({ amountMinor: s.amountMinor })]
        : [],
  },
  evolve: {
    OpeningJournalPosted: (_, e) => Posted.make({ amountMinor: e.amountMinor }),
    OpeningJournalReversedForFailedLoad: (_, e) => Reversed.make({ amountMinor: e.amountMinor }),
  },
}) {}

// ---------------------------------------------------------------- the position

/** `<warehouse>/<item>`. */
export const PositionId = Schema.String.pipe(Schema.brand("OpeningPositionId"))

export class ItemInactive extends Domain.Rejection("OpeningItemInactive", {
  itemId: Schema.String,
}) {}

export class PositionLoaded extends Domain.Event("OpeningPositionLoaded", {
  openingId: Schema.String,
  quantity: Schema.String,
}) {}

export class PositionUnloaded extends Domain.Event("OpeningPositionUnloaded", {
  openingId: Schema.String,
}) {}

export class ItemDeactivated extends Domain.Event("OpeningItemDeactivated", {}) {}

export class LoadPosition extends Domain.Command("LoadOpeningPosition", {
  target: PositionId,
  input: { openingId: Schema.String, itemId: Schema.String, quantity: Schema.String },
  events: [PositionLoaded],
  rejects: [ItemInactive],
}) {}

export class UnloadPosition extends Domain.Command("UnloadOpeningPosition", {
  target: PositionId,
  input: { openingId: Schema.String },
  events: [PositionUnloaded],
}) {}

export class DeactivateItem extends Domain.Command("DeactivateOpeningItem", {
  target: PositionId,
  input: {},
  events: [ItemDeactivated],
}) {}

const Empty = Schema.TaggedStruct("Empty", {})
const Loaded = Schema.TaggedStruct("Loaded", { openingId: Schema.String })
const Inactive = Schema.TaggedStruct("Inactive", {})

export class OpeningPosition extends Domain.Aggregate("OpeningPosition", {
  id: PositionId,
  state: Schema.Union([Empty, Loaded, Inactive]),
  initial: Empty.make({}),
  commands: [LoadPosition, UnloadPosition, DeactivateItem],
  decide: {
    LoadOpeningPosition: (s, cmd) => {
      if (Predicate.isTagged(s, "Inactive")) return new ItemInactive({ itemId: cmd.itemId })

      if (Predicate.isTagged(s, "Loaded")) return []

      return [new PositionLoaded({ openingId: cmd.openingId, quantity: cmd.quantity })]
    },
    UnloadOpeningPosition: (s, cmd) =>
      Predicate.isTagged(s, "Loaded") && s.openingId === cmd.openingId
        ? [new PositionUnloaded({ openingId: cmd.openingId })]
        : [],
    DeactivateOpeningItem: (s) => (Predicate.isTagged(s, "Empty") ? [new ItemDeactivated()] : []),
  },
  evolve: {
    OpeningPositionLoaded: (_, e) => Loaded.make({ openingId: e.openingId }),
    OpeningPositionUnloaded: () => Empty.make({}),
    OpeningItemDeactivated: () => Inactive.make({}),
  },
}) {}

// ---------------------------------------------------------------- the status of the staging

export class OpeningPosted extends Domain.Event("OpeningPosted", {}) {}

/** The load stopped after it was recorded; a person decides what happens next. */
export class OpeningParked extends Domain.Event("OpeningParked", { reason: Schema.String }) {}

export class MarkOpeningPosted extends Domain.Command("MarkOpeningPosted", {
  target: OpeningLoadId,
  input: {},
  events: [OpeningPosted],
}) {}

export class ParkOpening extends Domain.Command("ParkOpening", {
  target: OpeningLoadId,
  input: { reason: Schema.String },
  events: [OpeningParked],
}) {}

const Staging = Schema.TaggedStruct("Staging", {})
const Done = Schema.TaggedStruct("Done", {})
const Parked = Schema.TaggedStruct("Parked", { reason: Schema.String })

export class OpeningStatus extends Domain.Aggregate("OpeningStatus", {
  id: OpeningLoadId,
  state: Schema.Union([Staging, Done, Parked]),
  initial: Staging.make({}),
  commands: [MarkOpeningPosted, ParkOpening],
  decide: {
    MarkOpeningPosted: (s) => (Predicate.isTagged(s, "Staging") ? [new OpeningPosted()] : []),
    ParkOpening: (s, cmd) =>
      Predicate.isTagged(s, "Staging") ? [new OpeningParked({ reason: cmd.reason })] : [],
  },
  evolve: {
    OpeningPosted: () => Done.make({}),
    OpeningParked: (_, e) => Parked.make({ reason: e.reason }),
  },
}) {}

// ---------------------------------------------------------------- the saga

const PostingInput = {
  openingId: Schema.String,
  warehouseId: Schema.String,
  lines: Schema.Array(OpeningLine),
}

type Run = Schema.Struct<typeof PostingInput>["Type"] & { readonly key: typeof OpeningLoadId.Type }

export class PostOpening extends Domain.Saga("PostOpening", {
  key: OpeningLoadId,
  input: PostingInput,
  rejects: [ItemInactive],
}) {}

const totalMinor = (lines: Run["lines"]) =>
  lines.reduce((sum, line) => sum + requireExactMajorToMinor(line.sourceValue, 2), 0n)

export const PostOpeningLive = PostOpening.toLayer(
  Effect.gen(function* () {
    const journals = yield* OpeningJournal
    const positions = yield* OpeningPosition
    const statuses = yield* OpeningStatus

    return Effect.fn(function* ({ key, openingId, warehouseId, lines }: Run) {
      yield* Workflow.addFinalizer((exit) =>
        Exit.isFailure(exit)
          ? statuses
              .send(key, new ParkOpening({ reason: "a later step was refused" }))
              .pipe(Effect.asVoid, Effect.orDie)
          : Effect.void,
      )

      // Step 1: the journal, before the positions as in production. A zero total posts nothing.
      const total = totalMinor(lines)

      if (total !== 0n) {
        const reference = journalRef(openingId)

        yield* Activity.make({
          name: "journal",
          execute: journals
            .send(reference, new PostOpeningJournal({ amountMinor: String(total) }))
            .pipe(Effect.asVoid, Effect.orDie),
        }).pipe(
          PostOpening.withCompensation(() =>
            Activity.make({
              name: "reverse-journal",
              execute: journals
                .send(reference, new ReverseOpeningJournal({}))
                .pipe(Effect.asVoid, Effect.orDie),
            }),
          ),
        )
      }

      // Step 2: one position per line. Each activity says whether this run loaded it, so a
      // compensation unloads only what this run took.
      yield* Effect.forEach(
        lines,
        ({ itemId, quantity }) => {
          const target = PositionId.make(`${warehouseId}/${itemId}`)

          return Activity.make({
            name: `load:${itemId}`,
            success: Schema.Boolean,
            error: ItemInactive,
            execute: positions
              .send(target, new LoadPosition({ openingId, itemId, quantity }))
              .pipe(Effect.map((receipt) => receipt.events.length > 0)),
          }).pipe(
            PostOpening.withCompensation((taken) =>
              taken
                ? Activity.make({
                    name: `unload:${itemId}`,
                    execute: positions
                      .send(target, new UnloadPosition({ openingId }))
                      .pipe(Effect.asVoid, Effect.orDie),
                  })
                : Effect.void,
            ),
          )
        },
        { discard: true },
      )

      yield* Activity.make({
        name: "done",
        execute: statuses.send(key, new MarkOpeningPosted({})).pipe(Effect.asVoid, Effect.orDie),
      })
    })
  }),
)

/** Starts the staging once the load is recorded. */
export class OpeningPosting extends Domain.Policy("OpeningPosting", {
  from: OpeningLoad,
  on: [OpeningAccepted],
}) {}

export const OpeningPostingLive = OpeningPosting.toLayer(
  Effect.gen(function* () {
    const runs = yield* PostOpening

    return Effect.fn(function* ({ source, event }) {
      yield* runs.start(source, {
        openingId: source.id,
        warehouseId: event.warehouseId,
        lines: event.lines,
      })
    })
  }),
)

export class InventoryOpeningPosting extends Domain.Model("InventoryOpeningPosting", {
  aggregates: [OpeningLoad, OpeningJournal, OpeningPosition, OpeningStatus],
  policies: [OpeningPosting],
  sagas: [PostOpening],
}) {}

export const InventoryOpeningPostingHandlers = Layer.mergeAll(PostOpeningLive, OpeningPostingLive)
