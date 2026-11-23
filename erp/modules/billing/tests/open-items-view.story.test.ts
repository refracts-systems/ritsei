import { assert, describe, it } from "@effect/vitest"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import {
  BillingOpenItems,
  BillingOpenItemsHandlers,
  ControlBalanceAsOf,
  DocumentId,
  DocumentPosted,
  OpenItemDocument,
  OpenItemsAsOf,
  PostDocument,
  RecordSettlement,
  SettlementRecorded,
} from "../src/open-items-view-model.ts"

const { Story } = Domain

const story = Story.make(BillingOpenItems, { layer: BillingOpenItemsHandlers })

const doc = (id: string) => OpenItemDocument.ref(DocumentId.make(id))

const post = (invoiceDate: string, total: string) => new PostDocument({ invoiceDate, total })
const posted = (invoiceDate: string, total: string) => new DocumentPosted({ invoiceDate, total })

const settle = (sourceId: string, amount: string, settledOn: string) =>
  new RecordSettlement({ sourceId, amount, settledOn })

const settled = (sourceId: string, amount: string, settledOn: string) =>
  new SettlementRecorded({ sourceId, amount, settledOn })

// The open items at a date, and the control account at the same date, must be the same money.
const agree = (asOf: string, items: ReadonlyArray<readonly [string, string]>, control: string) => [
  Story.query(OpenItemsAsOf, { asOf }, (rows) =>
    assert.deepStrictEqual(
      rows.map((row) => [row.documentId, row.open]).toSorted(),
      items.map(([id, open]) => [id, open]).toSorted(),
    ),
  ),
  Story.query(ControlBalanceAsOf, { asOf }, (balance) => assert.strictEqual(balance, control)),
]

const ledger = [
  Story.when(doc("d-1"), post("2026-01-10", "100.00")),
  Story.then(doc("d-1"), posted("2026-01-10", "100.00")),
  Story.when(doc("d-2"), post("2026-02-05", "50.00")),
  Story.then(doc("d-2"), posted("2026-02-05", "50.00")),
  Story.when(doc("d-1"), settle("s-1", "40.00", "2026-02-01")),
  Story.then(doc("d-1"), settled("s-1", "40.00", "2026-02-01")),
  Story.when(doc("d-1"), settle("s-2", "30.00", "2026-03-01")),
  Story.then(doc("d-1"), settled("s-2", "30.00", "2026-03-01")),
] as const

describe("open items against the control account, as of a date (BIL-OPEN-1)", () => {
  it("the model is well defined", () => assert.deepStrictEqual(Domain.verify(BillingOpenItems), []))

  // [BIL-OPEN-1]
  it.effect("nothing is open and the control account is empty before the first document", () =>
    story(...ledger, ...agree("2026-01-01", [], "0.00")),
  )

  // [BIL-OPEN-1]
  it.effect(
    "a document dated after the date is not open then, and not in the control account",
    () => story(...ledger, ...agree("2026-01-31", [["d-1", "100.00"]], "100.00")),
  )

  // [BIL-OPEN-1]
  it.effect("a settlement counts from its own date, not from the date it was recorded", () =>
    story(
      ...ledger,
      ...agree(
        "2026-02-15",
        [
          ["d-1", "60.00"],
          ["d-2", "50.00"],
        ],
        "110.00",
      ),
      ...agree(
        "2026-03-15",
        [
          ["d-1", "30.00"],
          ["d-2", "50.00"],
        ],
        "80.00",
      ),
    ),
  )

  // [BIL-OPEN-1]
  it.effect("a document and a settlement count on their own date, in both views", () =>
    story(
      ...ledger,
      ...agree("2026-01-10", [["d-1", "100.00"]], "100.00"),
      ...agree("2026-02-01", [["d-1", "60.00"]], "60.00"),
      ...agree(
        "2026-02-05",
        [
          ["d-1", "60.00"],
          ["d-2", "50.00"],
        ],
        "110.00",
      ),
    ),
  )

  // [BIL-OPEN-1]
  it.effect("a document with nothing open leaves the report and the account still agrees", () =>
    story(
      ...ledger,
      Story.when(doc("d-2"), settle("s-3", "50.00", "2026-02-10")),
      Story.then(doc("d-2"), settled("s-3", "50.00", "2026-02-10")),
      ...agree("2026-02-15", [["d-1", "60.00"]], "60.00"),
      // Before the settlement date the document is open again.
      ...agree(
        "2026-02-07",
        [
          ["d-1", "60.00"],
          ["d-2", "50.00"],
        ],
        "110.00",
      ),
    ),
  )

  // [BIL-OPEN-1]
  it.effect("a repeated settlement source counts once in both views", () =>
    story(
      ...ledger,
      Story.when(doc("d-1"), settle("s-1", "40.00", "2026-02-01")),
      Story.then(doc("d-1")),
      ...agree(
        "2026-02-15",
        [
          ["d-1", "60.00"],
          ["d-2", "50.00"],
        ],
        "110.00",
      ),
    ),
  )
})
