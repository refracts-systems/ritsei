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
