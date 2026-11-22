import { assert, describe, it } from "@effect/vitest"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import {
  ApplySettlement,
  Billing,
  BillExceedsReceipt,
  BillingDocument,
  BillingDocumentNotFound,
  CompleteRender,
  InvoiceRender,
  PostSupplierBill,
  RecordRenderInput,
  RenderArtifactExists,
  RenderArtifactStored,
  RenderInputConflict,
  RenderInputMissing,
  RenderInputRecorded,
  SettlementApplied,
  SettlementConflict,
  SettlementExceedsOpenAmount,
  SupplierBillPosted,
} from "../src/domain-model.ts"
import { decideSettlement, SettlementDecision } from "../src/settlement-decision.ts"

const { Story } = Domain

const story = Story.make(Billing)

const lineA = "01900000-0000-7000-8000-00000000000a"
const productA = "01900000-0000-7000-8000-0000000000a1"
const doc = BillingDocument.ref("inv-1")
const render = InvoiceRender.ref("inv-1")

const posted = (total: string) =>
  new SupplierBillPosted({ total, matchedValue: total, excessValue: "0.00" })

const source = (id: string) => ({ type: "billing.customer_credit_note", id })

const settle = (amount: string, id: string) =>
  new ApplySettlement({ amount, source: source(id), settledOn: "2026-11-01" })

const openAmountOf = (state: typeof BillingDocument.definition.state.Type) =>
  Predicate.isTagged(state, "Posted") ? state.openAmount : undefined

const settled = (amount: string, id: string, openAfter: string) =>
  new SettlementApplied({ amount, source: source(id), settledOn: "2026-11-01", openAfter })

describe("Billing on Alchemy", () => {
  it("the model is well defined", () => assert.deepStrictEqual(Domain.verify(Billing), []))

  // [BIL-SET-1]
  it.effect("settles up to the open amount and lowers it each time", () =>
    story(
      Story.given(doc, posted("100.00")),
      Story.when(doc, settle("40.00", "s-1")),
      Story.then(doc, settled("40.00", "s-1", "60.00")),
      Story.when(doc, settle("60.00", "s-2")),
      Story.then(doc, settled("60.00", "s-2", "0.00")),
      Story.state(doc, (state) => assert.strictEqual(openAmountOf(state), "0.00")),
    ),
  )

  // [BIL-SET-1]
  it.effect("refuses a settlement above the open amount and changes nothing", () =>
    story(
      Story.given(doc, posted("100.00"), settled("40.00", "s-1", "60.00")),
      Story.when(doc, settle("60.01", "s-2")),
      Story.rejected(new SettlementExceedsOpenAmount({ openAmount: "60.00", requested: "60.01" })),
      Story.then(doc),
      Story.when(doc, settle("60.00", "s-2")),
      Story.then(doc, settled("60.00", "s-2", "0.00")),
      Story.when(doc, settle("0.01", "s-3")),
      Story.rejected(new SettlementExceedsOpenAmount({ openAmount: "0.00", requested: "0.01" })),
      Story.then(doc),
    ),
  )

  // [BIL-SET-1]
  it.effect(
    "applies a source once: the same amount again is a no-op, another amount conflicts",
    () =>
      story(
        Story.given(doc, posted("100.00"), settled("40.00", "s-1", "60.00")),
        Story.when(doc, settle("40.00", "s-1")),
        Story.then(doc),
        Story.when(doc, settle("41.00", "s-1")),
        Story.rejected(new SettlementConflict({ sourceId: "s-1" })),
        Story.then(doc),
      ),
  )

  // [BIL-SET-1]
  it.effect("keeps a replay a no-op after the document is fully settled", () =>
    story(
      Story.given(doc, posted("100.00"), settled("100.00", "s-1", "0.00")),
      Story.when(doc, settle("100.00", "s-1")),
      Story.then(doc),
      Story.when(doc, settle("100.01", "s-1")),
      Story.rejected(new SettlementConflict({ sourceId: "s-1" })),
    ),
  )

  // [BIL-SET-1]
  it.effect("settles only a posted document", () =>
    story(Story.when(doc, settle("1.00", "s-1")), Story.rejected(new BillingDocumentNotFound())),
  )

  // [BIL-SET-1]
  it.prop(
    "never takes more than the open amount, for any open amount, amount and prior settlement",
    {
      open: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000 })),
      amount: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000 })),
      prior: Schema.UndefinedOr(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000 }))),
    },
    ({ open, amount, prior }) => {
      const decision = decideSettlement({
        open: BigInt(open),
        amount: BigInt(amount),
        prior: prior === undefined ? undefined : BigInt(prior),
      })

      if (prior !== undefined) {
        assert.strictEqual(decision._tag, prior === amount ? "Replay" : "Conflict")

        return
      }

      assert.strictEqual(decision._tag, amount > open ? "ExceedsOpenAmount" : "Apply")

      if (SettlementDecision.$is("Apply")(decision)) {
        assert.strictEqual(decision.openAfter, BigInt(open - amount))
        assert.isTrue(decision.openAfter >= 0n)
      }
    },
  )

  const orderLine = (received: string, returned = "0") => ({
    purchaseOrderLineId: lineA,
    productId: productA,
    ordered: "20",
    received,
    returned,
    unitPrice: "4.00",
    taxCodeId: null,
  })

  const bill = (
    quantity: string,
    unitPrice: string,
    options: {
      readonly received?: string
      readonly billed?: string
      readonly approval?: { status: "pending" | "approved" | "rejected"; amount: string } | null
    } = {},
  ) =>
    new PostSupplierBill({
      total: "999.00",
      lines: [{ purchaseOrderLineId: lineA, quantity, unitPrice }],
      orderLines: [orderLine(options.received ?? "10")],
      billed: { [lineA]: options.billed ?? "0" },
      credited: {},
      approval: options.approval ?? null,
    })

  // [BIL-BILL-2]
  it.effect("posts a bill within receipt with no approval and no excess", () =>
    story(
      Story.when(doc, bill("10", "5.00")),
      Story.then(
        doc,
        new SupplierBillPosted({ total: "999.00", matchedValue: "40.00", excessValue: "0.00" }),
      ),
    ),
  )

  // [BIL-BILL-2]
  it.effect("refuses a bill beyond receipt without an approved variance", () =>
    story(
      Story.when(doc, bill("12", "5.00")),
      Story.rejected(
        new BillExceedsReceipt({ purchaseOrderLineId: lineA, billable: "10", requested: "12" }),
      ),
      Story.then(doc),
      Story.when(doc, bill("12", "5.00", { approval: { status: "pending", amount: "10.00" } })),
      Story.rejected(
        new BillExceedsReceipt({ purchaseOrderLineId: lineA, billable: "10", requested: "12" }),
      ),
      Story.when(doc, bill("12", "5.00", { approval: { status: "rejected", amount: "10.00" } })),
      Story.rejected(
        new BillExceedsReceipt({ purchaseOrderLineId: lineA, billable: "10", requested: "12" }),
      ),
      Story.then(doc),
    ),
  )

  // [BIL-BILL-2]
  it.effect("values the excess at the bill's price: 2 units at 5.00 need 10.00, not 8.00", () =>
    story(
      Story.when(doc, bill("12", "5.00", { approval: { status: "approved", amount: "9.99" } })),
      Story.rejected(
        new BillExceedsReceipt({ purchaseOrderLineId: lineA, billable: "10", requested: "12" }),
      ),
      Story.when(doc, bill("12", "5.00", { approval: { status: "approved", amount: "10.00" } })),
      Story.then(
        doc,
        // The matched 10 units clear at the purchase price 4.00; the excess is valued at 5.00.
        new SupplierBillPosted({ total: "999.00", matchedValue: "40.00", excessValue: "10.00" }),
      ),
    ),
  )

  // [BIL-BILL-2]
  it.effect("counts earlier bills against receipt, so a second bill is excess", () =>
    story(
      Story.when(doc, bill("5", "4.00", { billed: "8", received: "10" })),
      Story.rejected(
        new BillExceedsReceipt({ purchaseOrderLineId: lineA, billable: "2", requested: "5" }),
      ),
      Story.when(
        doc,
        bill("5", "4.00", {
          billed: "8",
          received: "10",
          approval: { status: "approved", amount: "12.00" },
        }),
      ),
      Story.then(
        doc,
        new SupplierBillPosted({ total: "999.00", matchedValue: "8.00", excessValue: "12.00" }),
      ),
    ),
  )

  // A repeated bill id returns the posted bill (BIL-DOC-1; stated here so the model matches production).
  it.effect("posts a bill id once: repeating it returns the posted bill", () =>
    story(Story.given(doc, posted("50.00")), Story.when(doc, bill("12", "5.00")), Story.then(doc)),
  )

  // BIL-RENDER-2 is PostgreSQL's (constraints); this states what the tables do for one invoice. The
  // identifier is not bracketed for BIL-RENDER-1: RULES.md marks it unenforced and the modules test
  // fails a test that names an unenforced rule.
  // [BIL-RENDER-2]
  it.effect("issues one artifact per invoice, bound to the staged input", () =>
    story(
      Story.when(
        render,
        new CompleteRender({ artifactId: "a-1", contentHash: "h-1", pageCount: 1 }),
      ),
      Story.rejected(new RenderInputMissing()),
      Story.when(
        render,
        new RecordRenderInput({ snapshotId: "s-1", astId: "ast-1", renderFingerprint: "f-1" }),
      ),
      Story.then(
        render,
        new RenderInputRecorded({ snapshotId: "s-1", astId: "ast-1", renderFingerprint: "f-1" }),
      ),
      Story.when(
        render,
        new CompleteRender({ artifactId: "a-1", contentHash: "h-1", pageCount: 2 }),
      ),
      Story.then(
        render,
        new RenderArtifactStored({
          artifactId: "a-1",
          snapshotId: "s-1",
          astId: "ast-1",
          renderFingerprint: "f-1",
          contentHash: "h-1",
          pageCount: 2,
        }),
      ),
      Story.when(
        render,
        new CompleteRender({ artifactId: "a-2", contentHash: "h-2", pageCount: 2 }),
      ),
      Story.rejected(new RenderArtifactExists()),
      Story.then(render),
    ),
  )

  // [BIL-RENDER-2]
  it.effect("keeps the staged input immutable: the same input repeats, another conflicts", () =>
    story(
      Story.given(
        render,
        new RenderInputRecorded({ snapshotId: "s-1", astId: "ast-1", renderFingerprint: "f-1" }),
      ),
      Story.when(
        render,
        new RecordRenderInput({ snapshotId: "s-1", astId: "ast-1", renderFingerprint: "f-1" }),
      ),
      Story.then(render),
      Story.when(
        render,
        new RecordRenderInput({ snapshotId: "s-1", astId: "ast-1", renderFingerprint: "f-2" }),
      ),
      Story.rejected(new RenderInputConflict()),
      Story.then(render),
    ),
  )

  // Evaluation only: rendering is a separate lifecycle and never touches the invoice. What the
  // model cannot state is that no production runtime composes the worker or sends mail.
  it.effect("an evaluation render leaves the document it renders untouched", () =>
    story(
      Story.given(doc, posted("100.00")),
      Story.given(
        render,
        new RenderInputRecorded({ snapshotId: "s-1", astId: "ast-1", renderFingerprint: "f-1" }),
      ),
      Story.when(
        render,
        new CompleteRender({ artifactId: "a-1", contentHash: "h-1", pageCount: 1 }),
      ),
      Story.then(
        render,
        new RenderArtifactStored({
          artifactId: "a-1",
          snapshotId: "s-1",
          astId: "ast-1",
          renderFingerprint: "f-1",
          contentHash: "h-1",
          pageCount: 1,
        }),
      ),
      Story.then(doc),
      Story.state(doc, (state) => assert.strictEqual(openAmountOf(state), "100.00")),
    ),
  )
})
