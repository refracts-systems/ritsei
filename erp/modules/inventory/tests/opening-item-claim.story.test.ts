import { assert, describe, it } from "@effect/vitest"
import * as Data from "effect/Data"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import { staleClaim } from "../../../../framework/foundation/domain-model/mod.ts"
import {
  OpeningAccepted,
  OpeningLoad,
  OpeningStockConflict,
  RevaluationApprovalMismatch,
} from "../src/domain-model.ts"
import {
  ClaimHeld,
  ClaimId,
  ClaimItem,
  InventoryOpeningClaims,
  InventoryOpeningClaimsHandlers,
  ItemClaimed,
  ItemReleased,
  OpeningItemClaim,
  OpeningRequest,
  OpeningRequestCompleted,
  OpeningRequestRefused,
  OpeningRequested,
  OpeningStockAlreadyLoaded,
  OpenWithClaims,
  ReleaseItem,
  RequestOpening,
} from "../src/opening-item-claim-model.ts"

const { Story } = Domain

type Outcome = Data.TaggedEnum<{
  Completed: { readonly result: undefined }
  Rejected: {
    readonly rejection:
      | OpeningStockAlreadyLoaded
      | RevaluationApprovalMismatch
      | OpeningStockConflict
  }
}>

const Outcome = Data.taggedEnum<Outcome>()

const story = Story.make(InventoryOpeningClaims, { layer: InventoryOpeningClaimsHandlers })

const tenant = "t-1"
const warehouse = "w-1"
const opening1 = OpeningLoad.ref("o-1")
const opening2 = OpeningLoad.ref("o-2")

const claimOf = (item: string) =>
  OpeningItemClaim.ref(ClaimId.make(`${tenant}/${warehouse}/${item}`))

const request = (id: string) => OpeningRequest.ref(id)

const line = (itemId: string, overrides: Record<string, string> = {}) => ({
  itemId,
  quantity: "10",
  sourceValue: "100.00",
  tracking: "none" as const,
  reservedQuantity: "0",
  inTransitQuantity: "0",
  ...overrides,
})

const cutoff = "2026-12-31"

const input = (
  openingId: string,
  items: ReadonlyArray<ReturnType<typeof line>>,
  date = cutoff,
) => ({
  tenant,
  openingId,
  warehouseId: warehouse,
  cutoffDate: date,
  revaluationApprovedBy: null,
  lines: items,
})

const ask = (openingId: string, items: ReadonlyArray<ReturnType<typeof line>>, date?: string) =>
  new RequestOpening(input(openingId, items, date))

const requested = (
  openingId: string,
  items: ReadonlyArray<ReturnType<typeof line>>,
  date?: string,
) => new OpeningRequested(input(openingId, items, date))

const accepted = (items: ReadonlyArray<ReturnType<typeof line>>, date = cutoff) =>
  new OpeningAccepted({ warehouseId: warehouse, cutoffDate: date, lines: items })

const claimed = (holder: string) => new ItemClaimed({ holder })
const released = (holder: string) => new ItemReleased({ holder })

const done = new OpeningRequestCompleted()
const refused = new OpeningRequestRefused({ reason: "rejected" })
const completed = Outcome.Completed({ result: undefined })

const rejectedWith = (rejection: Extract<Outcome, { _tag: "Rejected" }>["rejection"]) =>
  Outcome.Rejected({ rejection })

const alreadyLoaded = (itemId: string) =>
  rejectedWith(new OpeningStockAlreadyLoaded({ warehouseId: warehouse, itemId }))

const a = line("A")
const b = line("B")

// A moving-average value needs the revaluation approval, which these requests do not carry.
const revalued = line("B", { movingAverageValue: "90.00" })

describe("the claim protocol for the items of an opening (INV-OPEN-4)", () => {
  it("the model is well defined", () =>
    assert.deepStrictEqual(Domain.verify(InventoryOpeningClaims), []))

  // [INV-OPEN-4]
  it.effect("free items are claimed by the load and the load is accepted", () =>
    story(
      Story.when(request("r-1"), ask("o-1", [a, b])),
      Story.then(request("r-1"), requested("o-1", [a, b]), done),
      Story.then(opening1, accepted([a, b])),
      Story.then(claimOf("A"), claimed("o-1")),
      Story.then(claimOf("B"), claimed("o-1")),
      Story.saga(OpenWithClaims, request("r-1"), completed),
    ),
  )

  // [INV-OPEN-4]
  it.effect(
    "an item already opened by another load is refused and releases what this run took",
    () =>
      story(
        Story.given(opening2, accepted([b])),
        Story.given(claimOf("B"), claimed("o-2")),
        Story.when(request("r-2"), ask("o-1", [a, b])),
        Story.then(request("r-2"), requested("o-1", [a, b]), refused),
        Story.then(opening1),
        // A was taken before B was refused, so only A is released again.
        Story.then(claimOf("A"), claimed("o-1"), released("o-1")),
        Story.then(claimOf("B")),
        Story.saga(OpenWithClaims, request("r-2"), alreadyLoaded("B")),
      ),
  )

  // [INV-OPEN-4]
  it.effect("the same load retried takes nothing and is accepted as the aggregate's repeat", () =>
    story(
      Story.given(opening1, accepted([a, b])),
      Story.given(claimOf("A"), claimed("o-1")),
      Story.given(claimOf("B"), claimed("o-1")),
      Story.when(request("r-3"), ask("o-1", [a, b])),
      Story.then(request("r-3"), requested("o-1", [a, b]), done),
      Story.then(opening1),
      Story.then(claimOf("A")),
      Story.then(claimOf("B")),
      Story.saga(OpenWithClaims, request("r-3"), completed),
    ),
  )

  // [INV-OPEN-4]
  it.effect("a refused acceptance releases every claim this run took", () =>
    story(
      // The bundle states a moving-average value with no revaluation approval.
      Story.when(request("r-4"), ask("o-1", [a, revalued])),
      Story.then(request("r-4"), requested("o-1", [a, revalued]), refused),
      Story.then(opening1),
      Story.then(claimOf("A"), claimed("o-1"), released("o-1")),
      Story.then(claimOf("B"), claimed("o-1"), released("o-1")),
      Story.saga(OpenWithClaims, request("r-4"), rejectedWith(new RevaluationApprovalMismatch())),
      // Both items are free again for another load.
      Story.when(request("r-5"), ask("o-2", [a, b])),
      Story.then(request("r-5"), requested("o-2", [a, b]), done),
      Story.then(opening2, accepted([a, b])),
      Story.then(claimOf("A"), claimed("o-2")),
      Story.then(claimOf("B"), claimed("o-2")),
      Story.saga(OpenWithClaims, request("r-5"), completed),
    ),
  )

  // [INV-OPEN-4]
  it.effect(
    "retry contract: the same load with another cutoff date fails and keeps its claims",
    () =>
      story(
        Story.given(opening1, accepted([a, b])),
        Story.given(claimOf("A"), claimed("o-1")),
        Story.given(claimOf("B"), claimed("o-1")),
        Story.when(request("r-6"), ask("o-1", [a, b], "2027-01-31")),
        Story.then(request("r-6"), requested("o-1", [a, b], "2027-01-31"), refused),
        Story.then(opening1),
        // The load took nothing this run, so nothing is released: it still carries both items.
        Story.then(claimOf("A")),
        Story.then(claimOf("B")),
        Story.saga(OpenWithClaims, request("r-6"), rejectedWith(new OpeningStockConflict())),
      ),
  )

  // [INV-OPEN-4]
  it.effect("a crash after the claims: the load's retry proceeds, another load waits", () =>
    story(
      // The items were claimed and the load never reached its aggregate.
      Story.given(claimOf("A"), claimed("o-1")),
      Story.given(claimOf("B"), claimed("o-1")),
      // Another load sees a false conflict while the claims are stale...
      Story.when(request("r-7"), ask("o-2", [a])),
      Story.then(request("r-7"), requested("o-2", [a]), refused),
      Story.saga(OpenWithClaims, request("r-7"), alreadyLoaded("A")),
      // ...the load's own retry takes nothing and is accepted.
      Story.when(request("r-8"), ask("o-1", [a, b])),
      Story.then(request("r-8"), requested("o-1", [a, b]), done),
      Story.then(opening1, accepted([a, b])),
      Story.saga(OpenWithClaims, request("r-8"), completed),
    ),
  )

  // [INV-OPEN-4]
  it.effect("a sweep frees a claim whose holder never carried the item", () =>
    story(
      Story.given(claimOf("A"), claimed("o-1")),
      // The sweep reads the holder (no accepted load carries A), asks `staleClaim`, and releases.
      Story.when(claimOf("A"), new ReleaseItem({ holder: "o-1" })),
      Story.then(claimOf("A"), released("o-1")),
      Story.when(request("r-9"), ask("o-2", [a])),
      Story.then(request("r-9"), requested("o-2", [a]), done),
      Story.then(opening2, accepted([a])),
      Story.then(claimOf("A"), claimed("o-2")),
      Story.saga(OpenWithClaims, request("r-9"), completed),
    ),
  )

  it("decides a claim stale only when its holder does not carry the item", () => {
    assert.isTrue(staleClaim("o-1", undefined))
    assert.isTrue(staleClaim("o-1", "o-2"))
    assert.isFalse(staleClaim("o-1", "o-1"))
  })

  // [INV-OPEN-4]
  it.effect("only the holder can release a claim, and claiming twice is a no-op", () =>
    story(
      Story.given(claimOf("A"), claimed("o-1")),
      Story.when(claimOf("A"), new ReleaseItem({ holder: "o-2" })),
      Story.then(claimOf("A")),
      Story.when(claimOf("A"), new ClaimItem({ holder: "o-1" })),
      Story.then(claimOf("A")),
      Story.when(claimOf("A"), new ClaimItem({ holder: "o-2" })),
      Story.rejected(new ClaimHeld({ holder: "o-1" })),
      Story.then(claimOf("A")),
    ),
  )
})
