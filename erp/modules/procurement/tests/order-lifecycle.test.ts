import { assert, describe, it } from "@effect/vitest"
import * as Schema from "effect/Schema"

import type { PurchaseOrderStatus } from "../src/contract.ts"
import {
  CancellationDecision,
  ConfirmationDecision,
  decideCancellation,
  decideConfirmation,
} from "../src/order-lifecycle.ts"

const statuses: ReadonlyArray<PurchaseOrderStatus> = ["draft", "confirmed", "cancelled"]
const rank = { draft: 0, confirmed: 1, cancelled: 2 } as const

describe("purchase order lifecycle decisions", () => {
  // [PRC-PO-1]
  it("allows only a draft to confirm and only a confirmed order to cancel", () => {
    const confirmable = statuses.filter((status) =>
      ConfirmationDecision.$is("Confirm")(
        decideConfirmation({ status, confirmationIdempotencyKey: null }, "key"),
      ),
    )

    const cancellable = statuses.filter((status) =>
      CancellationDecision.$is("Cancel")(decideCancellation(status)),
    )

    assert.deepStrictEqual(confirmable, ["draft"])
    assert.deepStrictEqual(cancellable, ["confirmed"])
  })

  // [PRC-PO-3]
  it("returns a confirmed order for its own key and refuses any other key", () => {
    const confirmed = { status: "confirmed", confirmationIdempotencyKey: "first" } as const

    assert.isTrue(ConfirmationDecision.$is("Existing")(decideConfirmation(confirmed, "first")))

    assert.isTrue(
      ConfirmationDecision.$is("IdempotencyConflict")(decideConfirmation(confirmed, "second")),
    )

    // A confirmed order with no recorded key matches no key.
    assert.isTrue(
      ConfirmationDecision.$is("IdempotencyConflict")(
        decideConfirmation({ status: "confirmed", confirmationIdempotencyKey: null }, "first"),
      ),
    )
  })

  // [PRC-PO-1]
  it("never reopens a cancelled order, whatever key is offered", () => {
    for (const key of ["first", "", "other"]) {
      assert.deepStrictEqual(
        decideConfirmation({ status: "cancelled", confirmationIdempotencyKey: "first" }, key),
        ConfirmationDecision.InvalidState({ status: "cancelled" }),
      )
    }
  })

  // [PRC-PO-1]
  it("treats cancelling a cancelled order as a no-op and cancelling a draft as invalid", () => {
    assert.isTrue(CancellationDecision.$is("AlreadyCancelled")(decideCancellation("cancelled")))

    assert.deepStrictEqual(
      decideCancellation("draft"),
      CancellationDecision.InvalidState({ status: "draft" }),
    )
  })

  // [PRC-PO-1] [PRC-PO-3]
  it.prop(
    "in any command sequence the status only moves forward and the first key wins",
    {
      commands: Schema.Array(Schema.Literals(["confirm-a", "confirm-b", "cancel"])).check(
        Schema.isMinLength(1),
        Schema.isMaxLength(25),
      ),
    },
    ({ commands }) => {
      let status: PurchaseOrderStatus = "draft"
      let key: string | null = null
      let firstKey: string | null = null

      for (const command of commands) {
        const before = status

        if (command === "cancel") {
          if (CancellationDecision.$is("Cancel")(decideCancellation(status))) status = "cancelled"
        } else {
          const offered = command === "confirm-a" ? "a" : "b"
          const decision = decideConfirmation({ status, confirmationIdempotencyKey: key }, offered)

          if (ConfirmationDecision.$is("Confirm")(decision)) {
            status = "confirmed"
            key = offered
            firstKey ??= offered
          }
        }

        assert.isTrue(rank[status] >= rank[before], `${before} became ${status}`)
        assert.strictEqual(key, firstKey)
      }

      // A cancelled order stays cancelled and keeps the key it was confirmed with.
      if (status === "cancelled") {
        assert.isTrue(
          ConfirmationDecision.$is("InvalidState")(
            decideConfirmation({ status, confirmationIdempotencyKey: key }, "a"),
          ),
        )
      }
    },
  )
})
