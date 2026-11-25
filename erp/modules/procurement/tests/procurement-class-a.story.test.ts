import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Result from "effect/Result"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import {
  AuthorizationDenied,
  makeAuthorizationTestLayer,
} from "../../../../framework/modules/authorization/mod.ts"
import { makeMessagingTestLayer } from "../../../../framework/modules/messaging/mod.ts"
import { makeNumberingTestLayer } from "../../../../framework/modules/numbering/mod.ts"
import { makePartyTestLayer, PartyCapabilities } from "../../party/mod.ts"
import {
  makeProcurementTestLayer,
  makePurchaseOrderDocumentSnapshot,
  ProcurementCapabilities,
  ProcurementService,
  PurchaseOrderInvalidState as PurchaseOrderInvalidStateError,
} from "../mod.ts"
import {
  CancelPurchaseOrder,
  ConfirmPurchaseOrder,
  DraftPurchaseOrder,
  Procurement,
  PurchaseOrder,
  PurchaseOrderApprovalRequired,
  PurchaseOrderCancelled,
  PurchaseOrderConfirmationIdempotencyConflict,
  PurchaseOrderConfirmed,
  PurchaseOrderDrafted,
  PurchaseOrderHasReceipts,
  PurchaseOrderInvalidState,
  PurchaseOrderLinesInvalid,
  PurchaseOrderNotFound,
  purchaseOrderInstanceId,
  ReleasePurchaseOrder,
  SetSupplierPrice,
  SupplierPrice,
  SupplierPriceSet,
  supplierPriceInstanceId,
} from "../src/domain-model.ts"

const { Story } = Domain

const story = Story.make(Procurement)

const tenant = "t-1"
const order = PurchaseOrder.ref(purchaseOrderInstanceId(tenant, "po-1"))

const itemA = "00000000-0000-4000-8000-0000000000a1"
const itemB = "00000000-0000-4000-8000-0000000000b2"

const widgets = { itemId: itemA, quantity: "100", unitPrice: "6.00" }
const total = "600.00"

const drafted = new PurchaseOrderDrafted({
  supplierAccountId: "sa-1",
  lines: [widgets],
  total,
})

const draft = (lines: ReadonlyArray<{ itemId: string; quantity: string; unitPrice: string }>) =>
  new DraftPurchaseOrder({ supplierAccountId: "sa-1", lines })

// The story clock starts here, and confirmation stamps the order with it.
const at = "2026-01-01T00:00:00.000Z"

const confirmedBy = (idempotencyKey: string) =>
  new PurchaseOrderConfirmed({ idempotencyKey, confirmedAt: at })

const unapproved = { approvalRequired: false, approval: null } as const

type ApprovalInput = {
  readonly approvalRequired: boolean
  readonly approval: { readonly status: string; readonly amount: string } | null
}

const confirm = (idempotencyKey: string) =>
  new ConfirmPurchaseOrder({ idempotencyKey, ...unapproved })

const cancel = (hasReceipts = false) => new CancelPurchaseOrder({ hasReceipts })

describe("procurement on the domain model", () => {
  it("the model is well defined", () => assert.deepStrictEqual(Domain.verify(Procurement), []))

  // [PRC-PO-1]
  it.effect("a draft has no confirmation key or time, a confirmed order has both", () =>
    story(
      Story.when(order, draft([widgets])),
      Story.then(order, drafted),
      Story.state(order, {
        status: "draft",
        confirmationIdempotencyKey: null,
        confirmedAt: null,
      }),
      Story.when(order, confirm("k-1")),
      Story.then(order, confirmedBy("k-1")),
      Story.state(order, {
        status: "confirmed",
        confirmationIdempotencyKey: "k-1",
        confirmedAt: at,
      }),
    ),
  )

  // [PRC-PO-1]
  it.effect(
    "a confirmed order cannot be changed: its lines, supplier account, and total stay",
    () =>
      story(
        Story.given(order, drafted, confirmedBy("k-1")),
        Story.when(order, draft([{ itemId: itemB, quantity: "1", unitPrice: "1.00" }])),
        Story.rejected(new PurchaseOrderInvalidState({ status: "confirmed" })),
        Story.then(order),
        Story.state(order, { supplierAccountId: "sa-1", lines: [widgets], total }),
      ),
  )

  // [PRC-PO-1]
  it.effect("cancelling a confirmed order is idempotent and keeps the confirmation", () =>
    story(
      Story.given(order, drafted, confirmedBy("k-1")),
      Story.when(order, cancel()),
      Story.then(order, new PurchaseOrderCancelled()),
      Story.state(order, {
        status: "cancelled",
        confirmationIdempotencyKey: "k-1",
        confirmedAt: at,
        supplierAccountId: "sa-1",
        lines: [widgets],
        total,
      }),
      Story.when(order, cancel()),
      Story.then(order),
    ),
  )

  // [PRC-PO-1]
  it.effect("a cancelled order never reconfirms or changes, whatever key is offered", () =>
    story(
      Story.given(order, drafted, confirmedBy("k-1"), new PurchaseOrderCancelled()),
      Story.when(order, confirm("k-1")),
      Story.rejected(new PurchaseOrderInvalidState({ status: "cancelled" })),
      Story.when(order, confirm("k-2")),
      Story.rejected(new PurchaseOrderInvalidState({ status: "cancelled" })),
      Story.when(order, draft([widgets])),
      Story.rejected(new PurchaseOrderInvalidState({ status: "cancelled" })),
      Story.then(order),
    ),
  )

  // [PRC-PO-1]
  it.effect("a draft is not cancelled, and a confirmation with another key is refused", () =>
    story(
      Story.given(order, drafted),
      Story.when(order, cancel()),
      Story.rejected(new PurchaseOrderInvalidState({ status: "draft" })),
      Story.when(order, confirm("k-1")),
      Story.then(order, confirmedBy("k-1")),
      Story.when(order, confirm("k-2")),
      Story.rejected(new PurchaseOrderConfirmationIdempotencyConflict()),
      Story.then(order),
    ),
  )

  // [PRC-PO-1]
  it.effect("an order with a receipt is not cancelled", () =>
    story(
      Story.given(order, drafted, confirmedBy("k-1")),
      Story.when(order, cancel(true)),
      Story.rejected(new PurchaseOrderHasReceipts()),
      Story.then(order),
      Story.state(order, { status: "confirmed" }),
    ),
  )

  // [PRC-PO-2]
  it.effect("the total is derived exactly from the lines in minor units, never supplied", () =>
    story(
      // Three at 0.10 is 0.30 exactly, which floating point would not give.
      Story.when(order, draft([{ itemId: itemA, quantity: "3", unitPrice: "0.10" }])),
      Story.then(
        order,
        new PurchaseOrderDrafted({
          supplierAccountId: "sa-1",
          lines: [{ itemId: itemA, quantity: "3", unitPrice: "0.10" }],
          total: "0.30",
        }),
      ),
    ),
  )

  // [PRC-PO-2]
  it.effect("quantities beyond 2^53 are summed without losing a cent", () =>
    story(
      Story.when(
        order,
        draft([
          { itemId: itemA, quantity: "9007199254740993", unitPrice: "1.01" },
          { itemId: itemB, quantity: "2", unitPrice: "0.05" },
        ]),
      ),
      Story.then(
        order,
        new PurchaseOrderDrafted({
          supplierAccountId: "sa-1",
          lines: [
            { itemId: itemA, quantity: "9007199254740993", unitPrice: "1.01" },
            { itemId: itemB, quantity: "2", unitPrice: "0.05" },
          ],
          total: "9097271247288403.03",
        }),
      ),
    ),
  )

  const invalidLines = {
    "no line": [],
    "a zero quantity": [{ itemId: itemA, quantity: "0", unitPrice: "1.00" }],
    "a fractional quantity": [{ itemId: itemA, quantity: "1.5", unitPrice: "1.00" }],
    "a quantity beyond BIGINT": [
      { itemId: itemA, quantity: "9223372036854775808", unitPrice: "1.00" },
    ],
    "a negative price": [{ itemId: itemA, quantity: "1", unitPrice: "-1.00" }],
    "a price below a cent": [{ itemId: itemA, quantity: "1", unitPrice: "1.001" }],
    "a total beyond the amount boundary": [
      { itemId: itemA, quantity: "9223372036854775807", unitPrice: "999999999999999999.99" },
    ],
  }

  for (const [name, lines] of Object.entries(invalidLines)) {
    it.effect(`[PRC-PO-2] refuses an order with ${name} and records nothing`, () =>
      story(
        Story.when(order, draft(lines)),
        Story.rejected(new PurchaseOrderLinesInvalid()),
        Story.then(order),
        Story.state(order, { status: "absent" }),
      ),
    )
  }

  // [PRC-PO-4]
  it.effect("a purchase order of another tenant, or one that does not exist, is not found", () => {
    const foreign = PurchaseOrder.ref(purchaseOrderInstanceId("t-2", "po-1"))
    const unknown = PurchaseOrder.ref(purchaseOrderInstanceId(tenant, "po-404"))

    assert.notStrictEqual(foreign.id, order.id)

    return story(
      Story.given(order, drafted),
      Story.when(foreign, confirm("k-1")),
      Story.rejected(new PurchaseOrderNotFound()),
      Story.when(foreign, cancel()),
      Story.rejected(new PurchaseOrderNotFound()),
      Story.when(foreign, new ReleasePurchaseOrder({ idempotencyKey: "k-1", ...unapproved })),
      Story.rejected(new PurchaseOrderNotFound()),
      Story.when(unknown, confirm("k-1")),
      Story.rejected(new PurchaseOrderNotFound()),
      Story.then(foreign),
      Story.then(order),
      Story.state(order, { status: "draft" }),
    )
  })

  describe("approval of the total (ADR-0125)", () => {
    const required = (status: string, amount: string) => ({
      approvalRequired: true,
      approval: { status, amount },
    })

    const noRequest = { approvalRequired: true, approval: null } as const

    // The two paths take the same decision, so each outcome is stated once for both.
    describe("confirmPurchaseOrder", () => {
      const command = (approval: ApprovalInput) =>
        new ConfirmPurchaseOrder({ idempotencyKey: "k-1", ...approval })

      // [PRC-REL-1]
      it.effect("accepts an approval for exactly the total", () =>
        story(
          Story.given(order, drafted),
          Story.when(order, command(required("approved", "600.00"))),
          Story.then(order, confirmedBy("k-1")),
        ),
      )

      // [PRC-REL-1]
      it.effect("refuses an approval for less or for more than the total", () =>
        story(
          Story.given(order, drafted),
          Story.when(order, command(required("approved", "599.99"))),
          Story.rejected(new PurchaseOrderApprovalRequired({ status: "approved" })),
          Story.when(order, command(required("approved", "600.01"))),
          Story.rejected(new PurchaseOrderApprovalRequired({ status: "approved" })),
          Story.then(order),
          Story.state(order, { status: "draft" }),
        ),
      )

      // [PRC-REL-1]
      it.effect("refuses a request that is pending or rejected, or none, with its status", () =>
        story(
          Story.given(order, drafted),
          Story.when(order, command(required("pending", "600.00"))),
          Story.rejected(new PurchaseOrderApprovalRequired({ status: "pending" })),
          Story.when(order, command(required("rejected", "600.00"))),
          Story.rejected(new PurchaseOrderApprovalRequired({ status: "rejected" })),
          Story.when(order, command(noRequest)),
          Story.rejected(new PurchaseOrderApprovalRequired({ status: "missing" })),
          Story.then(order),
        ),
      )

      // [PRC-REL-1]
      it.effect("needs no approval where the policy does not require one", () =>
        story(
          Story.given(order, drafted),
          Story.when(order, command(unapproved)),
          Story.then(order, confirmedBy("k-1")),
        ),
      )
    })

    describe("releasePurchaseOrder", () => {
      const command = (approval: ApprovalInput) =>
        new ReleasePurchaseOrder({ idempotencyKey: "k-1", ...approval })

      // [PRC-REL-1]
      it.effect("accepts an approval for exactly the total", () =>
        story(
          Story.given(order, drafted),
          Story.when(order, command(required("approved", "600.00"))),
          Story.then(order, confirmedBy("k-1")),
        ),
      )

      // [PRC-REL-1]
      it.effect("refuses an approval for less or for more than the total", () =>
        story(
          Story.given(order, drafted),
          Story.when(order, command(required("approved", "599.99"))),
          Story.rejected(new PurchaseOrderApprovalRequired({ status: "approved" })),
          Story.when(order, command(required("approved", "600.01"))),
          Story.rejected(new PurchaseOrderApprovalRequired({ status: "approved" })),
          Story.then(order),
          Story.state(order, { status: "draft" }),
        ),
      )

      // [PRC-REL-1]
      it.effect("refuses a request that is pending or rejected, or none, with its status", () =>
        story(
          Story.given(order, drafted),
          Story.when(order, command(required("pending", "600.00"))),
          Story.rejected(new PurchaseOrderApprovalRequired({ status: "pending" })),
          Story.when(order, command(required("rejected", "600.00"))),
          Story.rejected(new PurchaseOrderApprovalRequired({ status: "rejected" })),
          Story.when(order, command(noRequest)),
          Story.rejected(new PurchaseOrderApprovalRequired({ status: "missing" })),
          Story.then(order),
        ),
      )

      // [PRC-REL-1]
      it.effect("needs no approval where the policy does not require one", () =>
        story(
          Story.given(order, drafted),
          Story.when(order, command(unapproved)),
          Story.then(order, confirmedBy("k-1")),
        ),
      )
    })
  })
})

describe("procurement authorization on the production service", () => {
  const principal = { userAccountId: "buyer", sessionId: "buyer-session" }
  const tenantId = "00000000-0000-4000-8000-000000000001"
  const otherTenantId = "00000000-0000-4000-8000-000000000002"
  // No such row exists, so a call that passes authorization fails as not found or returns nothing.
  const missing = "00000000-0000-4000-8000-0000000000aa"

  type Capability = NonNullable<
    Parameters<typeof makeAuthorizationTestLayer>[0]
  >[number]["capability"]

  type Attempt = {
    readonly name: string
    readonly needs: ReadonlyArray<Capability>
    readonly call: (
      service: ProcurementService,
      tenantId: string,
    ) => Effect.Effect<unknown, unknown>
  }

  const attempts: ReadonlyArray<Attempt> = [
    {
      name: "creating a supplier account",
      needs: [
        ProcurementCapabilities.supplierAccountCreate,
        PartyCapabilities.partyRelationshipRead,
      ],
      call: (service, tenantId) =>
        service.createSupplierAccount({ principal, tenantId, supplierRelationshipId: missing }),
    },
    {
      name: "creating a purchase order",
      needs: [ProcurementCapabilities.purchaseOrderCreate],
      call: (service, tenantId) =>
        service.createPurchaseOrder({
          principal,
          tenantId,
          supplierAccountId: missing,
          lines: [{ itemId: missing, quantity: "1", unitPrice: "1.00" }],
        }),
    },
    {
      name: "reading a purchase order",
      needs: [ProcurementCapabilities.purchaseOrderRead],
      call: (service, tenantId) =>
        service.getPurchaseOrder({ principal, tenantId, purchaseOrderId: missing }),
    },
    {
      name: "listing purchase orders",
      needs: [ProcurementCapabilities.purchaseOrderRead],
      call: (service, tenantId) => service.listPurchaseOrders({ principal, tenantId }),
    },
    {
      name: "listing supplier accounts",
      needs: [ProcurementCapabilities.purchaseOrderRead],
      call: (service, tenantId) => service.listSupplierAccounts({ principal, tenantId }),
    },
    {
      name: "confirming a purchase order",
      needs: [ProcurementCapabilities.purchaseOrderConfirm],
      call: (service, tenantId) =>
        service.confirmPurchaseOrder({
          principal,
          tenantId,
          purchaseOrderId: missing,
          idempotencyKey: "k-1",
        }),
    },
    {
      name: "cancelling a purchase order",
      needs: [ProcurementCapabilities.purchaseOrderCancel],
      call: (service, tenantId) =>
        service.cancelPurchaseOrder({ principal, tenantId, purchaseOrderId: missing }),
    },
  ]

  const everything = [...new Set(attempts.flatMap((attempt) => attempt.needs))]

  const run = (
    grants: ReadonlyArray<{ readonly tenantId: string; readonly capability: Capability }>,
    program: (service: ProcurementService) => Effect.Effect<boolean, never>,
  ) => {
    const authorization = makeAuthorizationTestLayer(
      grants.map((grant) => ({ userAccountId: principal.userAccountId, ...grant })),
    )

    const party = makePartyTestLayer().pipe(Layer.provide(authorization))

    const procurement = makeProcurementTestLayer().pipe(
      Layer.provide(
        Layer.mergeAll(authorization, party, makeMessagingTestLayer(), makeNumberingTestLayer()),
      ),
    )

    return Effect.gen(function* () {
      return yield* program(yield* ProcurementService)
    }).pipe(Effect.provide(procurement))
  }

  const isDenied = (effect: Effect.Effect<unknown, unknown>) =>
    Effect.map(
      Effect.result(effect),
      (result) => Result.isFailure(result) && result.failure instanceof AuthorizationDenied,
    )

  for (const attempt of attempts) {
    // [PRC-AUTH-1]
    it.effect(`${attempt.name} is refused without each capability it needs`, () =>
      Effect.gen(function* () {
        const granted = everything.map((capability) => ({ tenantId, capability }))

        // With every grant the call passes authorization, so a refusal below is the missing grant.
        assert.isFalse(yield* run(granted, (service) => isDenied(attempt.call(service, tenantId))))

        for (const needed of attempt.needs) {
          assert.isTrue(
            yield* run(
              granted.filter((grant) => grant.capability !== needed),
              (service) => isDenied(attempt.call(service, tenantId)),
            ),
            `${needed} is not needed`,
          )
        }

        assert.isTrue(yield* run([], (service) => isDenied(attempt.call(service, tenantId))))
      }),
    )

    // [PRC-AUTH-1]
    it.effect(`${attempt.name} is refused in a tenant where the capability is not granted`, () =>
      run(
        everything.map((capability) => ({ tenantId, capability })),
        (service) => isDenied(attempt.call(service, otherTenantId)),
      ).pipe(Effect.map((denied) => assert.isTrue(denied))),
    )
  }
})

describe("supplier price on the domain model", () => {
  const price = SupplierPrice.ref(supplierPriceInstanceId(tenant, "sa-1", "p-1"))

  // [PRC-PRICE-1]
  it.effect("setting a price replaces the one price of a supplier account and product", () =>
    story(
      Story.when(price, new SetSupplierPrice({ unitPrice: "10.00" })),
      Story.then(price, new SupplierPriceSet({ unitPrice: "10.00", replaced: null })),
      Story.when(price, new SetSupplierPrice({ unitPrice: "12.50" })),
      Story.then(price, new SupplierPriceSet({ unitPrice: "12.50", replaced: "10.00" })),
      Story.state(price, { unitPrice: "12.50" }),
    ),
  )

  // [PRC-PRICE-1]
  it.effect("a price belongs to one supplier account, product, and tenant", () =>
    story(
      Story.given(price, new SupplierPriceSet({ unitPrice: "10.00", replaced: null })),
      Story.state(SupplierPrice.ref(supplierPriceInstanceId(tenant, "sa-1", "p-2")), {
        unitPrice: null,
      }),
      Story.state(SupplierPrice.ref(supplierPriceInstanceId(tenant, "sa-2", "p-1")), {
        unitPrice: null,
      }),
      Story.state(SupplierPrice.ref(supplierPriceInstanceId("t-2", "sa-1", "p-1")), {
        unitPrice: null,
      }),
      Story.state(price, { unitPrice: "10.00" }),
    ),
  )
})

describe("purchase order document on the production function", () => {
  const ids = {
    id: "018f0000-0000-7000-8000-000000000010",
    tenantId: "018f0000-0000-7000-8000-000000000001",
    supplierAccountId: "018f0000-0000-7000-8000-000000000011",
  }

  const line = {
    id: "018f0000-0000-7000-8000-000000000012",
    itemId: "018f0000-0000-7000-8000-000000000013",
    quantity: "2",
    unitPrice: "12.50",
  }

  const confirmedAt = "2026-09-06T00:00:00.000Z"
  const input = { snapshotId: "018f0000-0000-7000-8000-000000000014", capturedAt: confirmedAt }

  const withStatus = (status: "draft" | "confirmed" | "cancelled") => ({
    ...ids,
    status,
    number: status === "draft" ? null : "PO/2026/00001",
    confirmedAt: status === "draft" ? null : confirmedAt,
    total: "25.00",
    lines: [line],
  })

  // [PRC-DOC-1]
  it.effect("renders only a confirmed purchase order", () =>
    Effect.gen(function* () {
      const snapshot = yield* makePurchaseOrderDocumentSnapshot(withStatus("confirmed"), input)

      assert.strictEqual(snapshot.source.id, ids.id)

      for (const status of ["draft", "cancelled"] as const) {
        const error = yield* Effect.flip(
          makePurchaseOrderDocumentSnapshot(withStatus(status), input),
        )

        assert.instanceOf(error, PurchaseOrderInvalidStateError)
        assert.strictEqual(error.status, status)
      }
    }),
  )

  // [PRC-DOC-1]
  it.effect("a document's checksum does not depend on when it was captured", () =>
    Effect.gen(function* () {
      const first = yield* makePurchaseOrderDocumentSnapshot(withStatus("confirmed"), input)

      const later = yield* makePurchaseOrderDocumentSnapshot(withStatus("confirmed"), {
        ...input,
        capturedAt: "2026-09-07T10:00:00.000Z",
      })

      assert.strictEqual(first.checksum, later.checksum)
    }),
  )
})
