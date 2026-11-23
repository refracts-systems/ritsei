import { assert, describe, it } from "@effect/vitest"
import * as Data from "effect/Data"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import { staleClaim } from "../../../../framework/foundation/domain-model/mod.ts"
import {
  ClaimId,
  ClaimKey,
  ConfirmationCompleted,
  ConfirmationKeyClaim,
  ConfirmationRefused,
  ConfirmationRequest,
  ConfirmationRequested,
  ConfirmWithClaim,
  KeyClaimed,
  KeyReleased,
  ReleaseKey,
  RequestConfirmation,
  SalesConfirmationClaims,
  SalesConfirmationClaimsHandlers,
  ClaimHeld,
} from "../src/confirmation-claim-model.ts"
import {
  OrderCancelled,
  OrderConfirmed,
  OrderCreated,
  SalesOrder,
  SalesOrderConfirmationIdempotencyConflict,
  SalesOrderInvalidState,
} from "../src/domain-model.ts"

const { Story } = Domain

type Outcome = Data.TaggedEnum<{
  Completed: { readonly result: undefined }
  Rejected: {
    readonly rejection: SalesOrderConfirmationIdempotencyConflict | SalesOrderInvalidState
  }
}>

const Outcome = Data.taggedEnum<Outcome>()

const story = Story.make(SalesConfirmationClaims, { layer: SalesConfirmationClaimsHandlers })

const lines = [
  { itemId: "00000000-0000-4000-8000-000000000041", quantity: "2", unitPrice: "10.50" },
]

const created = new OrderCreated({ customerId: "c-1", quotationId: null, lines, total: "21.00" })
const confirmed = (key: string) => new OrderConfirmed({ idempotencyKey: key })

const order1 = SalesOrder.ref("o-1")
const order2 = SalesOrder.ref("o-2")
const tenant = "t-1"
const claimOf = (key: string) => ConfirmationKeyClaim.ref(ClaimId.make(`${tenant}/${key}`))
const request = (id: string) => ConfirmationRequest.ref(id)

const ask = (orderId: string, confirmationKey: string) =>
  new RequestConfirmation({ orderId, confirmationKey, claimId: `${tenant}/${confirmationKey}` })

const requested = (orderId: string, confirmationKey: string) =>
  new ConfirmationRequested({ orderId, confirmationKey, claimId: `${tenant}/${confirmationKey}` })

const done = new ConfirmationCompleted()
const refused = new ConfirmationRefused({ reason: "rejected" })
const completed = Outcome.Completed({ result: undefined })
const conflict = Outcome.Rejected({ rejection: new SalesOrderConfirmationIdempotencyConflict() })

describe("the claim protocol for the confirmation key (SAL-ORDER-2)", () => {
  it("the model is well defined", () =>
    assert.deepStrictEqual(Domain.verify(SalesConfirmationClaims), []))

  // [SAL-ORDER-2]
  it.effect("a free key is claimed and the order is confirmed under it", () =>
    story(
      Story.given(order1, created),
      Story.when(request("r-1"), ask("o-1", "k-1")),
      Story.then(request("r-1"), requested("o-1", "k-1"), done),
      Story.then(order1, confirmed("k-1")),
      Story.then(claimOf("k-1"), new KeyClaimed({ holder: "o-1" })),
      Story.saga(ConfirmWithClaim, request("r-1"), completed),
    ),
  )

  // [SAL-ORDER-2]
  it.effect("a key held by another order is refused and nothing is recorded on this order", () =>
    story(
      Story.given(order1, created, confirmed("k-1")),
      Story.given(claimOf("k-1"), new KeyClaimed({ holder: "o-1" })),
      Story.given(order2, created),
      Story.when(request("r-2"), ask("o-2", "k-1")),
      Story.then(request("r-2"), requested("o-2", "k-1"), refused),
      Story.then(order2),
      Story.then(claimOf("k-1")),
      Story.saga(ConfirmWithClaim, request("r-2"), conflict),
    ),
  )

  // [SAL-ORDER-2]
  it.effect("a retry by the holder takes nothing and records nothing", () =>
    story(
      Story.given(order1, created, confirmed("k-1")),
      Story.given(claimOf("k-1"), new KeyClaimed({ holder: "o-1" })),
      Story.when(request("r-3"), ask("o-1", "k-1")),
      Story.then(request("r-3"), requested("o-1", "k-1"), done),
      Story.then(order1),
      Story.then(claimOf("k-1")),
      Story.saga(ConfirmWithClaim, request("r-3"), completed),
    ),
  )

  // [SAL-ORDER-2]
  it.effect("a refused confirmation releases the claim this run took", () =>
    story(
      Story.given(order1, created, confirmed("k-1")),
      Story.given(claimOf("k-1"), new KeyClaimed({ holder: "o-1" })),
      // The order carries k-1, so k-2 conflicts on the order after the claim was taken.
      Story.when(request("r-4"), ask("o-1", "k-2")),
      Story.then(request("r-4"), requested("o-1", "k-2"), refused),
      Story.then(order1),
      Story.then(
        claimOf("k-2"),
        new KeyClaimed({ holder: "o-1" }),
        new KeyReleased({ holder: "o-1" }),
      ),
      Story.saga(ConfirmWithClaim, request("r-4"), conflict),
      // The key is free again for any order.
      Story.given(order2, created),
      Story.when(request("r-5"), ask("o-2", "k-2")),
      Story.then(request("r-5"), requested("o-2", "k-2"), done),
      Story.then(order2, confirmed("k-2")),
      Story.then(claimOf("k-2"), new KeyClaimed({ holder: "o-2" })),
      Story.saga(ConfirmWithClaim, request("r-5"), completed),
    ),
  )

  // [SAL-ORDER-2]
  it.effect("retry contract: after cancellation the key still fails and its claim stays", () =>
    story(
      Story.given(order1, created, confirmed("k-1"), new OrderCancelled()),
      Story.given(claimOf("k-1"), new KeyClaimed({ holder: "o-1" })),
      Story.when(request("r-6"), ask("o-1", "k-1")),
      Story.then(request("r-6"), requested("o-1", "k-1"), refused),
      Story.then(order1),
      // The holder's retry took nothing, so nothing is released: the cancelled order still carries
      // the key it was confirmed with.
      Story.then(claimOf("k-1")),
      Story.saga(
        ConfirmWithClaim,
        request("r-6"),
        Outcome.Rejected({ rejection: new SalesOrderInvalidState({ status: "cancelled" }) }),
      ),
    ),
  )

  // [SAL-ORDER-2]
  it.effect("a crash after the claim: the holder's retry proceeds, another order waits", () =>
    story(
      // The claim was taken and the confirmation never reached the order.
      Story.given(order1, created),
      Story.given(claimOf("k-1"), new KeyClaimed({ holder: "o-1" })),
      Story.given(order2, created),
      // Another order sees a false conflict while the claim is stale...
      Story.when(request("r-7"), ask("o-2", "k-1")),
      Story.then(request("r-7"), requested("o-2", "k-1"), refused),
      Story.saga(ConfirmWithClaim, request("r-7"), conflict),
      // ...the holder's own retry takes nothing and confirms.
      Story.when(request("r-8"), ask("o-1", "k-1")),
      Story.then(request("r-8"), requested("o-1", "k-1"), done),
      Story.then(order1, confirmed("k-1")),
      Story.saga(ConfirmWithClaim, request("r-8"), completed),
    ),
  )

  // [SAL-ORDER-2]
  it.effect("a sweep frees a claim whose holder never carried the key", () =>
    story(
      Story.given(order1, created),
      Story.given(claimOf("k-1"), new KeyClaimed({ holder: "o-1" })),
      Story.given(order2, created),
      // The sweep reads the holder (it carries no key), asks `staleClaim`, and releases.
      Story.when(claimOf("k-1"), new ReleaseKey({ holder: "o-1" })),
      Story.then(claimOf("k-1"), new KeyReleased({ holder: "o-1" })),
      Story.when(request("r-9"), ask("o-2", "k-1")),
      Story.then(request("r-9"), requested("o-2", "k-1"), done),
      Story.then(order2, confirmed("k-1")),
      Story.then(claimOf("k-1"), new KeyClaimed({ holder: "o-2" })),
      Story.saga(ConfirmWithClaim, request("r-9"), completed),
    ),
  )

  it("decides a claim stale only when its holder does not carry the key", () => {
    assert.isTrue(staleClaim("o-1", undefined))
    assert.isTrue(staleClaim("o-1", "o-2"))
    assert.isFalse(staleClaim("o-1", "o-1"))
  })

  // [SAL-ORDER-2]
  it.effect("only the holder can release a claim, and claiming twice is a no-op", () =>
    story(
      Story.given(claimOf("k-1"), new KeyClaimed({ holder: "o-1" })),
      Story.when(claimOf("k-1"), new ReleaseKey({ holder: "o-2" })),
      Story.then(claimOf("k-1")),
      Story.when(claimOf("k-1"), new ClaimKey({ holder: "o-1" })),
      Story.then(claimOf("k-1")),
      Story.when(claimOf("k-1"), new ClaimKey({ holder: "o-2" })),
      Story.rejected(new ClaimHeld({ holder: "o-1" })),
      Story.then(claimOf("k-1")),
    ),
  )
})
