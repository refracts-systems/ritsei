import { assert, describe, it } from "@effect/vitest"
import * as Data from "effect/Data"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import { staleClaim } from "../../../../framework/foundation/domain-model/mod.ts"
import {
  ClaimId,
  ClaimKey,
  ConfirmationCompleted,
  PoConfirmationKeyClaim,
  ConfirmationRefused,
  ConfirmationRequest,
  ConfirmationRequested,
  ConfirmWithClaim,
  KeyClaimed,
  KeyReleased,
  ReleaseKey,
  RequestConfirmation,
  ProcurementConfirmationClaims,
  ProcurementConfirmationClaimsHandlers,
  ClaimHeld,
} from "../src/po-confirmation-claim-model.ts"
import {
  PurchaseOrder,
  PurchaseOrderApprovalRequired,
  PurchaseOrderCancelled,
  PurchaseOrderConfirmationIdempotencyConflict,
  PurchaseOrderConfirmed,
  PurchaseOrderDrafted,
  PurchaseOrderInvalidState,
  purchaseOrderInstanceId,
} from "../src/domain-model.ts"

const { Story } = Domain

type Outcome = Data.TaggedEnum<{
  Completed: { readonly result: undefined }
  Rejected: {
    readonly rejection:
      | PurchaseOrderConfirmationIdempotencyConflict
      | PurchaseOrderInvalidState
      | PurchaseOrderApprovalRequired
  }
}>

const Outcome = Data.taggedEnum<Outcome>()

const story = Story.make(ProcurementConfirmationClaims, {
  layer: ProcurementConfirmationClaimsHandlers,
})

const widgets = {
  itemId: "00000000-0000-4000-8000-0000000000a1",
  quantity: "100",
  unitPrice: "6.00",
}

const drafted = new PurchaseOrderDrafted({
  supplierAccountId: "sa-1",
  lines: [widgets],
  total: "600.00",
})

// The story clock starts here, and confirmation stamps the order with it.
const at = "2026-01-01T00:00:00.000Z"

const confirmed = (key: string) =>
  new PurchaseOrderConfirmed({ idempotencyKey: key, confirmedAt: at })

const tenant = "t-1"

// The holder of a claim is the order's instance id, so another tenant's order never matches.
const holder1 = purchaseOrderInstanceId(tenant, "po-1")
const holder2 = purchaseOrderInstanceId(tenant, "po-2")
const order1 = PurchaseOrder.ref(holder1)
const order2 = PurchaseOrder.ref(holder2)
const claimOf = (key: string) => PoConfirmationKeyClaim.ref(ClaimId.make(`${tenant}/${key}`))
const request = (id: string) => ConfirmationRequest.ref(id)

const noApproval = { approvalRequired: false, approval: null } as const

const ask = (orderId: string, confirmationKey: string) =>
  new RequestConfirmation({
    orderId,
    confirmationKey,
    claimId: `${tenant}/${confirmationKey}`,
    ...noApproval,
  })

const requested = (orderId: string, confirmationKey: string) =>
  new ConfirmationRequested({
    orderId,
    confirmationKey,
    claimId: `${tenant}/${confirmationKey}`,
    ...noApproval,
  })

const done = new ConfirmationCompleted()
const refused = new ConfirmationRefused({ reason: "rejected" })
const completed = Outcome.Completed({ result: undefined })

const conflict = Outcome.Rejected({
  rejection: new PurchaseOrderConfirmationIdempotencyConflict(),
})

describe("the claim protocol for the purchase order confirmation key (PRC-PO-3)", () => {
  it("the model is well defined", () =>
    assert.deepStrictEqual(Domain.verify(ProcurementConfirmationClaims), []))

  // [PRC-PO-3]
  it.effect("a free key is claimed and the order is confirmed under it", () =>
    story(
      Story.given(order1, drafted),
      Story.when(request("r-1"), ask(holder1, "k-1")),
      Story.then(request("r-1"), requested(holder1, "k-1"), done),
      Story.then(order1, confirmed("k-1")),
      Story.then(claimOf("k-1"), new KeyClaimed({ holder: holder1 })),
      Story.saga(ConfirmWithClaim, request("r-1"), completed),
    ),
  )

  // [PRC-PO-3]
  it.effect("a key held by another order is refused and nothing is recorded on this order", () =>
    story(
      Story.given(order1, drafted, confirmed("k-1")),
      Story.given(claimOf("k-1"), new KeyClaimed({ holder: holder1 })),
      Story.given(order2, drafted),
      Story.when(request("r-2"), ask(holder2, "k-1")),
      Story.then(request("r-2"), requested(holder2, "k-1"), refused),
      Story.then(order2),
      Story.then(claimOf("k-1")),
      Story.saga(ConfirmWithClaim, request("r-2"), conflict),
    ),
  )

  // [PRC-PO-3]
  it.effect("a retry by the holder takes nothing and records nothing", () =>
    story(
      Story.given(order1, drafted, confirmed("k-1")),
      Story.given(claimOf("k-1"), new KeyClaimed({ holder: holder1 })),
      Story.when(request("r-3"), ask(holder1, "k-1")),
      Story.then(request("r-3"), requested(holder1, "k-1"), done),
      Story.then(order1),
      Story.then(claimOf("k-1")),
      Story.saga(ConfirmWithClaim, request("r-3"), completed),
    ),
  )

  // [PRC-PO-3]
  it.effect("a refused confirmation releases the claim this run took", () =>
    story(
      Story.given(order1, drafted, confirmed("k-1")),
      Story.given(claimOf("k-1"), new KeyClaimed({ holder: holder1 })),
      // The order carries k-1, so k-2 conflicts on the order after the claim was taken.
      Story.when(request("r-4"), ask(holder1, "k-2")),
      Story.then(request("r-4"), requested(holder1, "k-2"), refused),
      Story.then(order1),
      Story.then(
        claimOf("k-2"),
        new KeyClaimed({ holder: holder1 }),
        new KeyReleased({ holder: holder1 }),
      ),
      Story.saga(ConfirmWithClaim, request("r-4"), conflict),
      // The key is free again for any order.
      Story.given(order2, drafted),
      Story.when(request("r-5"), ask(holder2, "k-2")),
      Story.then(request("r-5"), requested(holder2, "k-2"), done),
      Story.then(order2, confirmed("k-2")),
      Story.then(claimOf("k-2"), new KeyClaimed({ holder: holder2 })),
      Story.saga(ConfirmWithClaim, request("r-5"), completed),
    ),
  )

  // [PRC-PO-3]
  it.effect("a missing approval releases the claim this run took", () =>
    story(
      Story.given(order1, drafted),
      Story.when(
        request("r-10"),
        new RequestConfirmation({
          orderId: holder1,
          confirmationKey: "k-3",
          claimId: `${tenant}/k-3`,
          approvalRequired: true,
          approval: null,
        }),
      ),
      Story.then(
        request("r-10"),
        new ConfirmationRequested({
          orderId: holder1,
          confirmationKey: "k-3",
          claimId: `${tenant}/k-3`,
          approvalRequired: true,
          approval: null,
        }),
        refused,
      ),
      Story.then(order1),
      Story.then(
        claimOf("k-3"),
        new KeyClaimed({ holder: holder1 }),
        new KeyReleased({ holder: holder1 }),
      ),
      Story.saga(
        ConfirmWithClaim,
        request("r-10"),
        Outcome.Rejected({ rejection: new PurchaseOrderApprovalRequired({ status: "missing" }) }),
      ),
    ),
  )

  // [PRC-PO-3]
  it.effect("retry contract: after cancellation the key still fails and its claim stays", () =>
    story(
      Story.given(order1, drafted, confirmed("k-1"), new PurchaseOrderCancelled()),
      Story.given(claimOf("k-1"), new KeyClaimed({ holder: holder1 })),
      Story.when(request("r-6"), ask(holder1, "k-1")),
      Story.then(request("r-6"), requested(holder1, "k-1"), refused),
      Story.then(order1),
      // The holder's retry took nothing, so nothing is released: the cancelled order still carries
      // the key it was confirmed with.
      Story.then(claimOf("k-1")),
      Story.saga(
        ConfirmWithClaim,
        request("r-6"),
        Outcome.Rejected({ rejection: new PurchaseOrderInvalidState({ status: "cancelled" }) }),
      ),
    ),
  )

  // [PRC-PO-3]
  it.effect("a crash after the claim: the holder's retry proceeds, another order waits", () =>
    story(
      // The claim was taken and the confirmation never reached the order.
      Story.given(order1, drafted),
      Story.given(claimOf("k-1"), new KeyClaimed({ holder: holder1 })),
      Story.given(order2, drafted),
      // Another order sees a false conflict while the claim is stale...
      Story.when(request("r-7"), ask(holder2, "k-1")),
      Story.then(request("r-7"), requested(holder2, "k-1"), refused),
      Story.saga(ConfirmWithClaim, request("r-7"), conflict),
      // ...the holder's own retry takes nothing and confirms.
      Story.when(request("r-8"), ask(holder1, "k-1")),
      Story.then(request("r-8"), requested(holder1, "k-1"), done),
      Story.then(order1, confirmed("k-1")),
      Story.saga(ConfirmWithClaim, request("r-8"), completed),
    ),
  )

  // [PRC-PO-3]
  it.effect("a sweep frees a claim whose holder never carried the key", () =>
    story(
      Story.given(order1, drafted),
      Story.given(claimOf("k-1"), new KeyClaimed({ holder: holder1 })),
      Story.given(order2, drafted),
      // The sweep reads the holder (it carries no key), asks `staleClaim`, and releases.
      Story.when(claimOf("k-1"), new ReleaseKey({ holder: holder1 })),
      Story.then(claimOf("k-1"), new KeyReleased({ holder: holder1 })),
      Story.when(request("r-9"), ask(holder2, "k-1")),
      Story.then(request("r-9"), requested(holder2, "k-1"), done),
      Story.then(order2, confirmed("k-1")),
      Story.then(claimOf("k-1"), new KeyClaimed({ holder: holder2 })),
      Story.saga(ConfirmWithClaim, request("r-9"), completed),
    ),
  )

  it("decides a claim stale only when its holder does not carry the key", () => {
    assert.isTrue(staleClaim(holder1, undefined))
    assert.isTrue(staleClaim(holder1, holder2))
    assert.isFalse(staleClaim(holder1, holder1))
  })

  // [PRC-PO-3]
  it.effect("only the holder can release a claim, and claiming twice is a no-op", () =>
    story(
      Story.given(claimOf("k-1"), new KeyClaimed({ holder: holder1 })),
      Story.when(claimOf("k-1"), new ReleaseKey({ holder: holder2 })),
      Story.then(claimOf("k-1")),
      Story.when(claimOf("k-1"), new ClaimKey({ holder: holder1 })),
      Story.then(claimOf("k-1")),
      Story.when(claimOf("k-1"), new ClaimKey({ holder: holder2 })),
      Story.rejected(new ClaimHeld({ holder: holder1 })),
      Story.then(claimOf("k-1")),
    ),
  )
})
