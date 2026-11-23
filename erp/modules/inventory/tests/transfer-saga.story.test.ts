import { assert, describe, it } from "@effect/vitest"
import * as Data from "effect/Data"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import {
  CompleteTransferRequest,
  CompletionRequested,
  AttemptFinished,
  attemptId,
  ConfirmAttempt,
  ConfirmationRefused,
  ConfirmationRequested,
  ConfirmTransfer,
  ConfirmTransferRequest,
  DeductForTransfer,
  DeductionRestored,
  InventoryTransfers,
  InventoryTransfersHandlers,
  PositionId,
  PositionSeeded,
  ReceiveForTransfer,
  ReceiveTransfer,
  RestoreDeduction,
  StagedTransfer,
  StockUnavailable,
  TransferCompleted,
  TransferConfirmed,
  TransferCreated,
  TransferDeducted,
  TransferId,
  TransferInvalidState,
  TransferNotFound,
  TransferPosition,
  TransferReceived,
} from "../src/transfer-saga-model.ts"

const { Story } = Domain

type Outcome = Data.TaggedEnum<{
  Completed: { readonly result: undefined }
  Rejected: { readonly rejection: StockUnavailable }
}>

const Outcome = Data.taggedEnum<Outcome>()

const story = Story.make(InventoryTransfers, { layer: InventoryTransfersHandlers })

const transfer = StagedTransfer.ref(TransferId.make("t-1"))

const position = (warehouse: string, item: string) =>
  TransferPosition.ref(PositionId.make(`${warehouse}/${item}`))

const widget = "00000000-0000-4000-8000-0000000000a1"
const cable = "00000000-0000-4000-8000-0000000000a2"

const route = {
  sourceWarehouseId: "w-1",
  destinationWarehouseId: "w-2",
  lines: [
    { itemId: widget, quantity: "4" },
    { itemId: cable, quantity: "3" },
  ],
}

const attempt = (n: number) => ConfirmAttempt.ref(attemptId("t-1", n))

const created = new TransferCreated(route)
const requested = new ConfirmationRequested({ ...route, attempt: 1 })
const retried = new ConfirmationRequested({ ...route, attempt: 2 })
const confirmed = new TransferConfirmed()
const completionRequested = new CompletionRequested(route)
const completed = Outcome.Completed({ result: undefined })

const seeded = (onHand: string, reserved = "0") => new PositionSeeded({ onHand, reserved })

const deducted = (quantity: string, onHandAfter: string) =>
  new TransferDeducted({ transferId: "t-1", quantity, onHandAfter })

const received = (quantity: string) =>
  new TransferReceived({ transferId: "t-1", quantity, onHandAfter: quantity })

describe("stock transfers staged as sagas (INV-XFER-1)", () => {
  it("the model is well defined", () =>
    assert.deepStrictEqual(Domain.verify(InventoryTransfers), []))

  // [INV-XFER-1]
  it.effect("confirming deducts every source line and then confirms the transfer", () =>
    story(
      Story.given(transfer, created),
      Story.given(position("w-1", widget), seeded("10")),
      Story.given(position("w-1", cable), seeded("8")),
      Story.when(transfer, new ConfirmTransferRequest({})),
      Story.then(transfer, requested, confirmed),
      Story.then(position("w-1", widget), deducted("4", "6")),
      Story.then(position("w-1", cable), deducted("3", "5")),
      Story.then(attempt(1), new AttemptFinished()),
      Story.saga(ConfirmTransfer, attempt(1), completed),
    ),
  )

  // [INV-XFER-1]
  it.effect(
    "a line that is not available restores the deductions and keeps the transfer a draft",
    () =>
      story(
        Story.given(transfer, created),
        Story.given(position("w-1", widget), seeded("10")),
        // 8 on hand, 6 reserved: 2 are available and 3 are asked.
        Story.given(position("w-1", cable), seeded("8", "6")),
        Story.when(transfer, new ConfirmTransferRequest({})),
        // The widget line was deducted and restored; the transfer refused and is a draft again.
        Story.then(transfer, requested, new ConfirmationRefused()),
        Story.then(
          position("w-1", widget),
          deducted("4", "6"),
          new DeductionRestored({ transferId: "t-1", quantity: "4", onHandAfter: "10" }),
        ),
        Story.then(position("w-1", cable)),
        Story.saga(
          ConfirmTransfer,
          attempt(1),
          Outcome.Rejected({ rejection: new StockUnavailable({ itemId: cable }) }),
        ),
        // A draft can be confirmed again: the retry is its own attempt and runs its own saga.
        Story.when(transfer, new ConfirmTransferRequest({})),
        Story.then(transfer, retried, new ConfirmationRefused()),
        Story.then(
          position("w-1", widget),
          deducted("4", "6"),
          new DeductionRestored({ transferId: "t-1", quantity: "4", onHandAfter: "10" }),
        ),
        Story.saga(
          ConfirmTransfer,
          attempt(2),
          Outcome.Rejected({ rejection: new StockUnavailable({ itemId: cable }) }),
        ),
      ),
  )

  // [INV-XFER-1]
  it.effect("a line is available up to on hand less reserved, and not one unit more", () =>
    story(
      Story.given(transfer, created),
      // 10 on hand, 6 reserved: exactly the 4 asked are available.
      Story.given(position("w-1", widget), seeded("10", "6")),
      Story.given(position("w-1", cable), seeded("3")),
      Story.when(transfer, new ConfirmTransferRequest({})),
      Story.then(transfer, requested, confirmed),
      Story.then(position("w-1", widget), deducted("4", "6")),
      Story.then(position("w-1", cable), deducted("3", "0")),
      Story.then(attempt(1), new AttemptFinished()),
    ),
  )

  // [INV-XFER-1]
  it.effect("completing adds every destination line and then completes the transfer", () =>
    story(
      Story.given(transfer, created, requested, confirmed),
      Story.when(transfer, new CompleteTransferRequest({})),
      Story.then(transfer, completionRequested, new TransferCompleted()),
      Story.then(position("w-2", widget), received("4")),
      Story.then(position("w-2", cable), received("3")),
      Story.saga(ReceiveTransfer, transfer, completed),
    ),
  )

  // [INV-XFER-1]
  it.effect("only a confirmed transfer completes, and only a draft confirms", () =>
    story(
      Story.when(transfer, new ConfirmTransferRequest({})),
      Story.rejected(new TransferNotFound()),
      Story.given(transfer, created),
      Story.when(transfer, new CompleteTransferRequest({})),
      Story.rejected(new TransferInvalidState({ status: "draft" })),
      Story.then(transfer),
    ),
  )

  // [INV-XFER-1]
  it.effect("repeating a confirmation or a completion records nothing", () =>
    story(
      Story.given(transfer, created, requested, confirmed),
      Story.when(transfer, new ConfirmTransferRequest({})),
      Story.then(transfer),
      Story.given(transfer, completionRequested, new TransferCompleted()),
      Story.when(transfer, new CompleteTransferRequest({})),
      Story.then(transfer),
    ),
  )

  // [INV-XFER-1]
  it.effect("a deduction, its restoration and a receipt apply once per transfer", () =>
    story(
      Story.given(position("w-1", widget), seeded("10"), deducted("4", "6")),
      Story.when(
        position("w-1", widget),
        new DeductForTransfer({ transferId: "t-1", itemId: widget, quantity: "4" }),
      ),
      Story.then(position("w-1", widget)),
      Story.when(position("w-1", widget), new RestoreDeduction({ transferId: "t-9" })),
      Story.then(position("w-1", widget)),
      Story.given(position("w-2", widget), received("4")),
      Story.when(
        position("w-2", widget),
        new ReceiveForTransfer({ transferId: "t-1", quantity: "4" }),
      ),
      Story.then(position("w-2", widget)),
    ),
  )
})
