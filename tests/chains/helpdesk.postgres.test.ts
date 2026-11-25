import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import { uuidv7 } from "../../framework/foundation/mod.ts"
import { runMigrations } from "../../framework/platform/mod.ts"
import { runExtensionMigrations } from "../../erp/runtime/migrator/extensions.ts"
import { HelpdeskCapabilities, HelpdeskService } from "../../extensions/helpdesk/mod.ts"
import { seedErpFixture } from "../support/erp-fixture.ts"
import { erpChainLayers } from "../support/erp-layers.ts"
import { postgresConstraint } from "../support/postgres-error.ts"
import { withTemporaryDatabase } from "../support/postgres-database.ts"

const databaseUrl = process.env["DATABASE_URL"]
const person = (name: string) => ({ userAccountId: name, sessionId: `${name}-session` })
const requester = person("hd-requester")
const agent = person("hd-agent")
const lead = person("hd-lead")
const other = person("hd-other")

// ADR-0132: tickets with a working-day due date, an assignee, and incidents that group them.
it.effect.skipIf(databaseUrl === undefined)(
  "runs a ticket from request to close and groups tickets under an incident",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)

        // The core chain alone leaves no helpdesk objects; the extension chain adds them (ADR-0136).
        const before = yield* Effect.promise(
          () => client`select 1 from pg_namespace where nspname = 'helpdesk'`,
        )

        assert.lengthOf(before, 0)
        yield* runExtensionMigrations(client)
        yield* runExtensionMigrations(client)

        const journal = yield* Effect.promise(
          () => client`select name from system.extension_migrations_helpdesk`,
        )

        assert.lengthOf(journal, 1)

        const coreJournal = yield* Effect.promise(
          () => client`select 1 from system.schema_migrations where name like '%helpdesk%'`,
        )

        assert.lengthOf(coreJournal, 0)
        const { tenantId, legalEntityId } = yield* seedErpFixture(client)

        const grant = (who: { userAccountId: string }, ...capabilities: ReadonlyArray<string>) =>
          capabilities.map((capability) => ({
            userAccountId: who.userAccountId,
            tenantId,
            capability,
          }))

        const grants = [
          ...grant(requester, HelpdeskCapabilities.ticketCreate),
          ...grant(agent, HelpdeskCapabilities.ticketRead, HelpdeskCapabilities.ticketResolve),
          ...grant(lead, ...Object.values(HelpdeskCapabilities)),
          ...grant(other, HelpdeskCapabilities.ticketCreate),
        ]

        yield* Effect.gen(function* () {
          const helpdesk = yield* HelpdeskService
          const scope = { tenantId }

          // ---- Requesting: numbered, due in working days, never about an approval.
          const ticket = yield* helpdesk.createTicket({
            ...scope,
            principal: requester,
            legalEntityId,
            title: "Printer rusak",
            priority: "high",
          })

          assert.strictEqual(ticket.status, "open")
          assert.match(ticket.number, /^HD\//)
          assert.isFalse(ticket.breached)
          assert.isAbove(Date.parse(ticket.dueAt), Date.parse(ticket.createdAt))
          assert.isBelow(Date.parse(ticket.dueAt), Date.parse(ticket.createdAt) + 6 * 86_400_000)

          const second = yield* helpdesk.createTicket({
            ...scope,
            principal: requester,
            legalEntityId,
            title: "Second",
          })

          assert.notStrictEqual(second.number, ticket.number)

          assert.strictEqual(
            (yield* Effect.flip(
              helpdesk.createTicket({
                ...scope,
                principal: requester,
                legalEntityId,
                title: "Approve it",
                subjectType: "approvals.request",
                subjectId: uuidv7(),
              }),
            ))._tag,
            "TicketSubjectRefused",
          )

          assert.strictEqual(
            (yield* Effect.flip(helpdesk.queue({ ...scope, principal: requester })))._tag,
            "AuthorizationDenied",
          )

          // ---- Visibility: one's own tickets, else read right; a stranger sees nothing.
          assert.deepStrictEqual(
            (yield* helpdesk.listMine({ ...scope, principal: requester }))
              .map((t) => t.id)
              .toSorted(),
            [ticket.id, second.id].toSorted(),
          )
          assert.lengthOf(yield* helpdesk.listMine({ ...scope, principal: other }), 0)
          assert.strictEqual(
            (yield* Effect.flip(
              helpdesk.getTicket({ ...scope, principal: other, ticketId: ticket.id }),
            ))._tag,
            "TicketNotFound",
          )
          assert.strictEqual(
            (yield* helpdesk.getTicket({ ...scope, principal: agent, ticketId: ticket.id })).id,
            ticket.id,
          )

          // ---- Working it: assignment needs the assign right, the assignee moves it along.
          assert.strictEqual(
            (yield* Effect.flip(
              helpdesk.assign({
                ...scope,
                principal: agent,
                ticketId: ticket.id,
                assignee: agent.userAccountId,
              }),
            ))._tag,
            "AuthorizationDenied",
          )

          const assigned = yield* helpdesk.assign({
            ...scope,
            principal: lead,
            ticketId: ticket.id,
            assignee: agent.userAccountId,
          })

          assert.strictEqual(assigned.status, "in_progress")
          assert.strictEqual(assigned.assignee, agent.userAccountId)

          const waiting = yield* helpdesk.transition({
            ...scope,
            principal: agent,
            ticketId: ticket.id,
            to: "waiting",
          })

          assert.strictEqual(waiting.status, "waiting")

          assert.strictEqual(
            (yield* Effect.flip(
              helpdesk.transition({
                ...scope,
                principal: other,
                ticketId: ticket.id,
                to: "in_progress",
              }),
            ))._tag,
            "TicketNotFound",
          )

          // ---- Overdue is the database clock against the due instant.
          yield* Effect.promise(
            () =>
              client`update helpdesk.tickets set due_at = now() - interval '1 hour' where id = ${ticket.id}`,
          )

          assert.isTrue(
            (yield* helpdesk.getTicket({ ...scope, principal: agent, ticketId: ticket.id }))
              .breached,
          )

          const queue = yield* helpdesk.queue({ ...scope, principal: agent })
          assert.strictEqual(queue[0]?.id, ticket.id)

          // ---- Resolve, close, and the requester's right to reopen.
          const resolved = yield* helpdesk.resolve({
            ...scope,
            principal: agent,
            ticketId: ticket.id,
            resolution: "Toner diganti",
          })

          assert.strictEqual(resolved.status, "resolved")
          assert.isFalse(resolved.breached)
          assert.isNotNull(resolved.resolvedAt)

          assert.strictEqual(
            (yield* Effect.flip(
              helpdesk.resolve({
                ...scope,
                principal: agent,
                ticketId: ticket.id,
                resolution: "again",
              }),
            ))._tag,
            "TicketInvalidState",
          )

          const reopened = yield* helpdesk.reopen({
            ...scope,
            principal: requester,
            ticketId: ticket.id,
          })

          assert.strictEqual(reopened.status, "open")
          assert.isNull(reopened.resolution)

          yield* helpdesk.resolve({
            ...scope,
            principal: agent,
            ticketId: ticket.id,
            resolution: "Final",
          })

          const closed = yield* helpdesk.close({
            ...scope,
            principal: requester,
            ticketId: ticket.id,
          })

          assert.strictEqual(closed.status, "closed")

          assert.strictEqual(
            (yield* Effect.flip(
              helpdesk.close({ ...scope, principal: requester, ticketId: ticket.id }),
            ))._tag,
            "TicketInvalidState",
          )

          // ---- Incidents: tickets link to one incident; resolving it resolves the open ones.
          const incident = yield* helpdesk.createIncident({
            ...scope,
            principal: lead,
            title: "Jaringan mati",
          })

          assert.strictEqual(incident.status, "open")

          const linked = yield* helpdesk.linkTicket({
            ...scope,
            principal: lead,
            incidentId: incident.id,
            ticketId: second.id,
          })

          assert.deepStrictEqual(linked.ticketIds, [second.id])

          const other2 = yield* helpdesk.createIncident({
            ...scope,
            principal: lead,
            title: "Lain",
          })

          assert.strictEqual(
            (yield* Effect.flip(
              helpdesk.linkTicket({
                ...scope,
                principal: lead,
                incidentId: other2.id,
                ticketId: second.id,
              }),
            ))._tag,
            "TicketAlreadyInIncident",
          )

          assert.strictEqual(
            (yield* Effect.flip(
              helpdesk.createIncident({ ...scope, principal: agent, title: "Not allowed" }),
            ))._tag,
            "AuthorizationDenied",
          )

          const done = yield* helpdesk.resolveIncident({
            ...scope,
            principal: lead,
            incidentId: incident.id,
            resolution: "Switch diganti",
          })

          assert.strictEqual(done.status, "resolved")

          const after = yield* helpdesk.getTicket({
            ...scope,
            principal: requester,
            ticketId: second.id,
          })

          assert.strictEqual(after.status, "resolved")
          assert.strictEqual(after.resolution, "Switch diganti")

          assert.strictEqual(
            (yield* Effect.flip(
              helpdesk.resolveIncident({
                ...scope,
                principal: lead,
                incidentId: incident.id,
                resolution: "x",
              }),
            ))._tag,
            "IncidentInvalidState",
          )

          // ---- The database refuses an approval subject whatever the service does.
          const direct = yield* Effect.tryPromise({
            try: () =>
              client`update helpdesk.tickets set subject_type = 'approvals.request', subject_id = ${uuidv7()} where id = ${second.id}`,
            catch: (cause) => cause,
          }).pipe(Effect.flip)

          assert.strictEqual(postgresConstraint(direct), "tickets_subject_not_approval_check")
        }).pipe(Effect.provide(erpChainLayers(client, grants)))
      }),
    ),
  { timeout: 300_000 },
)
