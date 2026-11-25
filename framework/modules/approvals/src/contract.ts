import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  CalendarDate,
  type DatabaseFailure,
  FinancialMajorAmount,
  InstantString,
} from "../../../foundation/mod.ts"
import { Principal } from "../../auth/mod.ts"
import type { AuthorizationDenied } from "../../authorization/mod.ts"
import type {
  ApprovalAlreadyDecided,
  ApprovalPolicyInvalid,
  ApprovalPolicyNotFound,
  ApprovalRequestNotFound,
  DelegationAlreadyRevoked,
  DelegationInvalid,
  DelegationNotFound,
  DistinctApproverRequired,
  SelfApprovalForbidden,
} from "./errors.ts"

const Uuid = Schema.String.check(Schema.isUUID())

/** A dotted subject type owned by the caller, such as `procurement.purchase_order`. */
export const SubjectType = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_.]*$/))
const ScopedInput = { principal: Principal, tenantId: Uuid }

export const ApprovalStatus = Schema.Literals(["pending", "approved", "rejected"])

const CapabilityId = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,2}$/),
)

/**
 * One step of a policy (ADR-0128): amounts above `above` and up to `upTo` need a holder of the
 * capability. `scopeLegalEntityId` is stored but not enforced until grants can be scoped.
 */
export const ApprovalPolicyStep = Schema.Struct({
  stepNumber: Schema.Int,
  above: FinancialMajorAmount,
  upTo: Schema.NullOr(FinancialMajorAmount),
  approverCapability: Schema.String,
  scopeLegalEntityId: Schema.NullOr(Uuid),
})

export type ApprovalPolicyStep = Schema.Schema.Type<typeof ApprovalPolicyStep>

export const ApprovalPolicy = Schema.Struct({
  tenantId: Uuid,
  subjectType: SubjectType,
  steps: Schema.Array(ApprovalPolicyStep),
})

export type ApprovalPolicy = Schema.Schema.Type<typeof ApprovalPolicy>

/** A person who could decide a step for someone who holds its capability, and until when. */
export const ApprovalDelegate = Schema.Struct({
  delegationId: Uuid,
  delegator: Schema.String,
  delegate: Schema.String,
  validTo: CalendarDate,
})

/**
 * A step of a request and why it is shown: the capability and scope that decide it, who decided it
 * (and for whom), and the delegations in force that let someone else decide it. `delegates` is
 * advice for display; deciding checks authority again.
 */
export const ApprovalRequestStep = Schema.Struct({
  stepNumber: Schema.Int,
  approverCapability: Schema.String,
  scopeLegalEntityId: Schema.NullOr(Uuid),
  status: Schema.Literals(["pending", "approved", "rejected"]),
  decidedBy: Schema.NullOr(Schema.String),
  onBehalfOf: Schema.NullOr(Schema.String),
  decidedAt: Schema.NullOr(InstantString),
  delegates: Schema.Array(ApprovalDelegate),
})

export type ApprovalRequestStep = Schema.Schema.Type<typeof ApprovalRequestStep>

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
  steps: Schema.Array(ApprovalRequestStep),
})

export type ApprovalRequest = Schema.Schema.Type<typeof ApprovalRequest>

export const PolicyStepInput = Schema.Struct({
  above: FinancialMajorAmount,
  upTo: Schema.optionalKey(FinancialMajorAmount),
  approverCapability: CapabilityId,
  scopeLegalEntityId: Schema.optionalKey(Uuid),
})

/**
 * The steps of a policy, in order; or the older single `threshold` and `approverCapability`, which
 * is one step above the threshold. Exactly one of the two forms is given.
 */
export const ConfigurePolicyInput = Schema.Struct({
  ...ScopedInput,
  subjectType: SubjectType,
  steps: Schema.optionalKey(Schema.Array(PolicyStepInput).check(Schema.isMaxLength(10))),
  threshold: Schema.optionalKey(FinancialMajorAmount),
  approverCapability: Schema.optionalKey(CapabilityId),
}).check(
  Schema.makeFilter(
    (input) =>
      input.steps === undefined
        ? input.threshold !== undefined && input.approverCapability !== undefined
        : input.threshold === undefined && input.approverCapability === undefined,
    { expected: "either steps, or a threshold with an approver capability" },
  ),
)

export const Delegation = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  delegator: Schema.String,
  delegate: Schema.String,
  capability: Schema.String,
  validFrom: CalendarDate,
  validTo: CalendarDate,
  reason: Schema.String,
  createdAt: InstantString,
  revokedAt: Schema.NullOr(InstantString),
  revokedBy: Schema.NullOr(Schema.String),
})

export type Delegation = Schema.Schema.Type<typeof Delegation>

/** The caller hands one capability they hold to another user for a range of days (UTC, inclusive). */
export const CreateDelegationInput = Schema.Struct({
  ...ScopedInput,
  delegate: Schema.String.check(Schema.isPattern(/\S/)),
  capability: CapabilityId,
  validFrom: CalendarDate,
  validTo: CalendarDate,
  reason: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500)),
})

export const RevokeDelegationInput = Schema.Struct({ ...ScopedInput, delegationId: Uuid })

export const ListDelegationsInput = Schema.Struct({
  ...ScopedInput,
  /** `mine` lists those the caller gave or received; `all` needs the request-read capability. */
  scope: Schema.optionalKey(Schema.Literals(["mine", "all"])),
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

export const WaitingInput = Schema.Struct({
  ...ScopedInput,
  /** Requests submitted before this instant. */
  olderThan: InstantString,
})

/** A pending request and when it was submitted; `reachesLastStep` when its amount is in the policy's last step. */
export const WaitingApproval = Schema.Struct({
  requestId: Uuid,
  subjectType: SubjectType,
  subjectId: Uuid,
  amount: FinancialMajorAmount,
  requestedAt: InstantString,
  reachesLastStep: Schema.Boolean,
})

export type WaitingApproval = Schema.Schema.Type<typeof WaitingApproval>

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
  ) => Effect.Effect<ApprovalPolicy, ApprovalPolicyInvalid | CommonFailure>
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
    | DistinctApproverRequired
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
  /** Pending requests submitted before an instant, oldest first; needs the request-read capability. */
  readonly listWaiting: (
    input: Schema.Codec.Encoded<typeof WaitingInput>,
  ) => Effect.Effect<ReadonlyArray<WaitingApproval>, CommonFailure>
  readonly createDelegation: (
    input: Schema.Codec.Encoded<typeof CreateDelegationInput>,
  ) => Effect.Effect<Delegation, DelegationInvalid | CommonFailure>
  readonly revokeDelegation: (
    input: Schema.Codec.Encoded<typeof RevokeDelegationInput>,
  ) => Effect.Effect<Delegation, DelegationNotFound | DelegationAlreadyRevoked | CommonFailure>
  readonly listDelegations: (
    input: Schema.Codec.Encoded<typeof ListDelegationsInput>,
  ) => Effect.Effect<ReadonlyArray<Delegation>, CommonFailure>
}

export const ApprovalService = Context.Service<ApprovalService>("RITSEI/ApprovalService")
