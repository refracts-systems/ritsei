export { HelpdeskCapabilities } from "./src/capabilities.ts"

export {
  AssignTicketInput,
  CreateIncidentInput,
  CreateTicketInput,
  GetIncidentInput,
  HelpdeskService,
  Incident,
  LinkTicketInput,
  ListTicketsInput,
  ResolveIncidentInput,
  ResolveTicketInput,
  slaWorkingDays,
  Ticket,
  TicketPriority,
  TicketQueryInput,
  TicketStatus,
  TransitionTicketInput,
} from "./src/contract.ts"

export {
  IncidentInvalidState,
  IncidentNotFound,
  TicketAlreadyInIncident,
  TicketInvalidState,
  TicketNotFound,
  TicketSubjectRefused,
} from "./src/errors.ts"

export { HelpdeskLive, makeHelpdeskService } from "./src/layers.ts"

export { HelpdeskModule } from "./manifest.ts"
