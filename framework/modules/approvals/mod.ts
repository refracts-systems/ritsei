export {
  ApprovalPolicy,
  ApprovalRequest,
  ApprovalService,
  ApprovalStatus,
  ConfigurePolicyInput,
  DecideApprovalInput,
  RequirementInput,
  SubjectInput,
  SubjectType,
  SubmitApprovalInput,
} from "./src/contract.ts"

export type {
  ApprovalPolicy as ApprovalPolicyType,
  ApprovalRequest as ApprovalRequestType,
  ApprovalService as ApprovalServiceContract,
} from "./src/contract.ts"

export {
  ApprovalAlreadyDecided,
  ApprovalPolicyNotFound,
  ApprovalRequestNotFound,
  SelfApprovalForbidden,
} from "./src/errors.ts"

export { ApprovalCapabilities, ApprovalsLive, makeApprovalService } from "./src/service.ts"
