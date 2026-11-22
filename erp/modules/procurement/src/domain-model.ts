/**
 * Procurement's class A model on the domain model port (ADR-0124, phase 1). Aggregates stay
 * table-backed in production; this model states their rules as stories in memory. Every decision
 * that production also takes is the function in `order-lifecycle.ts`, so the two cannot disagree.
 *
 * Not exported from `mod.ts`: production must not load Alchemy.
 */
import * as DateTime from "effect/DateTime"
import * as Schema from "effect/Schema"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import { FinancialMajorAmount } from "../../../../framework/foundation/mod.ts"
import { CreatePurchaseOrderInput } from "./contract.ts"
import {
  ApprovalCover,
  CancellationDecision,
  ConfirmationDecision,
  decideApprovalCover,
  decideCancellation,
  decideConfirmation,
  deriveTotal,
} from "./order-lifecycle.ts"

// ---------------------------------------------------------------- ids

/**
 * `<tenantId>/<purchaseOrderId>`. The service builds the id from the caller's tenant, so a foreign
 * tenant's order is a different, empty instance and is never addressed (PRC-PO-4).
 */
export const PurchaseOrderId = Schema.String.pipe(Schema.brand("PurchaseOrderId"))

export const purchaseOrderInstanceId = (tenantId: string, purchaseOrderId: string) =>
  PurchaseOrderId.make(`${tenantId}/${purchaseOrderId}`)

/** `<tenantId>/<supplierAccountId>/<productId>`: one price per supplier account and product. */
export const SupplierPriceId = Schema.String.pipe(Schema.brand("SupplierPriceId"))

export const supplierPriceInstanceId = (
  tenantId: string,
  supplierAccountId: string,
  productId: string,
) => SupplierPriceId.make(`${tenantId}/${supplierAccountId}/${productId}`)

// ---------------------------------------------------------------- PurchaseOrder

export class PurchaseOrderNotFound extends Domain.Rejection("PurchaseOrderNotFound") {}

export class PurchaseOrderInvalidState extends Domain.Rejection("PurchaseOrderInvalidState", {
  status: Schema.String,
}) {}

export class PurchaseOrderConfirmationIdempotencyConflict extends Domain.Rejection(
  "PurchaseOrderConfirmationIdempotencyConflict",
) {}

export class PurchaseOrderHasReceipts extends Domain.Rejection("PurchaseOrderHasReceipts") {}

/** No line, a line outside the quantity or amount boundary, or a total beyond the amount boundary. */
export class PurchaseOrderLinesInvalid extends Domain.Rejection("PurchaseOrderLinesInvalid") {}

/** `status` is the request status, or `missing` when no request exists. */
export class PurchaseOrderApprovalRequired extends Domain.Rejection(
  "PurchaseOrderApprovalRequired",
  { status: Schema.String },
) {}

// Lines are checked by `decide` with the production schema, so a story can send an invalid one.
const LineInput = Schema.Struct({
  itemId: Schema.String,
  quantity: Schema.String,
  unitPrice: Schema.String,
})

export class PurchaseOrderDrafted extends Domain.Event("PurchaseOrderDrafted", {
  supplierAccountId: Schema.String,
  lines: Schema.Array(LineInput),
  total: FinancialMajorAmount,
}) {}

export class DraftPurchaseOrder extends Domain.Command("DraftPurchaseOrder", {
  target: PurchaseOrderId,
  input: { supplierAccountId: Schema.String, lines: Schema.Array(LineInput) },
  events: [PurchaseOrderDrafted],
  rejects: [PurchaseOrderLinesInvalid, PurchaseOrderInvalidState],
}) {}

export class PurchaseOrderConfirmed extends Domain.Event("PurchaseOrderConfirmed", {
  idempotencyKey: Schema.String,
  confirmedAt: Schema.String,
}) {}

/** What Approvals answered for the order, read by the service before it sends the command. */
const ApprovalRequest = Schema.Struct({ status: Schema.String, amount: Schema.String })

const approvalFields = {
  idempotencyKey: Schema.String,
  /** Whether the policy requires approval for the order total. */
  approvalRequired: Schema.Boolean,
  approval: Schema.NullOr(ApprovalRequest),
}

const confirmRejects = [
  PurchaseOrderNotFound,
  PurchaseOrderInvalidState,
  PurchaseOrderConfirmationIdempotencyConflict,
  PurchaseOrderApprovalRequired,
] as const

/** The older command: confirms, and asks for an exact approval when the policy requires one. */
export class ConfirmPurchaseOrder extends Domain.Command("ConfirmPurchaseOrder", {
  target: PurchaseOrderId,
  input: approvalFields,
  events: [PurchaseOrderConfirmed],
  rejects: confirmRejects,
}) {}

/** Release: checks the approval is at least the total, then confirms exactly as above. */
export class ReleasePurchaseOrder extends Domain.Command("ReleasePurchaseOrder", {
  target: PurchaseOrderId,
  input: approvalFields,
  events: [PurchaseOrderConfirmed],
  rejects: confirmRejects,
}) {}

export class PurchaseOrderCancelled extends Domain.Event("PurchaseOrderCancelled", {}) {}

export class CancelPurchaseOrder extends Domain.Command("CancelPurchaseOrder", {
  target: PurchaseOrderId,
  /** Whether a receipt exists for the order; the service reads it before it sends the command. */
  input: { hasReceipts: Schema.Boolean },
  events: [PurchaseOrderCancelled],
  rejects: [PurchaseOrderNotFound, PurchaseOrderInvalidState, PurchaseOrderHasReceipts],
}) {}

const PurchaseOrderState = Schema.Struct({
  status: Schema.Literals(["absent", "draft", "confirmed", "cancelled"]),
  supplierAccountId: Schema.NullOr(Schema.String),
  lines: Schema.Array(LineInput),
  total: Schema.NullOr(Schema.String),
  /** Null in a draft; set at confirmation and kept by a cancelled order. */
  confirmationIdempotencyKey: Schema.NullOr(Schema.String),
  confirmedAt: Schema.NullOr(Schema.String),
})

type PurchaseOrderState = typeof PurchaseOrderState.Type

const absent: PurchaseOrderState = {
  status: "absent",
  supplierAccountId: null,
  lines: [],
  total: null,
  confirmationIdempotencyKey: null,
  confirmedAt: null,
}

const isLines = Schema.is(CreatePurchaseOrderInput.fields.lines)

const isAmount = Schema.is(FinancialMajorAmount)

type ApprovalInput = {
  readonly approvalRequired: boolean
  readonly approval: { readonly status: string; readonly amount: string } | null
}

/** The approval gate of `confirmPurchaseOrder`: only an approval for exactly the total passes. */
const exactApprovalRefusal = (cmd: ApprovalInput, total: string) =>
  !cmd.approvalRequired
    ? undefined
    : ApprovalCover.$match(decideApprovalCover(cmd.approval, total), {
        Covered: () => undefined,
        Missing: () => new PurchaseOrderApprovalRequired({ status: "missing" }),
        NotCovered: ({ status }) => new PurchaseOrderApprovalRequired({ status }),
      })

const decideConfirm = (
  order: PurchaseOrderState,
  cmd: ApprovalInput & { readonly idempotencyKey: string },
  confirmedAt: string,
) => {
  const status = order.status

  if (status === "absent") return new PurchaseOrderNotFound()

  const decision = decideConfirmation(
    { status, confirmationIdempotencyKey: order.confirmationIdempotencyKey },
    cmd.idempotencyKey,
  )

  return ConfirmationDecision.$match(decision, {
    Existing: () => [],
    IdempotencyConflict: () => new PurchaseOrderConfirmationIdempotencyConflict(),
    InvalidState: ({ status }) => new PurchaseOrderInvalidState({ status }),
    Confirm: () =>
      exactApprovalRefusal(cmd, order.total ?? "0.00") ?? [
        new PurchaseOrderConfirmed({ idempotencyKey: cmd.idempotencyKey, confirmedAt }),
      ],
  })
}

export class PurchaseOrder extends Domain.Aggregate("PurchaseOrder", {
  id: PurchaseOrderId,
  state: PurchaseOrderState,
  initial: absent,
  commands: [DraftPurchaseOrder, ConfirmPurchaseOrder, ReleasePurchaseOrder, CancelPurchaseOrder],
  decide: {
    DraftPurchaseOrder: (order, cmd) => {
      // Once drafted, no command changes the order's lines, supplier account, or total: the
      // service never sends a second draft for an id, and a confirmed order is frozen (PRC-PO-1).
      if (order.status !== "absent") return new PurchaseOrderInvalidState({ status: order.status })

      if (!isLines(cmd.lines)) return new PurchaseOrderLinesInvalid()

      const total = deriveTotal(cmd.lines)

      return isAmount(total)
        ? [
            new PurchaseOrderDrafted({
              supplierAccountId: cmd.supplierAccountId,
              lines: cmd.lines,
              total,
            }),
          ]
        : new PurchaseOrderLinesInvalid()
    },
    ConfirmPurchaseOrder: (order, cmd, ctx) =>
      decideConfirm(order, cmd, DateTime.formatIso(ctx.now)),
    ReleasePurchaseOrder: (order, cmd, ctx) => {
      if (order.status === "absent") return new PurchaseOrderNotFound()

      // Release refuses an approval for less than the total, then confirms through the decision
      // above, which refuses one for more.
      if (cmd.approvalRequired) {
        const atLeastTotal = ApprovalCover.$match(
          decideApprovalCover(cmd.approval, order.total ?? "0.00"),
          { Covered: () => true, Missing: () => false, NotCovered: ({ excess }) => excess },
        )

        if (!atLeastTotal) {
          return new PurchaseOrderApprovalRequired({ status: cmd.approval?.status ?? "missing" })
        }
      }

      return decideConfirm(order, cmd, DateTime.formatIso(ctx.now))
    },
    CancelPurchaseOrder: (order, cmd) => {
      const status = order.status

      if (status === "absent") return new PurchaseOrderNotFound()

      return CancellationDecision.$match(decideCancellation(status), {
        AlreadyCancelled: () => [],
        InvalidState: ({ status }) => new PurchaseOrderInvalidState({ status }),
        Cancel: () =>
          cmd.hasReceipts ? new PurchaseOrderHasReceipts() : [new PurchaseOrderCancelled()],
      })
    },
  },
  evolve: {
    PurchaseOrderDrafted: (_, e): PurchaseOrderState => ({
      status: "draft",
      supplierAccountId: e.supplierAccountId,
      lines: e.lines,
      total: e.total,
      confirmationIdempotencyKey: null,
      confirmedAt: null,
    }),
    PurchaseOrderConfirmed: (s, e): PurchaseOrderState => ({
      ...s,
      status: "confirmed",
      confirmationIdempotencyKey: e.idempotencyKey,
      confirmedAt: e.confirmedAt,
    }),
    PurchaseOrderCancelled: (s): PurchaseOrderState => ({ ...s, status: "cancelled" }),
  },
}) {}

// ---------------------------------------------------------------- SupplierPrice

/**
 * Reference data: the price is read when an order is drafted and copied onto the line, outside the
 * order's own transaction (PRC-DRAFT-1). Setting a price replaces the one price of the instance.
 */
export class SupplierPriceSet extends Domain.Event("SupplierPriceSet", {
  unitPrice: FinancialMajorAmount,
  /** The price this one replaced, so a story can see the replacement. */
  replaced: Schema.NullOr(FinancialMajorAmount),
}) {}

export class SetSupplierPrice extends Domain.Command("SetSupplierPrice", {
  target: SupplierPriceId,
  input: { unitPrice: FinancialMajorAmount },
  events: [SupplierPriceSet],
}) {}

export class SupplierPrice extends Domain.Aggregate("SupplierPrice", {
  id: SupplierPriceId,
  state: Schema.Struct({ unitPrice: Schema.NullOr(FinancialMajorAmount) }),
  initial: { unitPrice: null },
  commands: [SetSupplierPrice],
  decide: {
    SetSupplierPrice: (s, cmd) => [
      new SupplierPriceSet({ unitPrice: cmd.unitPrice, replaced: s.unitPrice }),
    ],
  },
  evolve: {
    SupplierPriceSet: (_, e) => ({ unitPrice: e.unitPrice }),
  },
}) {}

// ---------------------------------------------------------------- Model

export class Procurement extends Domain.Model("Procurement", {
  aggregates: [PurchaseOrder, SupplierPrice],
}) {}
