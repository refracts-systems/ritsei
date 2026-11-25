// HTTP adapter for this extension (ADR-0094, ADR-0132). Only the composition root imports this file.
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder"
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint"
import * as HttpApiGroup from "effect/http-api/HttpApiGroup"

import {
  ApiErrors,
  BaseApiErrorPolicy,
  BearerAuth,
  CurrentPrincipal,
  TenantHeaders,
  Uuid,
  apiErrorMapping,
  moduleApi,
} from "../../framework/modules/http/mod.ts"
import { HelpdeskService, Incident, Ticket, TicketPriority } from "./mod.ts"

const limit = Schema.NumberFromString.pipe(
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isBetween({ minimum: 1, maximum: 200 })),
)

export const HelpdeskHttpGroup = HttpApiGroup.make("Helpdesk")
  .add(
    HttpApiEndpoint.post("createTicket", "/helpdesk/tickets", {
      headers: TenantHeaders,
      payload: Schema.Struct({
        legalEntityId: Uuid,
        title: Schema.String,
        description: Schema.optionalKey(Schema.String),
        category: Schema.optionalKey(Schema.String),
        priority: Schema.optionalKey(TicketPriority),
        subjectType: Schema.optionalKey(Schema.String),
        subjectId: Schema.optionalKey(Uuid),
      }),
      success: Ticket,
      error: ApiErrors,
    }).middleware(BearerAuth),
  )
  .add(
    HttpApiEndpoint.get("listMyTickets", "/helpdesk/tickets/mine", {
      headers: TenantHeaders,
      query: { legalEntityId: Schema.optionalKey(Uuid), limit: Schema.optionalKey(limit) },
      success: Schema.Array(Ticket),
      error: ApiErrors,
    }).middleware(BearerAuth),
  )
  .add(
    HttpApiEndpoint.get("helpdeskQueue", "/helpdesk/tickets", {
      headers: TenantHeaders,
      query: {
        legalEntityId: Schema.optionalKey(Uuid),
        assignee: Schema.optionalKey(Schema.String),
        limit: Schema.optionalKey(limit),
      },
      success: Schema.Array(Ticket),
      error: ApiErrors,
    }).middleware(BearerAuth),
  )
  .add(
    HttpApiEndpoint.get("getTicket", "/helpdesk/tickets/:id", {
      params: { id: Uuid },
      headers: TenantHeaders,
      success: Ticket,
      error: ApiErrors,
    }).middleware(BearerAuth),
  )
  .add(
    HttpApiEndpoint.post("assignTicket", "/helpdesk/tickets/:id/assign", {
      params: { id: Uuid },
      headers: TenantHeaders,
      payload: Schema.Struct({ assignee: Schema.String }),
      success: Ticket,
      error: ApiErrors,
    }).middleware(BearerAuth),
  )
  .add(
    HttpApiEndpoint.post("transitionTicket", "/helpdesk/tickets/:id/transition", {
      params: { id: Uuid },
      headers: TenantHeaders,
      payload: Schema.Struct({ to: Schema.Literals(["in_progress", "waiting"]) }),
      success: Ticket,
      error: ApiErrors,
    }).middleware(BearerAuth),
  )
  .add(
    HttpApiEndpoint.post("resolveTicket", "/helpdesk/tickets/:id/resolve", {
      params: { id: Uuid },
      headers: TenantHeaders,
      payload: Schema.Struct({ resolution: Schema.String }),
      success: Ticket,
      error: ApiErrors,
    }).middleware(BearerAuth),
  )
  .add(
    HttpApiEndpoint.post("closeTicket", "/helpdesk/tickets/:id/close", {
      params: { id: Uuid },
      headers: TenantHeaders,
      success: Ticket,
      error: ApiErrors,
    }).middleware(BearerAuth),
  )
  .add(
    HttpApiEndpoint.post("reopenTicket", "/helpdesk/tickets/:id/reopen", {
      params: { id: Uuid },
      headers: TenantHeaders,
      success: Ticket,
      error: ApiErrors,
    }).middleware(BearerAuth),
  )
  .add(
    HttpApiEndpoint.post("createIncident", "/helpdesk/incidents", {
      headers: TenantHeaders,
      payload: Schema.Struct({ title: Schema.String }),
      success: Incident,
      error: ApiErrors,
    }).middleware(BearerAuth),
  )
  .add(
    HttpApiEndpoint.get("getIncident", "/helpdesk/incidents/:id", {
      params: { id: Uuid },
      headers: TenantHeaders,
      success: Incident,
      error: ApiErrors,
    }).middleware(BearerAuth),
  )
  .add(
    HttpApiEndpoint.post("linkTicketToIncident", "/helpdesk/incidents/:id/tickets", {
      params: { id: Uuid },
      headers: TenantHeaders,
      payload: Schema.Struct({ ticketId: Uuid }),
      success: Incident,
      error: ApiErrors,
    }).middleware(BearerAuth),
  )
  .add(
    HttpApiEndpoint.post("resolveIncident", "/helpdesk/incidents/:id/resolve", {
      params: { id: Uuid },
      headers: TenantHeaders,
      payload: Schema.Struct({ resolution: Schema.String }),
      success: Incident,
      error: ApiErrors,
    }).middleware(BearerAuth),
  )

const HelpdeskHttpApi = moduleApi(HelpdeskHttpGroup)

export const HelpdeskHttpErrors = apiErrorMapping({
  ...BaseApiErrorPolicy,
  IncidentInvalidState: "conflict",
  IncidentNotFound: "not_found",
  TicketAlreadyInIncident: "conflict",
  TicketInvalidState: "conflict",
  TicketNotFound: "not_found",
  TicketSubjectRefused: "conflict",
})

export const HelpdeskHttpHandlers = HttpApiBuilder.group(HelpdeskHttpApi, "Helpdesk", (handlers) =>
  Effect.gen(function* () {
    const helpdesk = yield* HelpdeskService

    return handlers
      .handle(
        "createTicket",
        Effect.fn("Http.Helpdesk.createTicket")(function* ({ headers, payload }) {
          const principal = yield* CurrentPrincipal

          return yield* HelpdeskHttpErrors.apiEffect(
            helpdesk.createTicket({ principal, tenantId: headers["x-tenant-id"], ...payload }),
          )
        }),
      )
      .handle(
        "listMyTickets",
        Effect.fn("Http.Helpdesk.listMyTickets")(function* ({ headers, query }) {
          const principal = yield* CurrentPrincipal

          return yield* HelpdeskHttpErrors.apiEffect(
            helpdesk.listMine({ principal, tenantId: headers["x-tenant-id"], ...query }),
          )
        }),
      )
      .handle(
        "helpdeskQueue",
        Effect.fn("Http.Helpdesk.helpdeskQueue")(function* ({ headers, query }) {
          const principal = yield* CurrentPrincipal

          return yield* HelpdeskHttpErrors.apiEffect(
            helpdesk.queue({ principal, tenantId: headers["x-tenant-id"], ...query }),
          )
        }),
      )
      .handle(
        "getTicket",
        Effect.fn("Http.Helpdesk.getTicket")(function* ({ headers, params }) {
          const principal = yield* CurrentPrincipal

          return yield* HelpdeskHttpErrors.apiEffect(
            helpdesk.getTicket({
              principal,
              tenantId: headers["x-tenant-id"],
              ticketId: params.id,
            }),
          )
        }),
      )
      .handle(
        "assignTicket",
        Effect.fn("Http.Helpdesk.assignTicket")(function* ({ headers, params, payload }) {
          const principal = yield* CurrentPrincipal

          return yield* HelpdeskHttpErrors.apiEffect(
            helpdesk.assign({
              principal,
              tenantId: headers["x-tenant-id"],
              ticketId: params.id,
              ...payload,
            }),
          )
        }),
      )
      .handle(
        "transitionTicket",
        Effect.fn("Http.Helpdesk.transitionTicket")(function* ({ headers, params, payload }) {
          const principal = yield* CurrentPrincipal

          return yield* HelpdeskHttpErrors.apiEffect(
            helpdesk.transition({
              principal,
              tenantId: headers["x-tenant-id"],
              ticketId: params.id,
              ...payload,
            }),
          )
        }),
      )
      .handle(
        "resolveTicket",
        Effect.fn("Http.Helpdesk.resolveTicket")(function* ({ headers, params, payload }) {
          const principal = yield* CurrentPrincipal

          return yield* HelpdeskHttpErrors.apiEffect(
            helpdesk.resolve({
              principal,
              tenantId: headers["x-tenant-id"],
              ticketId: params.id,
              ...payload,
            }),
          )
        }),
      )
      .handle(
        "closeTicket",
        Effect.fn("Http.Helpdesk.closeTicket")(function* ({ headers, params }) {
          const principal = yield* CurrentPrincipal

          return yield* HelpdeskHttpErrors.apiEffect(
            helpdesk.close({ principal, tenantId: headers["x-tenant-id"], ticketId: params.id }),
          )
        }),
      )
      .handle(
        "reopenTicket",
        Effect.fn("Http.Helpdesk.reopenTicket")(function* ({ headers, params }) {
          const principal = yield* CurrentPrincipal

          return yield* HelpdeskHttpErrors.apiEffect(
            helpdesk.reopen({ principal, tenantId: headers["x-tenant-id"], ticketId: params.id }),
          )
        }),
      )
      .handle(
        "createIncident",
        Effect.fn("Http.Helpdesk.createIncident")(function* ({ headers, payload }) {
          const principal = yield* CurrentPrincipal

          return yield* HelpdeskHttpErrors.apiEffect(
            helpdesk.createIncident({ principal, tenantId: headers["x-tenant-id"], ...payload }),
          )
        }),
      )
      .handle(
        "getIncident",
        Effect.fn("Http.Helpdesk.getIncident")(function* ({ headers, params }) {
          const principal = yield* CurrentPrincipal

          return yield* HelpdeskHttpErrors.apiEffect(
            helpdesk.getIncident({
              principal,
              tenantId: headers["x-tenant-id"],
              incidentId: params.id,
            }),
          )
        }),
      )
      .handle(
        "linkTicketToIncident",
        Effect.fn("Http.Helpdesk.linkTicketToIncident")(function* ({ headers, params, payload }) {
          const principal = yield* CurrentPrincipal

          return yield* HelpdeskHttpErrors.apiEffect(
            helpdesk.linkTicket({
              principal,
              tenantId: headers["x-tenant-id"],
              incidentId: params.id,
              ...payload,
            }),
          )
        }),
      )
      .handle(
        "resolveIncident",
        Effect.fn("Http.Helpdesk.resolveIncident")(function* ({ headers, params, payload }) {
          const principal = yield* CurrentPrincipal

          return yield* HelpdeskHttpErrors.apiEffect(
            helpdesk.resolveIncident({
              principal,
              tenantId: headers["x-tenant-id"],
              incidentId: params.id,
              ...payload,
            }),
          )
        }),
      )
  }),
)
