import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  CalendarDate,
  type DatabaseFailure,
  FinancialMajorAmount,
  InstantString,
  TrimmedText,
  Uuid,
} from "../../../../framework/foundation/mod.ts"
import { Principal } from "../../../../framework/modules/auth/mod.ts"
import type { AuthorizationDenied } from "../../../../framework/modules/authorization/mod.ts"
import type { EventIdempotencyConflict } from "../../../../framework/modules/messaging/mod.ts"
import type {
  CalendarInvalid,
  FollowNotAllowed,
  FollowNotFound,
  OwnerNotEligible,
  SituationNotFound,
} from "./errors.ts"

const ScopedInput = { principal: Principal, tenantId: Uuid }

export const SituationType = Schema.Literals([
  "receivable_overdue",
  "bill_mismatch",
  "approval_waiting",
])

export const Severity = Schema.Literals(["low", "medium", "high"])

/** Something that needs a person, with its owner and how far it has escalated (ADR-0129). */
export const Situation = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  legalEntityId: Uuid,
  type: SituationType,
  subjectType: Schema.String,
  subjectId: Uuid,
  severity: Severity,
  ownerId: Schema.NullOr(Schema.String),
  escalationLevel: Schema.Int,
  escalationDueAt: Schema.NullOr(InstantString),
  detectedAt: InstantString,
  resolvedAt: Schema.NullOr(InstantString),
})

export type Situation = Schema.Schema.Type<typeof Situation>

export const DetectInput = Schema.Struct({
  ...ScopedInput,
  legalEntityId: Uuid,
  /** The instant to detect at; omitted, the database clock. */
  at: Schema.optionalKey(InstantString),
})

/** What a detection run did, per type; `denied` when an owner would not let this caller read. */
export const DetectionOutcome = Schema.Struct({
  type: SituationType,
  status: Schema.Literals(["ran", "denied"]),
  opened: Schema.Int,
  updated: Schema.Int,
  resolved: Schema.Int,
})

export const Detection = Schema.Struct({
  legalEntityId: Uuid,
  at: InstantString,
  outcomes: Schema.Array(DetectionOutcome),
})

export type Detection = Schema.Schema.Type<typeof Detection>

export const AdvanceInput = Schema.Struct({
  ...ScopedInput,
  legalEntityId: Uuid,
  at: Schema.optionalKey(InstantString),
})

export const Escalations = Schema.Struct({
  legalEntityId: Uuid,
  at: InstantString,
  escalated: Schema.Int,
})

export const ListSituationsInput = Schema.Struct({
  ...ScopedInput,
  legalEntityId: Schema.optionalKey(Uuid),
  type: Schema.optionalKey(SituationType),
  ownerId: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(Schema.Literals(["open", "resolved"])),
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 }))),
})

/** All or nothing: up to 100 open situations to one owner who holds the flow-owner capability. */
export const AssignSituationsInput = Schema.Struct({
  ...ScopedInput,
  situationIds: Schema.Array(Uuid).check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  ownerId: Schema.String.check(Schema.isPattern(/\S/)),
})

export const ConfigureCalendarInput = Schema.Struct({
  ...ScopedInput,
  legalEntityId: Uuid,
  /** 1 Monday to 7 Sunday. */
  weekdays: Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 7 }))),
  nonWorkingDays: Schema.Array(Schema.Struct({ day: CalendarDate, name: TrimmedText(120) })),
})

export const Calendar = Schema.Struct({
  legalEntityId: Uuid,
  weekdays: Schema.Array(Schema.Int),
  nonWorkingDays: Schema.Array(Schema.Struct({ day: CalendarDate, name: Schema.String })),
})

export const GetCalendarInput = Schema.Struct({ ...ScopedInput, legalEntityId: Uuid })

/** A flow (a situation type) or one subject, never both. */
export const FollowInput = Schema.Struct({
  ...ScopedInput,
  flowType: Schema.optionalKey(SituationType),
  subjectType: Schema.optionalKey(Schema.String),
  subjectId: Schema.optionalKey(Uuid),
}).check(
  Schema.makeFilter(
    (input) =>
      (input.flowType !== undefined &&
        input.subjectType === undefined &&
        input.subjectId === undefined) ||
      (input.flowType === undefined &&
        input.subjectType !== undefined &&
        input.subjectId !== undefined),
    { expected: "either a flow type, or a subject type with a subject id" },
  ),
)

export const Follow = Schema.Struct({
  id: Uuid,
  userId: Schema.String,
  flowType: Schema.NullOr(SituationType),
  subjectType: Schema.NullOr(Schema.String),
  subjectId: Schema.NullOr(Uuid),
})

export type Follow = Schema.Schema.Type<typeof Follow>

export const UnfollowInput = Schema.Struct({ ...ScopedInput, followId: Uuid })

export const ListFollowsInput = Schema.Struct({ ...ScopedInput })

/** A notification: what happened to which situation, and nothing else. */
export const InboxItem = Schema.Struct({
  id: Uuid,
  situationId: Uuid,
  kind: Schema.Literals(["opened", "escalated", "resolved"]),
  severity: Severity,
  escalationLevel: Schema.Int,
  createdAt: InstantString,
  readAt: Schema.NullOr(InstantString),
})

export type InboxItem = Schema.Schema.Type<typeof InboxItem>

export const ListInboxInput = Schema.Struct({
  ...ScopedInput,
  unreadOnly: Schema.optionalKey(Schema.Boolean),
})

export const MarkReadInput = Schema.Struct({
  ...ScopedInput,
  itemIds: Schema.Array(Uuid).check(Schema.isMinLength(1), Schema.isMaxLength(200)),
})

export const Amount = FinancialMajorAmount

type CommonFailure = AuthorizationDenied | DatabaseFailure | Schema.SchemaError

type WriteFailure = CommonFailure | EventIdempotencyConflict

export interface SituationsService {
  /** Opens, updates, and resolves situations from the owners' facts. Idempotent. */
  readonly detect: (
    input: Schema.Codec.Encoded<typeof DetectInput>,
  ) => Effect.Effect<Detection, WriteFailure>
  /** Escalates untaken situations whose working-day due time has passed. Idempotent. */
  readonly advanceEscalations: (
    input: Schema.Codec.Encoded<typeof AdvanceInput>,
  ) => Effect.Effect<Schema.Schema.Type<typeof Escalations>, WriteFailure>
  readonly list: (
    input: Schema.Codec.Encoded<typeof ListSituationsInput>,
  ) => Effect.Effect<ReadonlyArray<Situation>, CommonFailure>
  readonly assign: (
    input: Schema.Codec.Encoded<typeof AssignSituationsInput>,
  ) => Effect.Effect<ReadonlyArray<Situation>, SituationNotFound | OwnerNotEligible | CommonFailure>
  readonly configureCalendar: (
    input: Schema.Codec.Encoded<typeof ConfigureCalendarInput>,
  ) => Effect.Effect<Schema.Schema.Type<typeof Calendar>, CalendarInvalid | CommonFailure>
  readonly getCalendar: (
    input: Schema.Codec.Encoded<typeof GetCalendarInput>,
  ) => Effect.Effect<Schema.Schema.Type<typeof Calendar>, CommonFailure>
  readonly follow: (
    input: Schema.Codec.Encoded<typeof FollowInput>,
  ) => Effect.Effect<Follow, FollowNotAllowed | CommonFailure>
  readonly unfollow: (
    input: Schema.Codec.Encoded<typeof UnfollowInput>,
  ) => Effect.Effect<void, FollowNotFound | CommonFailure>
  readonly listFollows: (
    input: Schema.Codec.Encoded<typeof ListFollowsInput>,
  ) => Effect.Effect<ReadonlyArray<Follow>, CommonFailure>
  readonly listInbox: (
    input: Schema.Codec.Encoded<typeof ListInboxInput>,
  ) => Effect.Effect<ReadonlyArray<InboxItem>, CommonFailure>
  readonly markRead: (
    input: Schema.Codec.Encoded<typeof MarkReadInput>,
  ) => Effect.Effect<number, CommonFailure>
}

export const SituationsService = Context.Service<SituationsService>("RITSEI/SituationsService")
