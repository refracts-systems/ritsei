import { assert, describe, it } from "@effect/vitest"

import type { SalesOrderStatus } from "../src/contract.ts"
import {
  CancellationDecision,
  ConfirmationDecision,
  decideCancellation,
  decideConfirmation,
} from "../src/order-lifecycle.ts"

const statuses: ReadonlyArray<SalesOrderStatus> = ["draft", "confirmed", "cancelled"]

describe("order lifecycle decisions", () => {
  // [SAL-ORDER-1]
  it("allows only draft to confirm and only confirmed to cancel; terminal orders never reopen", () => {
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

    assert.deepStrictEqual(
      decideConfirmation({ status: "cancelled", confirmationIdempotencyKey: "key" }, "key"),
      ConfirmationDecision.InvalidState({ status: "cancelled" }),
    )

    assert.deepStrictEqual(
      decideCancellation("draft"),
      CancellationDecision.InvalidState({ status: "draft" }),
    )
  })

  // [SAL-ORDER-2]
  it("returns the existing confirmation for the same key and conflicts for another", () => {
    const confirmed = { status: "confirmed", confirmationIdempotencyKey: "key-1" } as const

    assert.deepStrictEqual(decideConfirmation(confirmed, "key-1"), ConfirmationDecision.Existing())

    assert.deepStrictEqual(
      decideConfirmation(confirmed, "key-2"),
      ConfirmationDecision.IdempotencyConflict(),
    )
  })

  // [SAL-ORDER-1]
  it("treats cancelling a cancelled order as a no-op", () => {
    assert.deepStrictEqual(decideCancellation("cancelled"), CancellationDecision.AlreadyCancelled())
  })
})
