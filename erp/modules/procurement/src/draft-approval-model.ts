/**
 * `PRC-DRAFT-1` as a policy (ADR-0124 phase 3), modelled in memory only. Today `draftPurchaseOrder`
 * submits the approval request in the same transaction as the draft and returns it with the order.
 * Here a policy submits it after the draft is recorded, so the drafted order no longer carries the
 * request and the approver sees it a moment later. That is an API contract change, which the owner
 * has not decided: this model states it and nothing in production uses it. `PRC-REL-1` is
 * unchanged: release still needs an approval for exactly the total.
 *
 * Whether the policy requires approval for a total is Approvals' decision (strictly above the
 * threshold), read here through `ApprovalPolicy`; it is not shared with the framework service,
 * which owns it.
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import { requireExactMajorToMinor } from "../../../../framework/foundation/mod.ts"
import { PurchaseOrder, PurchaseOrderDrafted } from "./domain-model.ts"

/** The reason production records on the request it submits when a draft is over the threshold. */
export const draftApprovalReason = "Purchase order total exceeds the approval threshold"

export class ApprovalPolicy extends Context.Service<
  ApprovalPolicy,
  { readonly isRequired: (total: string) => Effect.Effect<boolean> }
>()("Procurement/ApprovalPolicy") {}

/** Approval is required for a total strictly above the threshold. */
export const thresholdPolicy = (threshold: string) =>
  Layer.succeed(ApprovalPolicy, {
    isRequired: (total) =>
      Effect.sync(
        () => requireExactMajorToMinor(total, 2) > requireExactMajorToMinor(threshold, 2),
      ),
  })

/** The purchase order the request is about: the same instance id as the order. */
export const ApprovalSubjectId = Schema.String.pipe(Schema.brand("ApprovalSubjectId"))

export class ApprovalSubmitted extends Domain.Event("ApprovalSubmitted", {
  amount: Schema.String,
  reason: Schema.String,
}) {}

export class SubmitApproval extends Domain.Command("SubmitApproval", {
  target: ApprovalSubjectId,
  input: { amount: Schema.String, reason: Schema.String },
  events: [ApprovalSubmitted],
}) {}

const NoRequest = Schema.TaggedStruct("NoRequest", {})
const Pending = Schema.TaggedStruct("Pending", { amount: Schema.String })

export class PurchaseApprovalRequest extends Domain.Aggregate("PurchaseApprovalRequest", {
  id: ApprovalSubjectId,
  state: Schema.Union([NoRequest, Pending]),
  initial: NoRequest.make({}),
  commands: [SubmitApproval],
  decide: {
    // One request per subject: a repeat records nothing, as `onConflictDoNothing` does today.
    SubmitApproval: (request, cmd) =>
      Predicate.isTagged(request, "NoRequest")
        ? [new ApprovalSubmitted({ amount: cmd.amount, reason: cmd.reason })]
        : [],
  },
  evolve: {
    ApprovalSubmitted: (_, e) => Pending.make({ amount: e.amount }),
  },
}) {}

/** Submits the approval request once the draft is recorded and its total needs one. */
export class SubmitApprovalOnDraft extends Domain.Policy("SubmitApprovalOnDraft", {
  from: PurchaseOrder,
  on: [PurchaseOrderDrafted],
}) {}

export const SubmitApprovalOnDraftLive = SubmitApprovalOnDraft.toLayer(
  Effect.gen(function* () {
    const requests = yield* PurchaseApprovalRequest
    const policy = yield* ApprovalPolicy

    return Effect.fn(function* ({ source, event }) {
      if (!(yield* policy.isRequired(event.total))) return

      yield* requests
        .send(
          ApprovalSubjectId.make(source.id),
          new SubmitApproval({ amount: event.total, reason: draftApprovalReason }),
        )
        .pipe(Effect.asVoid, Effect.orDie)
    })
  }),
)

export class ProcurementDraftApproval extends Domain.Model("ProcurementDraftApproval", {
  aggregates: [PurchaseOrder, PurchaseApprovalRequest],
  policies: [SubmitApprovalOnDraft],
}) {}
