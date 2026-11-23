import { assert, describe, it } from "@effect/vitest"
import * as Layer from "effect/Layer"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import {
  ApprovalSubmitted,
  ApprovalSubjectId,
  draftApprovalReason,
  ProcurementDraftApproval,
  PurchaseApprovalRequest,
  SubmitApproval,
  SubmitApprovalOnDraftLive,
  thresholdPolicy,
} from "../src/draft-approval-model.ts"
import {
  DraftPurchaseOrder,
  PurchaseOrder,
  PurchaseOrderDrafted,
  purchaseOrderInstanceId,
} from "../src/domain-model.ts"

const { Story } = Domain

const story = Story.make(ProcurementDraftApproval, {
  layer: SubmitApprovalOnDraftLive.pipe(Layer.provide(thresholdPolicy("500.00"))),
})

const tenant = "t-1"
const orderId = purchaseOrderInstanceId(tenant, "po-1")
const order = PurchaseOrder.ref(orderId)
const request = PurchaseApprovalRequest.ref(ApprovalSubjectId.make(orderId))

const itemA = "00000000-0000-4000-8000-0000000000a1"

const draft = (unitPrice: string) =>
  new DraftPurchaseOrder({
    supplierAccountId: "sa-1",
    lines: [{ itemId: itemA, quantity: "100", unitPrice }],
  })

const drafted = (unitPrice: string, total: string) =>
  new PurchaseOrderDrafted({
    supplierAccountId: "sa-1",
    lines: [{ itemId: itemA, quantity: "100", unitPrice }],
    total,
  })

describe("PRC-DRAFT-1 as a policy: the approval request follows the draft", () => {
  // [PRC-DRAFT-1]
  it.effect("a draft strictly above the threshold submits a request for its total", () =>
    story(
      Story.when(order, draft("6.00")),
      Story.then(order, drafted("6.00", "600.00")),
      // The drafted order carries no request; it arrives on its own stream.
      Story.then(request, new ApprovalSubmitted({ amount: "600.00", reason: draftApprovalReason })),
    ),
  )

  // [PRC-DRAFT-1]
  it.effect("a draft at the threshold needs no request", () =>
    story(
      Story.when(order, draft("5.00")),
      Story.then(order, drafted("5.00", "500.00")),
      Story.then(request),
    ),
  )

  // [PRC-DRAFT-1]
  it.effect("one request per order: a repeated submission records nothing", () =>
    story(
      Story.given(
        request,
        new ApprovalSubmitted({ amount: "600.00", reason: draftApprovalReason }),
      ),
      Story.when(request, new SubmitApproval({ amount: "600.00", reason: draftApprovalReason })),
      Story.then(request),
    ),
  )

  it("the model is well defined", () =>
    assert.deepStrictEqual(Domain.verify(ProcurementDraftApproval), []))
})
