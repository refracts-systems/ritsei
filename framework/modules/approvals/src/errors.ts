import * as Schema from "effect/Schema"

const Uuid = Schema.String.check(Schema.isUUID())

export class ApprovalRequestNotFound extends Schema.TaggedError<ApprovalRequestNotFound>()(
  "ApprovalRequestNotFound",
  { tenantId: Uuid, requestId: Uuid },
) {}

export class ApprovalPolicyNotFound extends Schema.TaggedError<ApprovalPolicyNotFound>()(
  "ApprovalPolicyNotFound",
  { tenantId: Uuid, subjectType: Schema.String },
) {}

export class ApprovalAlreadyDecided extends Schema.TaggedError<ApprovalAlreadyDecided>()(
  "ApprovalAlreadyDecided",
  { tenantId: Uuid, requestId: Uuid, status: Schema.String },
) {}

/** Separation of duties: a requester never decides their own request. */
export class SelfApprovalForbidden extends Schema.TaggedError<SelfApprovalForbidden>()(
  "SelfApprovalForbidden",
  { tenantId: Uuid, requestId: Uuid },
) {}

/** A step needs a scope Authorization cannot yet enforce, or the steps are not a valid policy. */
export class ApprovalPolicyInvalid extends Schema.TaggedError<ApprovalPolicyInvalid>()(
  "ApprovalPolicyInvalid",
  { tenantId: Uuid, reason: Schema.String },
) {}

/** One person may decide only one step of a request, directly or through a delegation. */
export class DistinctApproverRequired extends Schema.TaggedError<DistinctApproverRequired>()(
  "DistinctApproverRequired",
  { tenantId: Uuid, requestId: Uuid },
) {}

/** A delegation to oneself, or one whose dates run backwards. */
export class DelegationInvalid extends Schema.TaggedError<DelegationInvalid>()(
  "DelegationInvalid",
  { tenantId: Uuid, reason: Schema.String },
) {}

export class DelegationNotFound extends Schema.TaggedError<DelegationNotFound>()(
  "DelegationNotFound",
  { tenantId: Uuid, delegationId: Uuid },
) {}

export class DelegationAlreadyRevoked extends Schema.TaggedError<DelegationAlreadyRevoked>()(
  "DelegationAlreadyRevoked",
  { tenantId: Uuid, delegationId: Uuid },
) {}
