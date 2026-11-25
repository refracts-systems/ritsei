import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import { incidents, tickets } from "../db/schema.ts"
import { Database, uuidv7 } from "../../../framework/foundation/mod.ts"
import {
  AuthorizationService,
  scopedCommand,
} from "../../../framework/modules/authorization/mod.ts"
import { NumberingService } from "../../../framework/modules/numbering/mod.ts"
import { WorkingCalendar } from "../../../erp/modules/situations/mod.ts"
import { HelpdeskCapabilities } from "./capabilities.ts"
import {
  AssignTicketInput,
  CreateIncidentInput,
  CreateTicketInput,
  GetIncidentInput,
  HelpdeskService,
  type Incident,
  LinkTicketInput,
  ListTicketsInput,
  ResolveIncidentInput,
  ResolveTicketInput,
  slaWorkingDays,
  type Ticket,
  TicketQueryInput,
  TransitionTicketInput,
} from "./contract.ts"
import {
  IncidentInvalidState,
  IncidentNotFound,
  TicketAlreadyInIncident,
  TicketInvalidState,
  TicketNotFound,
  TicketSubjectRefused,
} from "./errors.ts"

type TicketRow = typeof tickets.$inferSelect

const unresolved = ["open", "in_progress", "waiting"] as const

const isUnresolved = (status: TicketRow["status"]) => unresolved.some((open) => open === status)

export const makeHelpdeskService = Effect.gen(function* () {
  const database = yield* Database
  const authorization = yield* AuthorizationService
  const authorized = scopedCommand(authorization)
  const numbering = yield* NumberingService
  const calendar = yield* WorkingCalendar

  /** The database clock decides what is overdue (ADR-0126). */
  const databaseNow = database
    .query((db) => db.execute(sql`select now()::text as now`), "helpdesk.clock")
    .pipe(Effect.map((rows) => new Date(String(rows[0]?.["now"]))))

  const toTicket = (row: TicketRow, now: Date): Ticket => ({
    id: row.id,
    tenantId: row.tenantId,
    legalEntityId: row.legalEntityId,
    number: row.number,
    title: row.title,
    description: row.description,
    category: row.category,
    priority: row.priority,
    status: row.status,
    requester: row.requester,
    assignee: row.assignee,
    dueAt: row.dueAt.toISOString(),
    breached: isUnresolved(row.status) && row.dueAt.getTime() < now.getTime(),
    resolution: row.resolution,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    incidentId: row.incidentId,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    createdAt: row.createdAt.toISOString(),
  })

  /** Whether the caller holds a capability, as a plain answer. */
  const holds = (
    principal: { readonly userAccountId: string; readonly sessionId: string },
    tenantId: string,
    capability: (typeof HelpdeskCapabilities)[keyof typeof HelpdeskCapabilities],
  ) =>
    authorization.authorize({ principal, tenantId, capability }).pipe(
      Effect.as(true),
      Effect.catchTag("AuthorizationDenied", () => Effect.succeed(false)),
    )

  const loadTicket = (tenantId: string, ticketId: string) =>
    database
      .query(
        (db) =>
          db
            .select()
            .from(tickets)
            .where(and(eq(tickets.tenantId, tenantId), eq(tickets.id, ticketId)))
            .for("update"),
        "helpdesk.ticket.lock",
      )
      .pipe(
        Effect.flatMap((rows) =>
          rows[0] === undefined
            ? Effect.fail(new TicketNotFound({ tenantId, ticketId }))
            : Effect.succeed(rows[0]),
        ),
      )

  /** A ticket the caller may see: their own as requester or assignee, or any with the read right. */
  const readable = (
    principal: { readonly userAccountId: string; readonly sessionId: string },
    row: TicketRow,
  ) =>
    row.requester === principal.userAccountId || row.assignee === principal.userAccountId
      ? Effect.succeed(true)
      : holds(principal, row.tenantId, HelpdeskCapabilities.ticketRead)

  const createTicket = Effect.fn("HelpdeskService.createTicket")(function* (
    input: Schema.Codec.Encoded<typeof CreateTicketInput>,
  ) {
    const decoded = yield* authorized(CreateTicketInput, HelpdeskCapabilities.ticketCreate)(input)

    if (decoded.subjectType?.startsWith("approvals.") === true) {
      return yield* Effect.fail(
        new TicketSubjectRefused({
          tenantId: decoded.tenantId,
          subjectType: decoded.subjectType,
        }),
      )
    }

    const priority = decoded.priority ?? "normal"

    return yield* database.withTransaction(
      Effect.gen(function* () {
        const now = yield* databaseNow
        const id = uuidv7()

        const allocated = yield* numbering
          .allocate({
            tenantId: decoded.tenantId,
            scopeId: decoded.legalEntityId,
            documentType: "helpdesk.ticket",
            documentId: id,
            documentDate: now.toISOString().slice(0, 10),
            prefix: "HD/",
          })
          .pipe(Effect.catchTag("SchemaError", (error) => Effect.die(error)))

        const dueAt = yield* calendar.dueAfter({
          tenantId: decoded.tenantId,
          legalEntityId: decoded.legalEntityId,
          from: now.toISOString(),
          workingDays: slaWorkingDays[priority],
        })

        const [row] = yield* database.query(
          (db) =>
            db
              .insert(tickets)
              .values({
                id,
                tenantId: decoded.tenantId,
                legalEntityId: decoded.legalEntityId,
                number: allocated.number,
                title: decoded.title,
                description: decoded.description ?? "",
                category: decoded.category ?? "general",
                priority,
                requester: decoded.principal.userAccountId,
                dueAt: new Date(dueAt),
                subjectType: decoded.subjectType ?? null,
                subjectId: decoded.subjectId ?? null,
                createdAt: now,
              })
              .returning(),
          "helpdesk.ticket.create",
        )

        return toTicket(row!, now)
      }),
      "helpdesk.ticket.create.atomic",
    )
  })

  const getTicket = Effect.fn("HelpdeskService.getTicket")(function* (
    input: Schema.Codec.Encoded<typeof TicketQueryInput>,
  ) {
    const decoded = yield* Schema.decodeUnknownEffect(TicketQueryInput)(input)

    const row = (yield* database.query(
      (db) =>
        db
          .select()
          .from(tickets)
          .where(and(eq(tickets.tenantId, decoded.tenantId), eq(tickets.id, decoded.ticketId))),
      "helpdesk.ticket.get",
    ))[0]

    // Another person's ticket reads as missing, not as forbidden.
    if (row === undefined || !(yield* readable(decoded.principal, row))) {
      return yield* Effect.fail(
        new TicketNotFound({ tenantId: decoded.tenantId, ticketId: decoded.ticketId }),
      )
    }

    return toTicket(row, yield* databaseNow)
  })

  const listMine = Effect.fn("HelpdeskService.listMine")(function* (
    input: Schema.Codec.Encoded<typeof ListTicketsInput>,
  ) {
    const decoded = yield* Schema.decodeUnknownEffect(ListTicketsInput)(input)
    const me = decoded.principal.userAccountId

    const rows = yield* database.query(
      (db) =>
        db
          .select()
          .from(tickets)
          .where(
            and(
              eq(tickets.tenantId, decoded.tenantId),
              or(eq(tickets.requester, me), eq(tickets.assignee, me)),
              decoded.legalEntityId === undefined
                ? undefined
                : eq(tickets.legalEntityId, decoded.legalEntityId),
            ),
          )
          .orderBy(asc(tickets.dueAt), asc(tickets.id))
          .limit(decoded.limit ?? 100),
      "helpdesk.ticket.mine",
    )

    const now = yield* databaseNow

    return rows.map((row) => toTicket(row, now))
  })

  const queue = Effect.fn("HelpdeskService.queue")(function* (
    input: Schema.Codec.Encoded<typeof ListTicketsInput>,
  ) {
    const decoded = yield* authorized(ListTicketsInput, HelpdeskCapabilities.ticketRead)(input)

    const rows = yield* database.query(
      (db) =>
        db
          .select()
          .from(tickets)
          .where(
            and(
              eq(tickets.tenantId, decoded.tenantId),
              inArray(tickets.status, [...unresolved]),
              decoded.legalEntityId === undefined
                ? undefined
                : eq(tickets.legalEntityId, decoded.legalEntityId),
              decoded.assignee === undefined ? undefined : eq(tickets.assignee, decoded.assignee),
            ),
          )
          .orderBy(asc(tickets.dueAt), asc(tickets.id))
          .limit(decoded.limit ?? 100),
      "helpdesk.queue",
    )

    const now = yield* databaseNow

    return rows.map((row) => toTicket(row, now))
  })

  /** Applies a change to a locked, still unresolved ticket and returns the updated ticket. */
  const change = <E>(
    tenantId: string,
    ticketId: string,
    permitted: (row: TicketRow) => Effect.Effect<boolean, E>,
    set: (now: Date) => Partial<typeof tickets.$inferInsert>,
    from: ReadonlyArray<TicketRow["status"]>,
  ) =>
    database.withTransaction(
      Effect.gen(function* () {
        const row = yield* loadTicket(tenantId, ticketId)

        // Someone who may not act on it is told it does not exist.
        if (!(yield* permitted(row)))
          return yield* Effect.fail(new TicketNotFound({ tenantId, ticketId }))

        if (!from.includes(row.status)) {
          return yield* Effect.fail(
            new TicketInvalidState({ tenantId, ticketId, status: row.status }),
          )
        }

        const now = yield* databaseNow

        const [updated] = yield* database.query(
          (db) =>
            db
              .update(tickets)
              .set({ ...set(now), updatedAt: now })
              .where(and(eq(tickets.tenantId, tenantId), eq(tickets.id, ticketId)))
              .returning(),
          "helpdesk.ticket.change",
        )

        return toTicket(updated!, now)
      }),
      "helpdesk.ticket.change.atomic",
    )

  const assign = Effect.fn("HelpdeskService.assign")(function* (
    input: Schema.Codec.Encoded<typeof AssignTicketInput>,
  ) {
    const decoded = yield* authorized(AssignTicketInput, HelpdeskCapabilities.ticketAssign)(input)

    return yield* change(
      decoded.tenantId,
      decoded.ticketId,
      () => Effect.succeed(true),
      () => ({ assignee: decoded.assignee, status: "in_progress" }),
      unresolved,
    )
  })

  const transition = Effect.fn("HelpdeskService.transition")(function* (
    input: Schema.Codec.Encoded<typeof TransitionTicketInput>,
  ) {
    const decoded = yield* Schema.decodeUnknownEffect(TransitionTicketInput)(input)

    return yield* change(
      decoded.tenantId,
      decoded.ticketId,
      (row) =>
        row.assignee === decoded.principal.userAccountId
          ? Effect.succeed(true)
          : holds(decoded.principal, decoded.tenantId, HelpdeskCapabilities.ticketResolve),
      () => ({ status: decoded.to }),
      unresolved,
    )
  })

  const resolve = Effect.fn("HelpdeskService.resolve")(function* (
    input: Schema.Codec.Encoded<typeof ResolveTicketInput>,
  ) {
    const decoded = yield* authorized(ResolveTicketInput, HelpdeskCapabilities.ticketResolve)(input)

    return yield* change(
      decoded.tenantId,
      decoded.ticketId,
      () => Effect.succeed(true),
      (now) => ({ status: "resolved", resolution: decoded.resolution, resolvedAt: now }),
      unresolved,
    )
  })

  /** The requester of the ticket, or a resolver, may close or reopen it. */
  const byRequesterOrResolver =
    (principal: { readonly userAccountId: string; readonly sessionId: string }, tenantId: string) =>
    (row: TicketRow) =>
      row.requester === principal.userAccountId
        ? Effect.succeed(true)
        : holds(principal, tenantId, HelpdeskCapabilities.ticketResolve)

  const close = Effect.fn("HelpdeskService.close")(function* (
    input: Schema.Codec.Encoded<typeof TicketQueryInput>,
  ) {
    const decoded = yield* Schema.decodeUnknownEffect(TicketQueryInput)(input)

    return yield* change(
      decoded.tenantId,
      decoded.ticketId,
      byRequesterOrResolver(decoded.principal, decoded.tenantId),
      () => ({ status: "closed" }),
      ["resolved"],
    )
  })

  const reopen = Effect.fn("HelpdeskService.reopen")(function* (
    input: Schema.Codec.Encoded<typeof TicketQueryInput>,
  ) {
    const decoded = yield* Schema.decodeUnknownEffect(TicketQueryInput)(input)

    return yield* change(
      decoded.tenantId,
      decoded.ticketId,
      byRequesterOrResolver(decoded.principal, decoded.tenantId),
      () => ({ status: "open", resolution: null, resolvedAt: null }),
      ["resolved"],
    )
  })

  const incidentOf = (tenantId: string, incidentId: string, lock: boolean) =>
    Effect.gen(function* () {
      const query = (db: Parameters<Parameters<typeof database.query>[0]>[0]) => {
        const base = db
          .select()
          .from(incidents)
          .where(and(eq(incidents.tenantId, tenantId), eq(incidents.id, incidentId)))

        return lock ? base.for("update") : base
      }

      const row = (yield* database.query(query, "helpdesk.incident.get"))[0]

      if (row === undefined)
        return yield* Effect.fail(new IncidentNotFound({ tenantId, incidentId }))

      const linked = yield* database.query(
        (db) =>
          db
            .select({ id: tickets.id })
            .from(tickets)
            .where(and(eq(tickets.tenantId, tenantId), eq(tickets.incidentId, incidentId)))
            .orderBy(asc(tickets.createdAt), asc(tickets.id)),
        "helpdesk.incident.tickets",
      )

      return {
        id: row.id,
        tenantId: row.tenantId,
        title: row.title,
        status: row.status,
        createdBy: row.createdBy,
        resolution: row.resolution,
        resolvedAt: row.resolvedAt?.toISOString() ?? null,
        ticketIds: linked.map((ticket) => ticket.id),
      } satisfies Incident
    })

  const createIncident = Effect.fn("HelpdeskService.createIncident")(function* (
    input: Schema.Codec.Encoded<typeof CreateIncidentInput>,
  ) {
    const decoded = yield* authorized(
      CreateIncidentInput,
      HelpdeskCapabilities.incidentManage,
    )(input)

    const [row] = yield* database.query(
      (db) =>
        db
          .insert(incidents)
          .values({
            tenantId: decoded.tenantId,
            title: decoded.title,
            createdBy: decoded.principal.userAccountId,
          })
          .returning({ id: incidents.id }),
      "helpdesk.incident.create",
    )

    return yield* incidentOf(decoded.tenantId, row!.id, false)
  })

  const linkTicket = Effect.fn("HelpdeskService.linkTicket")(function* (
    input: Schema.Codec.Encoded<typeof LinkTicketInput>,
  ) {
    const decoded = yield* authorized(LinkTicketInput, HelpdeskCapabilities.incidentManage)(input)

    return yield* database.withTransaction(
      Effect.gen(function* () {
        const incident = yield* incidentOf(decoded.tenantId, decoded.incidentId, true)

        if (incident.status !== "open") {
          return yield* Effect.fail(
            new IncidentInvalidState({
              tenantId: decoded.tenantId,
              incidentId: decoded.incidentId,
            }),
          )
        }

        const ticket = yield* loadTicket(decoded.tenantId, decoded.ticketId)

        if (ticket.incidentId !== null && ticket.incidentId !== decoded.incidentId) {
          return yield* Effect.fail(
            new TicketAlreadyInIncident({
              tenantId: decoded.tenantId,
              ticketId: decoded.ticketId,
              incidentId: ticket.incidentId,
            }),
          )
        }

        yield* database.query(
          (db) =>
            db
              .update(tickets)
              .set({ incidentId: decoded.incidentId, updatedAt: new Date() })
              .where(and(eq(tickets.tenantId, decoded.tenantId), eq(tickets.id, decoded.ticketId))),
          "helpdesk.incident.link",
        )

        return yield* incidentOf(decoded.tenantId, decoded.incidentId, false)
      }),
      "helpdesk.incident.link.atomic",
    )
  })

  const resolveIncident = Effect.fn("HelpdeskService.resolveIncident")(function* (
    input: Schema.Codec.Encoded<typeof ResolveIncidentInput>,
  ) {
    const decoded = yield* authorized(
      ResolveIncidentInput,
      HelpdeskCapabilities.incidentManage,
    )(input)

    return yield* database.withTransaction(
      Effect.gen(function* () {
        const incident = yield* incidentOf(decoded.tenantId, decoded.incidentId, true)

        if (incident.status !== "open") {
          return yield* Effect.fail(
            new IncidentInvalidState({
              tenantId: decoded.tenantId,
              incidentId: decoded.incidentId,
            }),
          )
        }

        const now = yield* databaseNow

        // Only the tickets still open are resolved; those already resolved keep their own note.
        yield* database.query(
          (db) =>
            db
              .update(tickets)
              .set({
                status: "resolved",
                resolution: decoded.resolution,
                resolvedAt: now,
                updatedAt: now,
              })
              .where(
                and(
                  eq(tickets.tenantId, decoded.tenantId),
                  eq(tickets.incidentId, decoded.incidentId),
                  inArray(tickets.status, [...unresolved]),
                  isNull(tickets.resolvedAt),
                ),
              ),
          "helpdesk.incident.resolve_tickets",
        )

        yield* database.query(
          (db) =>
            db
              .update(incidents)
              .set({
                status: "resolved",
                resolution: decoded.resolution,
                resolvedAt: now,
                updatedAt: now,
              })
              .where(
                and(eq(incidents.tenantId, decoded.tenantId), eq(incidents.id, decoded.incidentId)),
              ),
          "helpdesk.incident.resolve",
        )

        return yield* incidentOf(decoded.tenantId, decoded.incidentId, false)
      }),
      "helpdesk.incident.resolve.atomic",
    )
  })

  const getIncident = Effect.fn("HelpdeskService.getIncident")(function* (
    input: Schema.Codec.Encoded<typeof GetIncidentInput>,
  ) {
    const decoded = yield* authorized(GetIncidentInput, HelpdeskCapabilities.ticketRead)(input)

    return yield* incidentOf(decoded.tenantId, decoded.incidentId, false)
  })

  return {
    createTicket,
    getTicket,
    listMine,
    queue,
    assign,
    transition,
    resolve,
    close,
    reopen,
    createIncident,
    linkTicket,
    resolveIncident,
    getIncident,
  } satisfies HelpdeskService
})

export const HelpdeskLive = Layer.effect(HelpdeskService, makeHelpdeskService)
