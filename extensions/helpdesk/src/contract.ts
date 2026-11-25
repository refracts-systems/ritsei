import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  type DatabaseFailure,
  InstantString,
  TrimmedText,
  Uuid,
} from "../../../framework/foundation/mod.ts"
import { Principal } from "../../../framework/modules/auth/mod.ts"
import type { AuthorizationDenied } from "../../../framework/modules/authorization/mod.ts"
import type {
  IncidentInvalidState,
  IncidentNotFound,
  TicketAlreadyInIncident,
  TicketInvalidState,
  TicketNotFound,
  TicketSubjectRefused,
} from "./errors.ts"

const ScopedInput = { principal: Principal, tenantId: Uuid }

export const TicketPriority = Schema.Literals(["critical", "high", "normal", "low"])

export type TicketPriority = Schema.Schema.Type<typeof TicketPriority>

export const TicketStatus = Schema.Literals([
  "open",
  "in_progress",
  "waiting",
  "resolved",
  "closed",
])

/** Working days from creation to the due instant, by priority (ADR-0132). */
export const slaWorkingDays: Readonly<Record<TicketPriority, number>> = {
  critical: 1,
  high: 2,
  normal: 5,
  low: 10,
}

export const Ticket = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  legalEntityId: Uuid,
  number: Schema.String,
  title: Schema.String,
  description: Schema.String,
  category: Schema.String,
  priority: TicketPriority,
  status: TicketStatus,
  requester: Schema.String,
  assignee: Schema.NullOr(Schema.String),
  dueAt: InstantString,
  /** True while the ticket is unresolved and past its due instant. */
  breached: Schema.Boolean,
  resolution: Schema.NullOr(Schema.String),
  resolvedAt: Schema.NullOr(InstantString),
  incidentId: Schema.NullOr(Uuid),
  subjectType: Schema.NullOr(Schema.String),
  subjectId: Schema.NullOr(Uuid),
  createdAt: InstantString,
})

export type Ticket = Schema.Schema.Type<typeof Ticket>

export const CreateTicketInput = Schema.Struct({
  ...ScopedInput,
  legalEntityId: Uuid,
  title: TrimmedText(200),
  description: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(5000))),
  category: Schema.optionalKey(TrimmedText(60)),
  priority: Schema.optionalKey(TicketPriority),
  /** A document the work is about, for context. An approval is refused. */
  subjectType: Schema.optionalKey(Schema.String),
  subjectId: Schema.optionalKey(Uuid),
})

export const TicketQueryInput = Schema.Struct({ ...ScopedInput, ticketId: Uuid })

export const ListTicketsInput = Schema.Struct({
  ...ScopedInput,
  legalEntityId: Schema.optionalKey(Uuid),
  assignee: Schema.optionalKey(Schema.String),
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 }))),
})

export const AssignTicketInput = Schema.Struct({
  ...ScopedInput,
  ticketId: Uuid,
  assignee: Schema.String.check(Schema.isPattern(/\S/)),
})

/** Moves an assigned ticket between in progress and waiting. */
export const TransitionTicketInput = Schema.Struct({
  ...ScopedInput,
  ticketId: Uuid,
  to: Schema.Literals(["in_progress", "waiting"]),
})

export const ResolveTicketInput = Schema.Struct({
  ...ScopedInput,
  ticketId: Uuid,
  resolution: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(5000)),
})

export const Incident = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  title: Schema.String,
  status: Schema.Literals(["open", "resolved"]),
  createdBy: Schema.String,
  resolution: Schema.NullOr(Schema.String),
  resolvedAt: Schema.NullOr(InstantString),
  ticketIds: Schema.Array(Uuid),
})

export type Incident = Schema.Schema.Type<typeof Incident>

export const CreateIncidentInput = Schema.Struct({ ...ScopedInput, title: TrimmedText(200) })

export const LinkTicketInput = Schema.Struct({ ...ScopedInput, incidentId: Uuid, ticketId: Uuid })

export const ResolveIncidentInput = Schema.Struct({
  ...ScopedInput,
  incidentId: Uuid,
  resolution: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(5000)),
})

export const GetIncidentInput = Schema.Struct({ ...ScopedInput, incidentId: Uuid })

type CommonFailure = AuthorizationDenied | DatabaseFailure | Schema.SchemaError

export interface HelpdeskService {
  readonly createTicket: (
    input: Schema.Codec.Encoded<typeof CreateTicketInput>,
  ) => Effect.Effect<Ticket, TicketSubjectRefused | CommonFailure>
  readonly getTicket: (
    input: Schema.Codec.Encoded<typeof TicketQueryInput>,
  ) => Effect.Effect<Ticket, TicketNotFound | CommonFailure>
  /** The caller's tickets: those they asked for or are assigned. */
  readonly listMine: (
    input: Schema.Codec.Encoded<typeof ListTicketsInput>,
  ) => Effect.Effect<ReadonlyArray<Ticket>, CommonFailure>
  /** Every unresolved ticket, soonest due first; needs `helpdesk.ticket.read`. */
  readonly queue: (
    input: Schema.Codec.Encoded<typeof ListTicketsInput>,
  ) => Effect.Effect<ReadonlyArray<Ticket>, CommonFailure>
  readonly assign: (
    input: Schema.Codec.Encoded<typeof AssignTicketInput>,
  ) => Effect.Effect<Ticket, TicketNotFound | TicketInvalidState | CommonFailure>
  readonly transition: (
    input: Schema.Codec.Encoded<typeof TransitionTicketInput>,
  ) => Effect.Effect<Ticket, TicketNotFound | TicketInvalidState | CommonFailure>
  readonly resolve: (
    input: Schema.Codec.Encoded<typeof ResolveTicketInput>,
  ) => Effect.Effect<Ticket, TicketNotFound | TicketInvalidState | CommonFailure>
  /** Closes a resolved ticket; its requester or a resolver may. */
  readonly close: (
    input: Schema.Codec.Encoded<typeof TicketQueryInput>,
  ) => Effect.Effect<Ticket, TicketNotFound | TicketInvalidState | CommonFailure>
  /** Reopens a resolved ticket, by its requester or a resolver. */
  readonly reopen: (
    input: Schema.Codec.Encoded<typeof TicketQueryInput>,
  ) => Effect.Effect<Ticket, TicketNotFound | TicketInvalidState | CommonFailure>
  readonly createIncident: (
    input: Schema.Codec.Encoded<typeof CreateIncidentInput>,
  ) => Effect.Effect<Incident, IncidentNotFound | CommonFailure>
  readonly linkTicket: (
    input: Schema.Codec.Encoded<typeof LinkTicketInput>,
  ) => Effect.Effect<
    Incident,
    | IncidentNotFound
    | IncidentInvalidState
    | TicketNotFound
    | TicketAlreadyInIncident
    | CommonFailure
  >
  /** Resolves the incident and every ticket of it that is still unresolved, in one step. */
  readonly resolveIncident: (
    input: Schema.Codec.Encoded<typeof ResolveIncidentInput>,
  ) => Effect.Effect<Incident, IncidentNotFound | IncidentInvalidState | CommonFailure>
  readonly getIncident: (
    input: Schema.Codec.Encoded<typeof GetIncidentInput>,
  ) => Effect.Effect<Incident, IncidentNotFound | CommonFailure>
}

export const HelpdeskService = Context.Service<HelpdeskService>("RITSEI/HelpdeskService")
