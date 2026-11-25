// Deny by default: a tenant administrator must grant each capability before it takes effect.
export const HelpdeskCapabilities = {
  ticketCreate: "helpdesk.ticket.create",
  /** Reads every ticket and the queue; a requester and an assignee read their own without it. */
  ticketRead: "helpdesk.ticket.read",
  ticketAssign: "helpdesk.ticket.assign",
  ticketResolve: "helpdesk.ticket.resolve",
  incidentManage: "helpdesk.incident.manage",
} as const
