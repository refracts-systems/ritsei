import { assert, describe, it } from "@effect/vitest"
import * as Data from "effect/Data"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import {
  CancelPurchaseOrder,
  ConfirmPurchaseOrder,
  DraftPurchaseOrder,
  PurchaseOrder,
  PurchaseOrderCancelled,
  PurchaseOrderConfirmed,
  PurchaseOrderDrafted,
  PurchaseOrderHasReceipts,
  purchaseOrderInstanceId,
} from "../src/domain-model.ts"
import {
  ApplyReceipt,
  ClosePeriod,
  CloseReceiving,
  DeactivateStockItem,
  GrniJournalPosted,
  OrderReceiving,
  PeriodClosed,
  PeriodId,
  PeriodWasClosed,
  ProcurementReceiving,
  ProcurementReceivingHandlers,
  ReceiptApplied,
  ReceiptId,
  ReceiptLedger,
  ReceiptParked,
  ReceiptQuantityExceeded,
  ReceiptRecorded,
  ReceiptStatus,
  ReceiptStock,
  ReceivingClosed,
  ReceivingNotOpen,
  ReceivingOpened,
  ReceivingPrepared,
  OpenReceiving,
  RecordReceipt,
  StockId,
  StockItemDeactivated,
  StockItemInactive,
  StockReceived,
} from "../src/receipt-staging-model.ts"

const { Story } = Domain

type Outcome = Data.TaggedEnum<{
  Completed: { readonly result: undefined }
  Rejected: { readonly rejection: StockItemInactive | PeriodClosed }
}>

const Outcome = Data.taggedEnum<Outcome>()

const story = Story.make(ProcurementReceiving, { layer: ProcurementReceivingHandlers })

const tenant = "t-1"
const orderId = purchaseOrderInstanceId(tenant, "po-1")
const order = PurchaseOrder.ref(orderId)
const receiving = OrderReceiving.ref(orderId)
const status = (receiptId: string) => ReceiptStatus.ref(ReceiptId.make(receiptId))
const stock = (item: string) => ReceiptStock.ref(StockId.make(`w-1/${item}`))
const period = "2026-12"
const ledger = ReceiptLedger.ref(PeriodId.make(period))

const itemA = "00000000-0000-4000-8000-0000000000a1"
const itemB = "00000000-0000-4000-8000-0000000000a2"

// The order: 100 of A at 6.00 and 50 of B at 2.50.
const ordered = [
  { itemId: itemA, quantity: "100", unitPrice: "6.00" },
  { itemId: itemB, quantity: "50", unitPrice: "2.50" },
]

const drafted = new PurchaseOrderDrafted({
  supplierAccountId: "sa-1",
  lines: ordered,
  total: "725.00",
})

const at = "2026-01-01T00:00:00.000Z"

const confirmed = new PurchaseOrderConfirmed({ idempotencyKey: "k-1", confirmedAt: at })

const confirm = new ConfirmPurchaseOrder({
  idempotencyKey: "k-1",
  approvalRequired: false,
  approval: null,
})

const prepared = new ReceivingPrepared({ lines: ordered })
const opened = new ReceivingOpened()

const receive = (receiptId: string, items: ReadonlyArray<readonly [string, string]>) =>
  new RecordReceipt({
    receiptId,
    warehouseId: "w-1",
    period,
    lines: items.map(([itemId, quantity]) => ({ itemId, quantity })),
  })

const recorded = (receiptId: string, items: ReadonlyArray<readonly [string, string]>) =>
  new ReceiptRecorded({
    receiptId,
    warehouseId: "w-1",
    period,
    lines: items.map(([itemId, quantity]) => ({
      itemId,
      quantity,
      unitPrice: itemId === itemA ? "6.00" : "2.50",
    })),
  })

const grni = (receiptId: string, amountMinor: string) =>
  new GrniJournalPosted({ reference: `receipt:${receiptId}`, amountMinor })

const stockIn = (receiptId: string, quantity: string) => new StockReceived({ receiptId, quantity })
const applied = new ReceiptApplied()
const parked = new ReceiptParked({ reason: "a later step was refused" })
const completed = Outcome.Completed({ result: undefined })

// An open order: drafted, confirmed, and its receiving opened.
const openOrder = [
  Story.given(order, drafted, confirmed),
  Story.given(receiving, prepared, opened),
] as const

describe("receiving staged as a saga (PRC-RCPT-1, PRC-VRCPT-1)", () => {
  it("the model is well defined", () =>
    assert.deepStrictEqual(Domain.verify(ProcurementReceiving), []))

  // [PRC-VRCPT-1]
  it.effect("a drafted and confirmed order opens its receiving", () =>
    story(
      Story.when(order, new DraftPurchaseOrder({ supplierAccountId: "sa-1", lines: ordered })),
      Story.then(order, drafted),
      Story.then(receiving, prepared),
      Story.when(order, confirm),
      Story.then(order, confirmed),
      Story.then(receiving, opened),
    ),
  )

  // [PRC-VRCPT-1]
  it.effect("a receipt records, receives the stock, and posts the journal at the order price", () =>
    story(
      ...openOrder,
      Story.when(
        receiving,
        receive("r-1", [
          [itemA, "40"],
          [itemB, "10"],
        ]),
      ),
      Story.then(
        receiving,
        recorded("r-1", [
          [itemA, "40"],
          [itemB, "10"],
        ]),
      ),
      Story.then(stock(itemA), stockIn("r-1", "40")),
      Story.then(stock(itemB), stockIn("r-1", "10")),
      // 40 x 6.00 + 10 x 2.50 = 265.00 in minor units.
      Story.then(ledger, grni("r-1", "26500")),
      Story.then(status("r-1"), applied),
      Story.saga(ApplyReceipt, status("r-1"), completed),
    ),
  )

  // [PRC-VRCPT-1]
  it.effect("receipts add up to the ordered quantity and no further", () =>
    story(
      ...openOrder,
      Story.given(receiving, recorded("r-1", [[itemA, "60"]])),
      Story.when(receiving, receive("r-2", [[itemA, "41"]])),
      Story.rejected(new ReceiptQuantityExceeded({ itemId: itemA })),
      Story.then(receiving),
      Story.when(receiving, receive("r-3", [[itemA, "40"]])),
      Story.then(receiving, recorded("r-3", [[itemA, "40"]])),
      Story.then(stock(itemA), stockIn("r-3", "40")),
      Story.then(ledger, grni("r-3", "24000")),
      Story.then(status("r-3"), applied),
      Story.when(receiving, receive("r-4", [[itemA, "1"]])),
      Story.rejected(new ReceiptQuantityExceeded({ itemId: itemA })),
    ),
  )

  // [PRC-VRCPT-1]
  it.effect("an item the order does not carry is refused", () =>
    story(
      ...openOrder,
      Story.when(receiving, receive("r-1", [["00000000-0000-4000-8000-0000000000ff", "1"]])),
      Story.rejected(
        new ReceiptQuantityExceeded({ itemId: "00000000-0000-4000-8000-0000000000ff" }),
      ),
      Story.then(receiving),
    ),
  )

  // [PRC-VRCPT-1]
  it.effect("a repeated receipt id records nothing, whatever lines it carries", () =>
    story(
      ...openOrder,
      Story.given(receiving, recorded("r-1", [[itemA, "40"]])),
      Story.when(receiving, receive("r-1", [[itemA, "40"]])),
      Story.then(receiving),
      // Production returns the recorded receipt for a repeated id; so does the model.
      Story.when(receiving, receive("r-1", [[itemA, "99"]])),
      Story.then(receiving),
    ),
  )

  // [PRC-RCPT-1]
  it.effect("a receipt before the receiving is open is refused: the lag state of the phase", () =>
    story(
      Story.given(order, drafted, confirmed),
      // The policy that opens the receiving has not run yet.
      Story.when(receiving, receive("r-1", [[itemA, "1"]])),
      Story.rejected(new ReceivingNotOpen()),
      Story.then(receiving),
    ),
  )

  // [PRC-RCPT-1]
  it.effect("an order with a receipt cannot be cancelled and keeps receiving", () =>
    story(
      ...openOrder,
      Story.given(receiving, recorded("r-1", [[itemA, "1"]])),
      // The cancel service closes the receiving first; the refusal ends the cancellation, so
      // `CancelPurchaseOrder` is never sent.
      Story.when(receiving, new CloseReceiving({})),
      Story.rejected(new PurchaseOrderHasReceipts()),
      Story.then(receiving),
      Story.when(receiving, receive("r-2", [[itemA, "1"]])),
      Story.then(receiving, recorded("r-2", [[itemA, "1"]])),
      Story.then(stock(itemA), stockIn("r-2", "1")),
      Story.then(ledger, grni("r-2", "600")),
      Story.then(status("r-2"), applied),
    ),
  )

  // [PRC-RCPT-1]
  it.effect("closing the receiving first makes a cancelled order impossible to receive", () =>
    story(
      ...openOrder,
      Story.when(receiving, new CloseReceiving({})),
      Story.then(receiving, new ReceivingClosed()),
      Story.when(order, new CancelPurchaseOrder({ hasReceipts: false })),
      Story.then(order, new PurchaseOrderCancelled()),
      // A receipt racing with the cancellation loses, whichever commit came first.
      Story.when(receiving, receive("r-1", [[itemA, "1"]])),
      Story.rejected(new ReceivingNotOpen()),
      // Closing again is a no-op.
      Story.when(receiving, new CloseReceiving({})),
      Story.then(receiving),
    ),
  )

  // [PRC-RCPT-1]
  it.effect("a receiving that is not open yet cannot be closed, so a draft is not stranded", () =>
    story(
      Story.given(receiving, prepared),
      Story.when(receiving, new CloseReceiving({})),
      Story.rejected(new ReceivingNotOpen()),
      Story.then(receiving),
      Story.when(receiving, new OpenReceiving({})),
      Story.then(receiving, opened),
    ),
  )

  // [PRC-VRCPT-1]
  it.effect("a closed period parks the receipt after its stock arrived: nothing is reversed", () =>
    story(
      ...openOrder,
      Story.given(ledger, new PeriodWasClosed()),
      Story.when(receiving, receive("r-1", [[itemA, "40"]])),
      Story.then(receiving, recorded("r-1", [[itemA, "40"]])),
      // The goods are in stock and the receipt stays recorded.
      Story.then(stock(itemA), stockIn("r-1", "40")),
      Story.then(ledger),
      Story.then(status("r-1"), parked),
      Story.saga(ApplyReceipt, status("r-1"), Outcome.Rejected({ rejection: new PeriodClosed() })),
    ),
  )

  // [PRC-VRCPT-1]
  it.effect("an inactive item parks the receipt before its journal and keeps earlier stock", () =>
    story(
      ...openOrder,
      Story.given(stock(itemB), new StockItemDeactivated()),
      Story.when(
        receiving,
        receive("r-1", [
          [itemA, "40"],
          [itemB, "10"],
        ]),
      ),
      Story.then(
        receiving,
        recorded("r-1", [
          [itemA, "40"],
          [itemB, "10"],
        ]),
      ),
      Story.then(stock(itemA), stockIn("r-1", "40")),
      Story.then(stock(itemB)),
      Story.then(ledger),
      Story.then(status("r-1"), parked),
      Story.saga(
        ApplyReceipt,
        status("r-1"),
        Outcome.Rejected({ rejection: new StockItemInactive({ itemId: itemB }) }),
      ),
    ),
  )

  // [PRC-VRCPT-1]
  it.effect("the stock and the journal of one receipt are applied once", () =>
    story(
      Story.given(stock(itemA), stockIn("r-1", "40")),
      Story.given(ledger, grni("r-1", "24000")),
      Story.when(stock(itemA), new DeactivateStockItem({})),
      Story.then(stock(itemA), new StockItemDeactivated()),
      Story.when(ledger, new ClosePeriod({})),
      Story.then(ledger, new PeriodWasClosed()),
    ),
  )
})
