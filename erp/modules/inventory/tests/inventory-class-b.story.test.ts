import { assert, describe, it } from "@effect/vitest"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import {
  CorrectionKeyReused,
  CorrectStock,
  InventoryClassA,
  StockCorrected,
  StockItem,
  StockReceived,
} from "../src/domain-model.ts"

const { Story } = Domain

const story = Story.make(InventoryClassA)

const item = StockItem.ref("w-1/A")
const otherItem = StockItem.ref("w-1/B")

const tenOnHand = new StockReceived({ quantity: 10n })

const correct = (idempotencyKey: string, adjustment: bigint) =>
  new CorrectStock({
    idempotencyKey,
    adjustment,
    unitOfMeasure: "EA",
    reason: "count",
    itemUnitOfMeasure: "EA",
  })

const corrected = (idempotencyKey: string, adjustment: bigint) =>
  new StockCorrected({ idempotencyKey, adjustment, unitOfMeasure: "EA", reason: "count" })

const onHand = (expected: bigint) => (state: { readonly onHand: bigint }) =>
  assert.strictEqual(state.onHand, expected)

describe("INV-STOCK-3 on Alchemy: one idempotency key names one request", () => {
  // [INV-STOCK-3]
  it.effect("a retried correction applies once, even after later commands", () =>
    story(
      Story.given(item, tenOnHand),
      Story.when(item, correct("c-1", -2n)),
      Story.then(item, corrected("c-1", -2n)),
      Story.when(item, correct("c-2", -1n)),
      Story.then(item, corrected("c-2", -1n)),
      // The key is kept in the state, so the retry is still a no-op after a later command.
      Story.when(item, correct("c-1", -2n)),
      Story.then(item),
      Story.state(item, onHand(7n)),
    ),
  )

  // [INV-STOCK-3]
  it.effect("a key reused with different content is refused and records nothing", () =>
    story(
      Story.given(item, tenOnHand, corrected("c-1", -2n)),
      Story.when(item, correct("c-1", -5n)),
      Story.rejected(new CorrectionKeyReused({ idempotencyKey: "c-1" })),
      Story.then(item),
      Story.state(item, onHand(8n)),
    ),
  )

  // [INV-STOCK-3]
  it.effect(
    "retry contract: the receipt of a repeated command id and the key in the state agree here",
    () =>
      story(
        Story.given(item, tenOnHand),
        Story.when(item, correct("c-1", -2n), { commandId: "req-1" }),
        Story.then(item, corrected("c-1", -2n)),
        Story.when(item, correct("c-1", -2n), { commandId: "req-1" }),
        Story.then(item),
        Story.state(item, onHand(8n)),
      ),
  )

  // [INV-STOCK-3]
  it.effect("gap: a key already used for other stock is not visible to this instance", () =>
    story(
      Story.given(item, tenOnHand, corrected("c-1", -2n)),
      Story.given(otherItem, tenOnHand),
      // Production refuses a key reused for different stock anywhere in the tenant. One stock item
      // cannot see another, so the same key is accepted here; closing it needs a claim kept
      // outside the stock item (phase 2, deliverable 4).
      Story.when(otherItem, correct("c-1", -2n)),
      Story.then(otherItem, corrected("c-1", -2n)),
    ),
  )
})
