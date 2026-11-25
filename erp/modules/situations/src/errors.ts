import * as Schema from "effect/Schema"

const Uuid = Schema.String.check(Schema.isUUID())

export class SituationNotFound extends Schema.TaggedError<SituationNotFound>()(
  "SituationNotFound",
  { tenantId: Uuid, situationId: Uuid },
) {}

/** The person a situation is assigned to does not hold the flow-owner capability. */
export class OwnerNotEligible extends Schema.TaggedError<OwnerNotEligible>()("OwnerNotEligible", {
  tenantId: Uuid,
  ownerId: Schema.String,
}) {}

/** A user may follow only what they can read. */
export class FollowNotAllowed extends Schema.TaggedError<FollowNotAllowed>()("FollowNotAllowed", {
  tenantId: Uuid,
  reason: Schema.String,
}) {}

export class FollowNotFound extends Schema.TaggedError<FollowNotFound>()("FollowNotFound", {
  tenantId: Uuid,
  followId: Uuid,
}) {}

export class CalendarInvalid extends Schema.TaggedError<CalendarInvalid>()("CalendarInvalid", {
  tenantId: Uuid,
  reason: Schema.String,
}) {}
