/**
 * Open items as of a date staged for ADR-0124 phase 4 (`BIL-OPEN-1`). Production reads the open
 * items and the aging in the transaction that wrote the documents, so aging at a date equals the
 * control account at that date. On the Effect Cluster host both are views that catch up with the
 * documents: a projection of open items and a projection of the control account, and each query
 * waits for its projection (`waitsFor`) before it answers. This model states those views and the
 * equality; it has no cutover.
 *
 * - **A document is its total, a settlement is its amount, each at a date.** The open amount at a
 *   date is the total less the settlements dated on or before it; a document dated after the date
 *   is not in the report, and a document with nothing open is left out, as `listOpenItems` does.
 * - **The control account is a second view of the same facts.** A posted document debits it at the
 *   document date and a settlement credits it at the settlement date.
 * - **Equal after catch-up, not before.** The two views apply in order but separately, so a reader
 *   that does not wait could see one ahead of the other. Both queries wait, so the equality holds
 *   for the answers a caller gets. The wait's timeout (`ConsistencyTimeout`, 10 seconds) exists
 *   only on the cluster host and is not provable here.
 *
 * Not modelled: kinds and sides, parties, ordering, and tax. Test-only: not exported from
 * `mod.ts`.
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import {
  formatSignedMinor,
  requireExactMajorToMinor,
} from "../../../../framework/foundation/mod.ts"

const minor = (value: string) => requireExactMajorToMinor(value, 2)
const major = (value: bigint) => formatSignedMinor(value, 2)

// ---------------------------------------------------------------- the document

export const DocumentId = Schema.String.pipe(Schema.brand("OpenItemDocumentId"))

export class DocumentPosted extends Domain.Event("OpenItemDocumentPosted", {
  invoiceDate: Schema.String,
  total: Schema.String,
}) {}

export class SettlementRecorded extends Domain.Event("OpenItemSettlementRecorded", {
  sourceId: Schema.String,
  amount: Schema.String,
  settledOn: Schema.String,
}) {}

export class PostDocument extends Domain.Command("PostOpenItemDocument", {
  target: DocumentId,
  input: { invoiceDate: Schema.String, total: Schema.String },
  events: [DocumentPosted],
}) {}

export class RecordSettlement extends Domain.Command("RecordOpenItemSettlement", {
  target: DocumentId,
  input: { sourceId: Schema.String, amount: Schema.String, settledOn: Schema.String },
  events: [SettlementRecorded],
}) {}

const Document = Schema.Struct({
  posted: Schema.Boolean,
  sources: Schema.Array(Schema.String),
})

/** A document posts once, and a settlement source applies once. */
export class OpenItemDocument extends Domain.Aggregate("OpenItemDocument", {
  id: DocumentId,
  state: Document,
  initial: { posted: false, sources: [] },
  commands: [PostDocument, RecordSettlement],
  decide: {
    PostOpenItemDocument: (s, cmd) =>
      s.posted ? [] : [new DocumentPosted({ invoiceDate: cmd.invoiceDate, total: cmd.total })],
    RecordOpenItemSettlement: (s, cmd) =>
      s.posted && !s.sources.includes(cmd.sourceId)
        ? [
            new SettlementRecorded({
              sourceId: cmd.sourceId,
              amount: cmd.amount,
              settledOn: cmd.settledOn,
            }),
          ]
        : [],
  },
  evolve: {
    OpenItemDocumentPosted: (s) => ({ ...s, posted: true }),
    OpenItemSettlementRecorded: (s, e) => ({ ...s, sources: [...s.sources, e.sourceId] }),
  },
}) {}

// ---------------------------------------------------------------- the two views

type Item = {
  readonly invoiceDate: string
  readonly total: string
  readonly settlements: ReadonlyArray<{ readonly settledOn: string; readonly amount: string }>
}

type Movement = { readonly date: string; readonly amount: bigint }

/** What both views keep; one store per model run. */
export class ViewStore extends Context.Service<
  ViewStore,
  {
    readonly items: Map<string, Item>
    readonly control: Array<Movement>
  }
>()("Pilot/OpenItemViewStore") {}

export const MemoryViewStore = Layer.sync(ViewStore, () => ({
  items: new Map<string, Item>(),
  control: new Array<Movement>(),
}))

export class OpenItems extends Domain.Projection("OpenItems", {
  from: [OpenItemDocument],
  key: OpenItemDocument,
  on: [DocumentPosted, SettlementRecorded],
}) {}

export const OpenItemsLive = OpenItems.toLayer(
  Effect.gen(function* () {
    const store = yield* ViewStore

    return Effect.fn(function* (batch) {
      for (const { event, envelope } of batch) {
        const id = envelope.stream

        if (Predicate.isTagged(event, "OpenItemDocumentPosted")) {
          store.items.set(id, {
            invoiceDate: event.invoiceDate,
            total: event.total,
            settlements: [],
          })
        } else {
          const item = store.items.get(id)

          if (item !== undefined) {
            store.items.set(id, {
              ...item,
              settlements: [
                ...item.settlements,
                { settledOn: event.settledOn, amount: event.amount },
              ],
            })
          }
        }
      }

      yield* Effect.void
    })
  }),
)

export class ControlAccount extends Domain.Projection("ControlAccount", {
  from: [OpenItemDocument],
  key: OpenItemDocument,
  on: [DocumentPosted, SettlementRecorded],
}) {}

export const ControlAccountLive = ControlAccount.toLayer(
  Effect.gen(function* () {
    const store = yield* ViewStore

    return Effect.fn(function* (batch) {
      for (const { event } of batch) {
        store.control.push(
          Predicate.isTagged(event, "OpenItemDocumentPosted")
            ? { date: event.invoiceDate, amount: minor(event.total) }
            : { date: event.settledOn, amount: -minor(event.amount) },
        )
      }

      yield* Effect.void
    })
  }),
)

const OpenItem = Schema.Struct({ documentId: Schema.String, open: Schema.String })

export class OpenItemsAsOf extends Domain.Query("OpenItemsAsOf", {
  input: { asOf: Schema.String },
  success: Schema.Array(OpenItem),
  waitsFor: [OpenItems],
}) {}

export const OpenItemsAsOfLive = OpenItemsAsOf.toLayer(
  Effect.gen(function* () {
    const store = yield* ViewStore

    return Effect.fn(function* ({ asOf }) {
      const rows = [...store.items.entries()].flatMap(([id, item]) => {
        if (item.invoiceDate > asOf) return []

        const settled = item.settlements
          .filter((settlement) => settlement.settledOn <= asOf)
          .reduce((sum, settlement) => sum + minor(settlement.amount), 0n)

        const open = minor(item.total) - settled

        return open === 0n
          ? []
          : [{ documentId: id.slice(id.lastIndexOf("/") + 1), open: major(open) }]
      })

      return yield* Effect.succeed(rows)
    })
  }),
)

export class ControlBalanceAsOf extends Domain.Query("ControlBalanceAsOf", {
  input: { asOf: Schema.String },
  success: Schema.String,
  waitsFor: [ControlAccount],
}) {}

export const ControlBalanceAsOfLive = ControlBalanceAsOf.toLayer(
  Effect.gen(function* () {
    const store = yield* ViewStore

    return Effect.fn(function* ({ asOf }) {
      const balance = store.control
        .filter((movement) => movement.date <= asOf)
        .reduce((sum, movement) => sum + movement.amount, 0n)

      return yield* Effect.succeed(major(balance))
    })
  }),
)

export class BillingOpenItems extends Domain.Model("BillingOpenItems", {
  aggregates: [OpenItemDocument],
  projections: [OpenItems, ControlAccount],
  queries: [OpenItemsAsOf, ControlBalanceAsOf],
}) {}

export const BillingOpenItemsHandlers = Layer.mergeAll(
  OpenItemsLive,
  ControlAccountLive,
  OpenItemsAsOfLive,
  ControlBalanceAsOfLive,
).pipe(Layer.provide(MemoryViewStore))
