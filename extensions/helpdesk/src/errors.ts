import * as Schema from "effect/Schema"

const Uuid = Schema.String.check(Schema.isUUID())

export class TicketNotFound extends Schema.TaggedError<TicketNotFound>()("TicketNotFound", {
  tenantId: Uuid,
  ticketId: Uuid,
}) {}

export class TicketInvalidState extends Schema.TaggedError<TicketInvalidState>()(
  "TicketInvalidState",
  {
    tenantId: Uuid,
    ticketId: Uuid,
    status: Schema.Literals(["open", "in_progress", "waiting", "resolved", "closed"]),
  },
) {}

/** A ticket is never about an approval: approvals are decided in Approvals (ADR-0132). */
export class TicketSubjectRefused extends Schema.TaggedError<TicketSubjectRefused>()(
  "TicketSubjectRefused",
  { tenantId: Uuid, subjectType: Schema.String },
) {}

export class IncidentNotFound extends Schema.TaggedError<IncidentNotFound>()("IncidentNotFound", {
  tenantId: Uuid,
  incidentId: Uuid,
}) {}

export class IncidentInvalidState extends Schema.TaggedError<IncidentInvalidState>()(
  "IncidentInvalidState",
  { tenantId: Uuid, incidentId: Uuid },
) {}

/** A ticket belongs to one incident only. */
export class TicketAlreadyInIncident extends Schema.TaggedError<TicketAlreadyInIncident>()(
  "TicketAlreadyInIncident",
  { tenantId: Uuid, ticketId: Uuid, incidentId: Uuid },
) {}
