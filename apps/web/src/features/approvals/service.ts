import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import {
  decodeInput,
  decodeResponse,
  mutationRequest,
  querySuffix,
  requestJson,
  routeWithId,
} from "../../shared/api.ts"
import { UserAccount, userAccountRoutes } from "../../shared/contracts/generated/identity.ts"
import { Amount, Uuid } from "../../shared/schemas.ts"

/** Browser view of the Approvals transport contract served by the runtime API. */
export const ApprovalStatus = Schema.Literals(["pending", "approved", "rejected"])

export type ApprovalStatus = Schema.Schema.Type<typeof ApprovalStatus>

export const ApprovalRequest = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  subjectType: Schema.String,
  subjectId: Uuid,
  amount: Amount,
  reason: Schema.String,
  status: ApprovalStatus,
  requestedBy: Schema.String,
  decidedBy: Schema.NullOr(Schema.String),
  decidedAt: Schema.NullOr(Schema.String),
})

export type ApprovalRequest = Schema.Schema.Type<typeof ApprovalRequest>

const ApprovalList = Schema.Array(ApprovalRequest).check(Schema.isMaxLength(200))
const UserAccountList = Schema.Array(UserAccount).check(Schema.isMaxLength(500))
const ListInput = Schema.Struct({ status: Schema.optionalKey(ApprovalStatus) })
const Decision = Schema.Literals(["approve", "reject"])

export type Decision = Schema.Schema.Type<typeof Decision>

export const listApprovals = Effect.fn("Frontend.Approvals.listApprovals")(function* (
  input: Schema.Codec.Encoded<typeof ListInput>,
) {
  const decoded = yield* decodeInput(ListInput, input)
  const body = yield* requestJson(`/approvals/requests${querySuffix({ ...decoded, limit: 200 })}`)

  return yield* decodeResponse(ApprovalList, body)
})

export const decideApproval = Effect.fn("Frontend.Approvals.decideApproval")(function* (
  id: string,
  decision: Decision,
) {
  const decodedId = yield* decodeInput(Uuid, id)
  const decodedDecision = yield* decodeInput(Decision, decision)

  const body = yield* mutationRequest(routeWithId("/approvals/requests/:id/decision", decodedId), {
    decision: decodedDecision,
  })

  return yield* decodeResponse(ApprovalRequest, body, "unknown-outcome")
})

/** Accounts by id, so requesters and approvers appear by e-mail address. */
export const listUserAccounts = Effect.fn("Frontend.Approvals.listUserAccounts")(function* () {
  const body = yield* requestJson(userAccountRoutes.list)

  return yield* decodeResponse(UserAccountList, body)
})

/** What the user is told for the business failures a decision can return. */
export const decisionFailureMessages = {
  SelfApprovalForbidden: "You requested this approval yourself, so someone else has to decide it.",
  ApprovalAlreadyDecided: "This request was already decided. Reload to see the result.",
  ApprovalPolicyNotFound: "The approval policy for this kind of request no longer exists.",
  ApprovalRequestNotFound: "This request is no longer available. Reload the workspace.",
} as const

/** Reader-friendly names for the subject types that raise approval requests. */
const subjectLabels = new Map([
  ["procurement.purchase_order", "Purchase order"],
  ["billing.supplier_bill_variance", "Supplier bill above receipt"],
])

export const subjectLabel = (subjectType: string): string =>
  subjectLabels.get(subjectType) ?? subjectType

/** The workspace page of a subject, when one exists for its type. */
export const subjectHref = (subjectType: string, subjectId: string): string | undefined =>
  subjectType === "procurement.purchase_order"
    ? `/procurement/${encodeURIComponent(subjectId)}`
    : undefined
