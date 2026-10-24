import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  type DatabaseFailure,
  FinancialMajorAmount,
  InstantString,
} from "../../../foundation/mod.ts"
import { Principal } from "../../auth/mod.ts"
import type { AuthorizationDenied } from "../../authorization/mod.ts"
import type {
  ApprovalAlreadyDecided,
  ApprovalPolicyNotFound,
  ApprovalRequestNotFound,
  SelfApprovalForbidden,
} from "./errors.ts"

const Uuid = Schema.String.check(Schema.isUUID())

/** A dotted subject type owned by the caller, such as `procurement.purchase_order`. */
export const SubjectType = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_.]*$/))
const ScopedInput = { principal: Principal, tenantId: Uuid }

export const ApprovalStatus = Schema.Literals(["pending", "approved", "rejected"])

export const ApprovalPolicy = Schema.Struct({
  tenantId: Uuid,
  subjectType: SubjectType,
  threshold: FinancialMajorAmount,
  approverCapability: Schema.String,
})

export type ApprovalPolicy = Schema.Schema.Type<typeof ApprovalPolicy>

export const ApprovalRequest = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  subjectType: SubjectType,
  subjectId: Uuid,
  amount: FinancialMajorAmount,
  reason: Schema.String,
  status: ApprovalStatus,
  requestedBy: Schema.String,
  decidedBy: Schema.NullOr(Schema.String),
  decidedAt: Schema.NullOr(InstantString),
})

export type ApprovalRequest = Schema.Schema.Type<typeof ApprovalRequest>

export const ConfigurePolicyInput = Schema.Struct({
  ...ScopedInput,
  subjectType: SubjectType,
  threshold: FinancialMajorAmount,
  approverCapability: Schema.String.check(
    Schema.isPattern(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,2}$/),
  ),
})

export const SubmitApprovalInput = Schema.Struct({
  ...ScopedInput,
  subjectType: SubjectType,
  subjectId: Uuid,
  amount: FinancialMajorAmount,
  reason: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500)),
})

export const DecideApprovalInput = Schema.Struct({
  ...ScopedInput,
  requestId: Uuid,
  decision: Schema.Literals(["approve", "reject"]),
})

export const ListApprovalsInput = Schema.Struct({
  ...ScopedInput,
  status: Schema.optionalKey(ApprovalStatus),
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 }))),
})

export const SubjectInput = Schema.Struct({
  ...ScopedInput,
  subjectType: SubjectType,
  subjectId: Uuid,
})

export const RequirementInput = Schema.Struct({
  ...ScopedInput,
  subjectType: SubjectType,
  amount: FinancialMajorAmount,
})

type CommonFailure = AuthorizationDenied | DatabaseFailure | Schema.SchemaError

/**
 * Threshold approvals with separation of duties (ADR-0103). Owners ask whether an amount needs
 * approval, submit a request for a subject, and check the decision before acting on it.
 */
export interface ApprovalService {
  readonly configurePolicy: (
    input: Schema.Codec.Encoded<typeof ConfigurePolicyInput>,
  ) => Effect.Effect<ApprovalPolicy, CommonFailure>
  /** True when a policy exists and the amount exceeds its threshold. */
  readonly isRequired: (
    input: Schema.Codec.Encoded<typeof RequirementInput>,
  ) => Effect.Effect<boolean, CommonFailure>
  /** Submits a request, or returns the subject's existing request. */
  readonly submit: (
    input: Schema.Codec.Encoded<typeof SubmitApprovalInput>,
  ) => Effect.Effect<ApprovalRequest, CommonFailure>
  readonly decide: (
    input: Schema.Codec.Encoded<typeof DecideApprovalInput>,
  ) => Effect.Effect<
    ApprovalRequest,
    | ApprovalRequestNotFound
    | ApprovalPolicyNotFound
    | ApprovalAlreadyDecided
    | SelfApprovalForbidden
    | CommonFailure
  >
  /** Requests newest first, so approvers see what is waiting; needs the request-read capability. */
  readonly list: (
    input: Schema.Codec.Encoded<typeof ListApprovalsInput>,
  ) => Effect.Effect<ReadonlyArray<ApprovalRequest>, CommonFailure>
  readonly getForSubject: (
    input: Schema.Codec.Encoded<typeof SubjectInput>,
  ) => Effect.Effect<ApprovalRequest | null, CommonFailure>
}

export const ApprovalService = Context.Service<ApprovalService>("RITSEI/ApprovalService")
