import { assert, describe, it } from "@effect/vitest"
import * as Data from "effect/Data"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import { staleClaim } from "../../../../framework/foundation/domain-model/mod.ts"
import {
  ClaimHeld,
  ClaimId,
  ClaimKey,
  CorrectionCompleted,
  CorrectionKeyClaim,
  CorrectionRefused,
  CorrectionRequest,
  CorrectionRequested,
  CorrectWithClaim,
  InventoryCorrectionClaims,
  InventoryCorrectionClaimsHandlers,
  KeyClaimed,
  KeyReleased,
  ReleaseKey,
  RequestCorrection,
} from "../src/correction-claim-model.ts"
import {
  CorrectionKeyReused,
  StockCorrected,
  StockItem,
  StockReceived,
  StockUnavailable,
} from "../src/domain-model.ts"

const { Story } = Domain

type Outcome = Data.TaggedEnum<{
  Completed: { readonly result: undefined }
  Rejected: { readonly rejection: CorrectionKeyReused | StockUnavailable }
}>

const Outcome = Data.taggedEnum<Outcome>()

const story = Story.make(InventoryCorrectionClaims, {
  layer: InventoryCorrectionClaimsHandlers,
})

const tenant = "t-1"
const itemA = StockItem.ref("w-1/A")
const itemB = StockItem.ref("w-1/B")
const claimOf = (key: string) => CorrectionKeyClaim.ref(ClaimId.make(`${tenant}/${key}`))
const request = (id: string) => CorrectionRequest.ref(id)

const tenOnHand = new StockReceived({ quantity: 10n })

const input = (stockItemId: string, key: string, adjustment: bigint, reason = "count") => ({
  stockItemId,
  claimId: `${tenant}/${key}`,
  idempotencyKey: key,
  adjustment,
  unitOfMeasure: "EA",
  reason,
  itemUnitOfMeasure: "EA",
})

const ask = (stockItemId: string, key: string, adjustment: bigint, reason?: string) =>
  new RequestCorrection(input(stockItemId, key, adjustment, reason))

const requested = (stockItemId: string, key: string, adjustment: bigint, reason?: string) =>
  new CorrectionRequested(input(stockItemId, key, adjustment, reason))

const corrected = (key: string, adjustment: bigint, reason = "count") =>
  new StockCorrected({ idempotencyKey: key, adjustment, unitOfMeasure: "EA", reason })

const done = new CorrectionCompleted()
const refused = new CorrectionRefused({ reason: "rejected" })
const completed = Outcome.Completed({ result: undefined })

const reused = (key: string) =>
  Outcome.Rejected({ rejection: new CorrectionKeyReused({ idempotencyKey: key }) })

describe("the claim protocol for the stock correction key (INV-STOCK-3)", () => {
  it("the model is well defined", () =>
    assert.deepStrictEqual(Domain.verify(InventoryCorrectionClaims), []))

  // [INV-STOCK-3]
  it.effect("a free key is claimed and the correction is recorded under it", () =>
    story(
      Story.given(itemA, tenOnHand),
      Story.when(request("r-1"), ask("w-1/A", "k-1", -3n)),
      Story.then(request("r-1"), requested("w-1/A", "k-1", -3n), done),
      Story.then(itemA, corrected("k-1", -3n)),
      Story.then(claimOf("k-1"), new KeyClaimed({ holder: "w-1/A" })),
      Story.saga(CorrectWithClaim, request("r-1"), completed),
    ),
  )

  // [INV-STOCK-3]
  it.effect("a key held by another stock item is refused and nothing is recorded", () =>
    story(
      Story.given(itemB, tenOnHand, corrected("k-1", -1n)),
      Story.given(claimOf("k-1"), new KeyClaimed({ holder: "w-1/B" })),
      Story.given(itemA, tenOnHand),
      Story.when(request("r-2"), ask("w-1/A", "k-1", -3n)),
      Story.then(request("r-2"), requested("w-1/A", "k-1", -3n), refused),
      Story.then(itemA),
      Story.then(claimOf("k-1")),
      Story.saga(CorrectWithClaim, request("r-2"), reused("k-1")),
    ),
  )

  // [INV-STOCK-3]
  it.effect("a retry by the holder takes nothing and records nothing", () =>
    story(
      Story.given(itemA, tenOnHand, corrected("k-1", -3n)),
      Story.given(claimOf("k-1"), new KeyClaimed({ holder: "w-1/A" })),
      Story.when(request("r-3"), ask("w-1/A", "k-1", -3n)),
      Story.then(request("r-3"), requested("w-1/A", "k-1", -3n), done),
      Story.then(itemA),
      Story.then(claimOf("k-1")),
      Story.saga(CorrectWithClaim, request("r-3"), completed),
    ),
  )

  // [INV-STOCK-3]
  it.effect("a refused correction releases the claim this run took", () =>
    story(
      Story.given(itemA, tenOnHand),
      // Ten on hand cannot lose twenty, so the claim taken first is released.
      Story.when(request("r-4"), ask("w-1/A", "k-2", -20n)),
      Story.then(request("r-4"), requested("w-1/A", "k-2", -20n), refused),
      Story.then(itemA),
      Story.then(
        claimOf("k-2"),
        new KeyClaimed({ holder: "w-1/A" }),
        new KeyReleased({ holder: "w-1/A" }),
      ),
      Story.saga(
        CorrectWithClaim,
        request("r-4"),
        Outcome.Rejected({ rejection: new StockUnavailable({ available: 10n, requested: 20n }) }),
      ),
      // The key is free again for any stock item.
      Story.given(itemB, tenOnHand),
      Story.when(request("r-5"), ask("w-1/B", "k-2", -2n)),
      Story.then(request("r-5"), requested("w-1/B", "k-2", -2n), done),
      Story.then(itemB, corrected("k-2", -2n)),
      Story.then(claimOf("k-2"), new KeyClaimed({ holder: "w-1/B" })),
      Story.saga(CorrectWithClaim, request("r-5"), completed),
    ),
  )

  // [INV-STOCK-3]
  it.effect("retry contract: the same key with other content fails and its claim stays", () =>
    story(
      Story.given(itemA, tenOnHand, corrected("k-1", -3n)),
      Story.given(claimOf("k-1"), new KeyClaimed({ holder: "w-1/A" })),
      Story.when(request("r-6"), ask("w-1/A", "k-1", -2n)),
      Story.then(request("r-6"), requested("w-1/A", "k-1", -2n), refused),
      Story.then(itemA),
      // The holder's retry took nothing, so nothing is released: the item still carries the key.
      Story.then(claimOf("k-1")),
      Story.saga(CorrectWithClaim, request("r-6"), reused("k-1")),
    ),
  )

  // [INV-STOCK-3]
  it.effect("a crash after the claim: the holder's retry proceeds, another item waits", () =>
    story(
      // The claim was taken and the correction never reached the item.
      Story.given(itemA, tenOnHand),
      Story.given(claimOf("k-1"), new KeyClaimed({ holder: "w-1/A" })),
      Story.given(itemB, tenOnHand),
      // Another item sees a false conflict while the claim is stale...
      Story.when(request("r-7"), ask("w-1/B", "k-1", -1n)),
      Story.then(request("r-7"), requested("w-1/B", "k-1", -1n), refused),
      Story.saga(CorrectWithClaim, request("r-7"), reused("k-1")),
      // ...the holder's own retry takes nothing and records.
      Story.when(request("r-8"), ask("w-1/A", "k-1", -3n)),
      Story.then(request("r-8"), requested("w-1/A", "k-1", -3n), done),
      Story.then(itemA, corrected("k-1", -3n)),
      Story.saga(CorrectWithClaim, request("r-8"), completed),
    ),
  )

  // [INV-STOCK-3]
  it.effect("a sweep frees a claim whose holder never carried the key", () =>
    story(
      Story.given(itemA, tenOnHand),
      Story.given(claimOf("k-1"), new KeyClaimed({ holder: "w-1/A" })),
      Story.given(itemB, tenOnHand),
      // The sweep reads the holder (it carries no such correction), asks `staleClaim`, releases.
      Story.when(claimOf("k-1"), new ReleaseKey({ holder: "w-1/A" })),
      Story.then(claimOf("k-1"), new KeyReleased({ holder: "w-1/A" })),
      Story.when(request("r-9"), ask("w-1/B", "k-1", -1n)),
      Story.then(request("r-9"), requested("w-1/B", "k-1", -1n), done),
      Story.then(itemB, corrected("k-1", -1n)),
      Story.then(claimOf("k-1"), new KeyClaimed({ holder: "w-1/B" })),
      Story.saga(CorrectWithClaim, request("r-9"), completed),
    ),
  )

  it("decides a claim stale only when its holder does not carry the key", () => {
    assert.isTrue(staleClaim("w-1/A", undefined))
    assert.isTrue(staleClaim("w-1/A", "w-1/B"))
    assert.isFalse(staleClaim("w-1/A", "w-1/A"))
  })

  // [INV-STOCK-3]
  it.effect("only the holder can release a claim, and claiming twice is a no-op", () =>
    story(
      Story.given(claimOf("k-1"), new KeyClaimed({ holder: "w-1/A" })),
      Story.when(claimOf("k-1"), new ReleaseKey({ holder: "w-1/B" })),
      Story.then(claimOf("k-1")),
      Story.when(claimOf("k-1"), new ClaimKey({ holder: "w-1/A" })),
      Story.then(claimOf("k-1")),
      Story.when(claimOf("k-1"), new ClaimKey({ holder: "w-1/B" })),
      Story.rejected(new ClaimHeld({ holder: "w-1/A" })),
      Story.then(claimOf("k-1")),
    ),
  )
})
