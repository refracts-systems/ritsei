import { assert, describe, it } from "@effect/vitest"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import {
  AllocateNumber,
  AssignNumber,
  DeliveringOrder,
  DeliveryId,
  DeliveryNumber,
  DeliveryNumbered,
  DeliveryRecorded,
  DeliverySeries,
  NumberAllocated,
  OrderId,
  RecordDelivery,
  SalesDeliveryNumbering,
  SalesDeliveryNumberingHandlers,
  seriesId,
} from "../src/delivery-numbering-model.ts"

const { Story } = Domain

const story = Story.make(SalesDeliveryNumbering, { layer: SalesDeliveryNumberingHandlers })

const order = (id: string) => DeliveringOrder.ref(OrderId.make(id))

const series = (legalEntityId: string, year: string) =>
  DeliverySeries.ref(seriesId(legalEntityId, year))

const delivery = (id: string) => DeliveryNumber.ref(DeliveryId.make(id))

const record = (deliveryId: string, legalEntityId = "le-1", fiscalYear = "2026", accepted = true) =>
  new RecordDelivery({ deliveryId, legalEntityId, fiscalYear, accepted })

const recorded = (deliveryId: string, legalEntityId = "le-1", fiscalYear = "2026") =>
  new DeliveryRecorded({ deliveryId, legalEntityId, fiscalYear })

const allocated = (deliveryId: string, value: number) => new NumberAllocated({ deliveryId, value })
const numbered = (number: string) => new DeliveryNumbered({ number })

describe("delivery numbering staged by policies (SAL-DLV-1)", () => {
  it("the model is well defined", () =>
    assert.deepStrictEqual(Domain.verify(SalesDeliveryNumbering), []))

  // [SAL-DLV-1]
  it.effect("a recorded delivery gets the next DO/ number of its legal entity and year", () =>
    story(
      Story.when(order("o-1"), record("d-1")),
      Story.then(order("o-1"), recorded("d-1")),
      Story.then(series("le-1", "2026"), allocated("d-1", 1)),
      Story.then(delivery("d-1"), numbered("DO/2026/00001")),
    ),
  )

  // [SAL-DLV-1]
  it.effect("deliveries of several orders take consecutive numbers with no hole", () =>
    story(
      Story.when(order("o-1"), record("d-1")),
      Story.then(order("o-1"), recorded("d-1")),
      Story.then(series("le-1", "2026"), allocated("d-1", 1)),
      Story.then(delivery("d-1"), numbered("DO/2026/00001")),
      Story.when(order("o-2"), record("d-2")),
      Story.then(order("o-2"), recorded("d-2")),
      Story.then(series("le-1", "2026"), allocated("d-2", 2)),
      Story.then(delivery("d-2"), numbered("DO/2026/00002")),
      // A delivery the order refuses takes no number, so the next one does not skip.
      Story.when(order("o-3"), record("d-x", "le-1", "2026", false)),
      Story.then(order("o-3")),
      Story.then(series("le-1", "2026")),
      Story.when(order("o-3"), record("d-3")),
      Story.then(order("o-3"), recorded("d-3")),
      Story.then(series("le-1", "2026"), allocated("d-3", 3)),
      Story.then(delivery("d-3"), numbered("DO/2026/00003")),
    ),
  )

  // [SAL-DLV-1]
  it.effect("each legal entity and fiscal year has its own series starting at 1", () =>
    story(
      Story.when(order("o-1"), record("d-1", "le-1", "2026")),
      Story.then(order("o-1"), recorded("d-1", "le-1", "2026")),
      Story.then(series("le-1", "2026"), allocated("d-1", 1)),
      Story.then(delivery("d-1"), numbered("DO/2026/00001")),
      Story.when(order("o-2"), record("d-2", "le-2", "2026")),
      Story.then(order("o-2"), recorded("d-2", "le-2", "2026")),
      Story.then(series("le-2", "2026"), allocated("d-2", 1)),
      Story.then(delivery("d-2"), numbered("DO/2026/00001")),
      Story.when(order("o-3"), record("d-3", "le-1", "2027")),
      Story.then(order("o-3"), recorded("d-3", "le-1", "2027")),
      Story.then(series("le-1", "2027"), allocated("d-3", 1)),
      Story.then(delivery("d-3"), numbered("DO/2027/00001")),
    ),
  )

  // [SAL-DLV-1]
  it.effect("a repeated delivery id records, allocates and numbers nothing again", () =>
    story(
      Story.given(order("o-1"), recorded("d-1")),
      Story.when(order("o-1"), record("d-1")),
      Story.then(order("o-1")),
      Story.given(series("le-1", "2026"), allocated("d-1", 1)),
      Story.when(series("le-1", "2026"), new AllocateNumber({ deliveryId: "d-1" })),
      Story.then(series("le-1", "2026")),
      Story.given(delivery("d-1"), numbered("DO/2026/00001")),
      Story.when(delivery("d-1"), new AssignNumber({ number: "DO/2026/00099" })),
      Story.then(delivery("d-1")),
    ),
  )

  // [SAL-DLV-1]
  it.effect("a delivery numbered earlier keeps its place when the series moves on", () =>
    story(
      Story.given(series("le-1", "2026"), allocated("d-1", 1), allocated("d-2", 2)),
      Story.when(series("le-1", "2026"), new AllocateNumber({ deliveryId: "d-3" })),
      Story.then(series("le-1", "2026"), allocated("d-3", 3)),
      Story.then(delivery("d-3"), numbered("DO/2026/00003")),
      Story.when(series("le-1", "2026"), new AllocateNumber({ deliveryId: "d-1" })),
      Story.then(series("le-1", "2026")),
    ),
  )
})
