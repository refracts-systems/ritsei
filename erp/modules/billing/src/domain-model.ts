/**
 * The Alchemy model of Billing's class A rules (ADR-0124, phase 1). It runs on the in-memory host
 * in stories only: production keeps its tables and never loads this file, so it is not exported
 * from `mod.ts`. Each `decide` calls the pure function the service calls (`matchBill`,
 * `firstUncoveredExcess`, `decideSettlement`), so the model and the service cannot disagree.
 */
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import {
  FinancialMajorAmount,
  formatSignedMinor,
  NonNegativeQuantity,
  PositiveQuantity,
  requireExactMajorToMinor,
  Uuid,
} from "../../../../framework/foundation/mod.ts"
import { ApprovalStatus } from "../../../../framework/modules/approvals/mod.ts"
import { MatchingLine } from "../../procurement/mod.ts"
import { firstUncoveredExcess, matchBill } from "./matching.ts"
import { decideSettlement, SettlementDecision } from "./settlement-decision.ts"

const minor = (value: string) => requireExactMajorToMinor(value, 2)
const major = (value: bigint) => formatSignedMinor(value, 2)

export const InvoiceId = Schema.String.pipe(Schema.brand("InvoiceId"))

// ---------------------------------------------------------------- BillingDocument

/** Billed more than was received without an approved variance covering it, or a line not on the order. */
export class BillExceedsReceipt extends Domain.Rejection("BillExceedsReceipt", {
  purchaseOrderLineId: Schema.String,
  billable: Schema.String,
  requested: Schema.String,
}) {}

export class BillingDocumentNotFound extends Domain.Rejection("BillingDocumentNotFound") {}

export class SettlementExceedsOpenAmount extends Domain.Rejection("SettlementExceedsOpenAmount", {
  openAmount: Schema.String,
  requested: Schema.String,
}) {}

/** The same source was applied before with a different amount. */
export class SettlementConflict extends Domain.Rejection("SettlementConflict", {
  sourceId: Schema.String,
}) {}

const BillLine = Schema.Struct({
  purchaseOrderLineId: Uuid,
  quantity: PositiveQuantity,
  unitPrice: FinancialMajorAmount,
})

const Quantities = Schema.Record(Schema.String, NonNegativeQuantity)

/** The variance approval request for this bill id, as Approvals reports it, or null. */
const VarianceApproval = Schema.NullOr(
  Schema.Struct({ status: ApprovalStatus, amount: FinancialMajorAmount }),
)

export class SupplierBillPosted extends Domain.Event("SupplierBillPosted", {
  total: FinancialMajorAmount,
  /** Received value the bill clears from goods received not invoiced, at the purchase price. */
  matchedValue: FinancialMajorAmount,
  /** Billed value beyond receipt, at the bill's price. */
  excessValue: FinancialMajorAmount,
}) {}

/**
 * The service passes what it read: the order's matching view, the billed and credited quantities,
 * the variance approval, and the total (tax comes from Tax and is not this aggregate's to know).
 */
export class PostSupplierBill extends Domain.Command("PostSupplierBill", {
  target: InvoiceId,
  input: {
    total: FinancialMajorAmount,
    lines: Schema.Array(BillLine),
    orderLines: Schema.Array(MatchingLine),
    billed: Quantities,
    credited: Quantities,
    approval: VarianceApproval,
  },
  events: [SupplierBillPosted],
  rejects: [BillExceedsReceipt],
}) {}

const Source = Schema.Struct({ type: Schema.String, id: Schema.String })

export class SettlementApplied extends Domain.Event("SettlementApplied", {
  source: Source,
  amount: FinancialMajorAmount,
  settledOn: Schema.String,
  openAfter: FinancialMajorAmount,
}) {}

export class ApplySettlement extends Domain.Command("ApplySettlement", {
  target: InvoiceId,
  input: { amount: FinancialMajorAmount, source: Source, settledOn: Schema.String },
  events: [SettlementApplied],
  rejects: [BillingDocumentNotFound, SettlementExceedsOpenAmount, SettlementConflict],
}) {}

const Unposted = Schema.TaggedStruct("Unposted", {})

const Posted = Schema.TaggedStruct("Posted", {
  openAmount: FinancialMajorAmount,
  /** Settled amount by source, so a replayed source is recognised. */
  settlements: Schema.Record(Schema.String, FinancialMajorAmount),
})

const DocumentState = Schema.Union([Unposted, Posted])

type DocumentState = typeof DocumentState.Type

const sourceKey = (source: typeof Source.Type) => `${source.type}/${source.id}`

export class BillingDocument extends Domain.Aggregate("BillingDocument", {
  id: InvoiceId,
  state: DocumentState,
  initial: Unposted.make({}),
  commands: [PostSupplierBill, ApplySettlement],
  decide: {
    PostSupplierBill: (document, cmd) => {
      // A repeated bill id returns the posted bill.
      if (Predicate.isTagged(document, "Posted")) return []

      const match = matchBill(
        cmd.lines,
        cmd.orderLines,
        new Map(Object.entries(cmd.billed).map(([id, quantity]) => [id, BigInt(quantity)])),
        new Map(Object.entries(cmd.credited).map(([id, quantity]) => [id, BigInt(quantity)])),
      )

      if ("unknownLineId" in match) {
        return new BillExceedsReceipt({
          purchaseOrderLineId: match.unknownLineId,
          billable: "0",
          requested: "0",
        })
      }

      const uncovered = firstUncoveredExcess(match, cmd.approval)

      if (uncovered !== undefined) {
        return new BillExceedsReceipt({
          purchaseOrderLineId: uncovered.lineId,
          billable: (uncovered.billable > 0n ? uncovered.billable : 0n).toString(),
          requested: uncovered.requested.toString(),
        })
      }

      return [
        new SupplierBillPosted({
          total: cmd.total,
          matchedValue: major(match.matched.reduce((sum, line) => sum + line.matchedValue, 0n)),
          excessValue: major(match.excessValue),
        }),
      ]
    },
    ApplySettlement: (document, cmd) => {
      if (!Predicate.isTagged(document, "Posted")) return new BillingDocumentNotFound()

      const prior = document.settlements[sourceKey(cmd.source)]

      const decision = decideSettlement({
        open: minor(document.openAmount),
        amount: minor(cmd.amount),
        prior: prior === undefined ? undefined : minor(prior),
      })

      return SettlementDecision.$match(decision, {
        Replay: () => [],
        Conflict: () => new SettlementConflict({ sourceId: cmd.source.id }),
        ExceedsOpenAmount: () =>
          new SettlementExceedsOpenAmount({
            openAmount: document.openAmount,
            requested: major(minor(cmd.amount)),
          }),
        Apply: ({ openAfter }) => [
          new SettlementApplied({
            source: cmd.source,
            amount: cmd.amount,
            settledOn: cmd.settledOn,
            openAfter: major(openAfter),
          }),
        ],
      })
    },
  },
  evolve: {
    SupplierBillPosted: (_, e): DocumentState =>
      Posted.make({ openAmount: e.total, settlements: {} }),
    SettlementApplied: (s, e): DocumentState =>
      Predicate.isTagged(s, "Posted")
        ? {
            ...s,
            openAmount: e.openAfter,
            settlements: { ...s.settlements, [sourceKey(e.source)]: e.amount },
          }
        : s,
  },
}) {}

// ---------------------------------------------------------------- InvoiceRender (staged)

/**
 * Invoice rendering is staged for evaluation (BIL-RENDER-1) and its integrity is PostgreSQL's
 * (BIL-RENDER-2: constraints and `ON CONFLICT DO NOTHING` on `invoice_render_inputs` and
 * `invoice_artifacts`). This aggregate states what those tables do for one invoice; it shares no
 * decision with production, which has none outside the database.
 */
export class RenderInputConflict extends Domain.Rejection("RenderInputConflict") {}

export class RenderInputMissing extends Domain.Rejection("RenderInputMissing") {}

export class RenderArtifactExists extends Domain.Rejection("RenderArtifactExists") {}

const RenderInput = {
  snapshotId: Schema.String,
  astId: Schema.String,
  renderFingerprint: Schema.String,
}

export class RenderInputRecorded extends Domain.Event("RenderInputRecorded", RenderInput) {}

export class RecordRenderInput extends Domain.Command("RecordRenderInput", {
  target: InvoiceId,
  input: RenderInput,
  events: [RenderInputRecorded],
  rejects: [RenderInputConflict],
}) {}

export class RenderArtifactStored extends Domain.Event("RenderArtifactStored", {
  artifactId: Schema.String,
  ...RenderInput,
  contentHash: Schema.String,
  pageCount: Schema.Int,
}) {}

export class CompleteRender extends Domain.Command("CompleteRender", {
  target: InvoiceId,
  input: { artifactId: Schema.String, contentHash: Schema.String, pageCount: Schema.Int },
  events: [RenderArtifactStored],
  rejects: [RenderInputMissing, RenderArtifactExists],
}) {}

const NoRender = Schema.TaggedStruct("NoRender", {})

const Staged = Schema.TaggedStruct("Staged", {
  ...RenderInput,
  /** The one artifact issued from the input, once there is one. */
  artifactId: Schema.NullOr(Schema.String),
})

const RenderState = Schema.Union([NoRender, Staged])

type RenderState = typeof RenderState.Type

export class InvoiceRender extends Domain.Aggregate("InvoiceRender", {
  id: InvoiceId,
  state: RenderState,
  initial: NoRender.make({}),
  commands: [RecordRenderInput, CompleteRender],
  decide: {
    RecordRenderInput: (render, cmd) => {
      if (!Predicate.isTagged(render, "Staged")) {
        return [
          new RenderInputRecorded({
            snapshotId: cmd.snapshotId,
            astId: cmd.astId,
            renderFingerprint: cmd.renderFingerprint,
          }),
        ]
      }

      // Staged input is immutable: the same identities repeat, different ones conflict.
      return render.snapshotId === cmd.snapshotId &&
        render.astId === cmd.astId &&
        render.renderFingerprint === cmd.renderFingerprint
        ? []
        : new RenderInputConflict()
    },
    CompleteRender: (render, cmd) => {
      if (!Predicate.isTagged(render, "Staged")) return new RenderInputMissing()

      if (render.artifactId !== null) return new RenderArtifactExists()

      // The artifact binds the staged input's identities; the command cannot choose them.
      return [
        new RenderArtifactStored({
          artifactId: cmd.artifactId,
          snapshotId: render.snapshotId,
          astId: render.astId,
          renderFingerprint: render.renderFingerprint,
          contentHash: cmd.contentHash,
          pageCount: cmd.pageCount,
        }),
      ]
    },
  },
  evolve: {
    RenderInputRecorded: (_, e): RenderState =>
      Staged.make({
        snapshotId: e.snapshotId,
        astId: e.astId,
        renderFingerprint: e.renderFingerprint,
        artifactId: null,
      }),
    RenderArtifactStored: (s, e): RenderState =>
      Predicate.isTagged(s, "Staged") ? { ...s, artifactId: e.artifactId } : s,
  },
}) {}

// ---------------------------------------------------------------- Model

export class Billing extends Domain.Model("Billing", {
  aggregates: [BillingDocument, InvoiceRender],
}) {}
