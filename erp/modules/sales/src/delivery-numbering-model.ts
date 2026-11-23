/**
 * Delivery numbering staged for ADR-0124 phase 4 (`SAL-DLV-1`, the `DO/` number). Production
 * allocates the number from the gapless series of the legal entity inside the transaction that
 * records the delivery (ADR-0095), so a rolled-back delivery returns its number. On the Effect
 * Cluster host the delivery and the series commit separately, so the number becomes a later step:
 * the delivery records, a policy asks the series for a number, and a second policy gives it to the
 * delivery. This model states that staging and nothing else; there is no cutover. The cap on
 * delivered quantity has its own story (`framework/foundation/domain-model/tests/delivery.story.test.ts`).
 *
 * - **Numbers are allocated only for recorded deliveries.** A delivery the order refuses never asks
 *   for one, so the series has no hole where a refusal was. This is how the staged series stays
 *   gapless without a rollback.
 * - **One number per delivery.** The series remembers the number it gave each delivery, so a policy
 *   that runs twice allocates once, and the delivery keeps its first number.
 * - **A series per legal entity and fiscal year,** restarting at 1, in the format
 *   `DO/<year>/<value padded to 5>`.
 * - **A recorded delivery can be unnumbered for a moment.** The number is assigned after the
 *   record, and two deliveries recorded together are numbered in the order the series allocates,
 *   which need not be the order they were recorded in.
 *
 * Whether `DO/` may leave gaps is the owner's decision; ADR-0095 makes every series gapless. Not
 * modelled: the series' fiscal calendar, the delivery date, delivery lines, and the cap. Test-only:
 * not exported from `mod.ts`.
 */
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"

// ---------------------------------------------------------------- the delivery record

export const OrderId = Schema.String.pipe(Schema.brand("NumberedOrderId"))

export class DeliveryRecorded extends Domain.Event("NumberedDeliveryRecorded", {
  deliveryId: Schema.String,
  legalEntityId: Schema.String,
  fiscalYear: Schema.String,
}) {}

export class RecordDelivery extends Domain.Command("RecordNumberedDelivery", {
  target: OrderId,
  input: {
    deliveryId: Schema.String,
    legalEntityId: Schema.String,
    fiscalYear: Schema.String,
    /** What the order allows: a refused delivery records nothing and takes no number. */
    accepted: Schema.Boolean,
  },
  events: [DeliveryRecorded],
}) {}

/** The order records a delivery once; a repeated delivery id returns the recorded one. */
export class DeliveringOrder extends Domain.Aggregate("DeliveringOrder", {
  id: OrderId,
  state: Schema.Array(Schema.String),
  initial: [],
  commands: [RecordDelivery],
  decide: {
    RecordNumberedDelivery: (s, cmd) =>
      cmd.accepted && !s.includes(cmd.deliveryId)
        ? [
            new DeliveryRecorded({
              deliveryId: cmd.deliveryId,
              legalEntityId: cmd.legalEntityId,
              fiscalYear: cmd.fiscalYear,
            }),
          ]
        : [],
  },
  evolve: {
    NumberedDeliveryRecorded: (s, e) => [...s, e.deliveryId],
  },
}) {}

// ---------------------------------------------------------------- the series

/** `<legal entity>/<fiscal year>`. */
export const SeriesId = Schema.String.pipe(Schema.brand("DeliverySeriesId"))

export const seriesId = (legalEntityId: string, fiscalYear: string) =>
  SeriesId.make(`${legalEntityId}/${fiscalYear}`)

export class NumberAllocated extends Domain.Event("DeliveryNumberAllocated", {
  deliveryId: Schema.String,
  value: Schema.Int,
}) {}

export class AllocateNumber extends Domain.Command("AllocateDeliveryNumber", {
  target: SeriesId,
  input: { deliveryId: Schema.String },
  events: [NumberAllocated],
}) {}

export class DeliverySeries extends Domain.Aggregate("DeliverySeries", {
  id: SeriesId,
  state: Schema.Struct({
    last: Schema.Int,
    issued: Schema.Record(Schema.String, Schema.Int),
  }),
  initial: { last: 0, issued: {} },
  commands: [AllocateNumber],
  decide: {
    AllocateDeliveryNumber: (s, cmd) =>
      s.issued[cmd.deliveryId] === undefined
        ? [new NumberAllocated({ deliveryId: cmd.deliveryId, value: s.last + 1 })]
        : [],
  },
  evolve: {
    DeliveryNumberAllocated: (s, e) => ({
      last: e.value,
      issued: { ...s.issued, [e.deliveryId]: e.value },
    }),
  },
}) {}

// ---------------------------------------------------------------- the delivery's number

export const DeliveryId = Schema.String.pipe(Schema.brand("NumberedDeliveryId"))

export class DeliveryNumbered extends Domain.Event("DeliveryNumbered", {
  number: Schema.String,
}) {}

export class AssignNumber extends Domain.Command("AssignDeliveryNumber", {
  target: DeliveryId,
  input: { number: Schema.String },
  events: [DeliveryNumbered],
}) {}

const Unnumbered = Schema.TaggedStruct("Unnumbered", {})
const Numbered = Schema.TaggedStruct("Numbered", { number: Schema.String })

/** A delivery keeps the first number it was given. */
export class DeliveryNumber extends Domain.Aggregate("DeliveryNumber", {
  id: DeliveryId,
  state: Schema.Union([Unnumbered, Numbered]),
  initial: Unnumbered.make({}),
  commands: [AssignNumber],
  decide: {
    AssignDeliveryNumber: (s, cmd) =>
      Predicate.isTagged(s, "Unnumbered") ? [new DeliveryNumbered({ number: cmd.number })] : [],
  },
  evolve: {
    DeliveryNumbered: (_, e) => Numbered.make({ number: e.number }),
  },
}) {}

/** `DO/<fiscal year>/<value padded to 5>`. */
export const deliveryNumber = (fiscalYear: string, value: number) =>
  `DO/${fiscalYear}/${String(value).padStart(5, "0")}`

// ---------------------------------------------------------------- the policies

/** Asks the series of the delivery's legal entity and year for a number. */
export class NumberRequest extends Domain.Policy("NumberRequest", {
  from: DeliveringOrder,
  on: [DeliveryRecorded],
}) {}

export const NumberRequestLive = NumberRequest.toLayer(
  Effect.gen(function* () {
    const series = yield* DeliverySeries

    return Effect.fn(function* ({ event }) {
      yield* series
        .send(
          seriesId(event.legalEntityId, event.fiscalYear),
          new AllocateNumber({ deliveryId: event.deliveryId }),
        )
        .pipe(Effect.asVoid, Effect.orDie)
    })
  }),
)

/** Gives the allocated number to its delivery. */
export class NumberAssignment extends Domain.Policy("NumberAssignment", {
  from: DeliverySeries,
  on: [NumberAllocated],
}) {}

export const NumberAssignmentLive = NumberAssignment.toLayer(
  Effect.gen(function* () {
    const deliveries = yield* DeliveryNumber

    return Effect.fn(function* ({ source, event }) {
      const fiscalYear = source.id.slice(source.id.lastIndexOf("/") + 1)

      yield* deliveries
        .send(
          DeliveryId.make(event.deliveryId),
          new AssignNumber({ number: deliveryNumber(fiscalYear, event.value) }),
        )
        .pipe(Effect.asVoid, Effect.orDie)
    })
  }),
)

export class SalesDeliveryNumbering extends Domain.Model("SalesDeliveryNumbering", {
  aggregates: [DeliveringOrder, DeliverySeries, DeliveryNumber],
  policies: [NumberRequest, NumberAssignment],
}) {}

export const SalesDeliveryNumberingHandlers = Layer.mergeAll(
  NumberRequestLive,
  NumberAssignmentLive,
)
