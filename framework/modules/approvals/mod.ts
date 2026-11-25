export {
  ApprovalDelegate,
  ApprovalPolicy,
  ApprovalPolicyStep,
  ApprovalRequest,
  ApprovalRequestStep,
  ApprovalService,
  ApprovalStatus,
  ConfigurePolicyInput,
  CreateDelegationInput,
  DecideApprovalInput,
  Delegation,
  ListApprovalsInput,
  ListDelegationsInput,
  PolicyStepInput,
  RequirementInput,
  RevokeDelegationInput,
  SubjectInput,
  SubjectType,
  SubmitApprovalInput,
  WaitingApproval,
  WaitingInput,
} from "./src/contract.ts"

export type {
  ApprovalPolicy as ApprovalPolicyType,
  ApprovalRequest as ApprovalRequestType,
  ApprovalService as ApprovalServiceContract,
  Delegation as DelegationType,
} from "./src/contract.ts"

export {
  ApprovalAlreadyDecided,
  ApprovalPolicyInvalid,
  ApprovalPolicyNotFound,
  ApprovalRequestNotFound,
  DelegationAlreadyRevoked,
  DelegationInvalid,
  DelegationNotFound,
  DistinctApproverRequired,
  SelfApprovalForbidden,
} from "./src/errors.ts"

export { ApprovalCapabilities, ApprovalsLive, makeApprovalService } from "./src/service.ts"
