import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import {
  nonWorkingDays,
  situationFollows,
  situationInbox,
  situations,
  workingCalendars,
} from "../../../../db/schema/situations.ts"
import { type DatabaseFailure, Database, uuidv7 } from "../../../../framework/foundation/mod.ts"
import type { AuthorizationDenied } from "../../../../framework/modules/authorization/mod.ts"
import { ApprovalService } from "../../../../framework/modules/approvals/mod.ts"
import {
  AuthorizationService,
  scopedCommand,
} from "../../../../framework/modules/authorization/mod.ts"
import { MessagingService } from "../../../../framework/modules/messaging/mod.ts"
import { BillingService } from "../../billing/mod.ts"
import { SettlementService } from "../../settlement/mod.ts"
import { subtractWorkingDays } from "./calendar.ts"
import { calendarOf, type CalendarRow, type LoadedCalendar } from "./calendar-store.ts"
import { SituationsCapabilities } from "./capabilities.ts"
import {
  AdvanceInput,
  AssignSituationsInput,
  type Calendar,
  ConfigureCalendarInput,
  DetectInput,
  type Detection,
  type Follow,
  FollowInput,
  GetCalendarInput,
  type InboxItem,
  ListFollowsInput,
  ListInboxInput,
  ListSituationsInput,
  MarkReadInput,
  type Situation,
  SituationsService,
  UnfollowInput,
} from "./contract.ts"
import {
  CalendarInvalid,
  FollowNotAllowed,
  FollowNotFound,
  OwnerNotEligible,
  SituationNotFound,
} from "./errors.ts"
import { SituationEscalatedEvent, SituationOpenedEvent, SituationResolvedEvent } from "./events.ts"
import {
  approvalSeverity,
  firstEscalationDue,
  mismatchSeverity,
  nextEscalation,
  receivableSeverity,
  type Severity,
  type SituationType,
} from "./rules.ts"

type Row = typeof situations.$inferSelect

const statusFilter = (status: "open" | "resolved" | undefined) => {
  if (status === "open") return isNull(situations.resolvedAt)

  return status === "resolved" ? sql`${situations.resolvedAt} is not null` : undefined
}

type ReadFailure = AuthorizationDenied | DatabaseFailure | Schema.SchemaError

const toSituation = (row: Row): Situation => ({
  id: row.id,
  tenantId: row.tenantId,
  legalEntityId: row.legalEntityId,
  // SAFETY: the type column is constrained to the three detected types.
  type: row.type as SituationType,
  subjectType: row.subjectType,
  subjectId: row.subjectId,
  severity: row.severity,
  ownerId: row.ownerId,
  escalationLevel: row.escalationLevel,
  escalationDueAt: row.escalationDueAt?.toISOString() ?? null,
  detectedAt: row.detectedAt.toISOString(),
  resolvedAt: row.resolvedAt?.toISOString() ?? null,
})

const SLA_WORKING_DAYS = 2

/** What a detector found: the subjects that need a situation now, and how severe each is. */
type Found = ReadonlyMap<string, { readonly subjectType: string; readonly severity: Severity }>

const consumerId = "situations.inbox.v1"

const eventOf = {
  opened: SituationOpenedEvent,
  escalated: SituationEscalatedEvent,
  resolved: SituationResolvedEvent,
} as const

export const makeSituationsService = Effect.gen(function* () {
  const database = yield* Database
  const authorization = yield* AuthorizationService
  const authorized = scopedCommand(authorization)
  const messaging = yield* MessagingService
  const approvals = yield* ApprovalService
  const billing = yield* BillingService
  const settlement = yield* SettlementService

  /** The database clock is the time authority (ADR-0126); a caller may name an instant to test. */
  const instantOf = (at: string | undefined) =>
    at === undefined
      ? database
          .query((db) => db.execute(sql`select now()::text as now`), "situations.clock")
          .pipe(Effect.map((rows) => new Date(String(rows[0]?.["now"]))))
      : Effect.succeed(new Date(at))

  const loadCalendar = (tenantId: string, legalEntityId: string) =>
    Effect.gen(function* () {
      const header = (yield* database.query(
        (db) =>
          db
            .select()
            .from(workingCalendars)
            .where(
              and(
                eq(workingCalendars.tenantId, tenantId),
                eq(workingCalendars.legalEntityId, legalEntityId),
              ),
            ),
        "situations.calendar.get",
      ))[0]

      const days = yield* database.query(
        (db) =>
          db
            .select()
            .from(nonWorkingDays)
            .where(
              and(
                eq(nonWorkingDays.tenantId, tenantId),
                eq(nonWorkingDays.legalEntityId, legalEntityId),
              ),
            )
            .orderBy(asc(nonWorkingDays.day)),
        "situations.calendar.days",
      )

      return calendarOf(header, days satisfies ReadonlyArray<CalendarRow>)
    })

  /** Delivers one event to the people it concerns, once: its followers, and any extra recipients. */
  const deliver = Effect.fn("SituationsService.deliver")(function* (
    row: Row,
    kind: "opened" | "escalated" | "resolved",
    eventId: string,
    extraRecipients: ReadonlyArray<string>,
  ) {
    const followers = yield* database.query(
      (db) =>
        db
          .select({ userId: situationFollows.userId })
          .from(situationFollows)
          .where(
            and(
              eq(situationFollows.tenantId, row.tenantId),
              or(
                eq(situationFollows.flowType, row.type),
                and(
                  eq(situationFollows.subjectType, row.subjectType),
                  eq(situationFollows.subjectId, row.subjectId),
                ),
              ),
            ),
          ),
      "situations.follows.matching",
    )

    // A follower who can no longer read is not told: following was never a right.
    const readers: Array<string> = []

    for (const userId of new Set(followers.map((follower) => follower.userId))) {
      const allowed = yield* authorization
        .authorize({
          principal: { userAccountId: userId, sessionId: "notification" },
          tenantId: row.tenantId,
          capability: SituationsCapabilities.situationRead,
        })
        .pipe(
          Effect.as(true),
          Effect.catchTag("AuthorizationDenied", () => Effect.succeed(false)),
        )

      if (allowed) readers.push(userId)
    }

    const recipients = [...new Set([...readers, ...extraRecipients])]

    if (recipients.length === 0) return

    yield* database.query(
      (db) =>
        db
          .insert(situationInbox)
          .values(
            recipients.map((userId) => ({
              tenantId: row.tenantId,
              userId,
              situationId: row.id,
              eventId,
              kind,
              severity: row.severity,
              escalationLevel: row.escalationLevel,
            })),
          )
          .onConflictDoNothing(),
      "situations.inbox.deliver",
    )
  })

  /** Publishes the event through Messaging and has the inbox consumer deliver it once. */
  const publish = Effect.fn("SituationsService.publish")(function* (
    principalId: string,
    row: Row,
    kind: "opened" | "escalated" | "resolved",
    occurredAt: Date,
    extraRecipients: ReadonlyArray<string>,
  ) {
    const eventId = uuidv7()

    const entry = eventOf[kind]

    yield* messaging.append({
      eventId,
      eventType: entry.id,
      eventVersion: entry.version,
      tenantId: row.tenantId,
      aggregateType: entry.aggregateType,
      aggregateId: row.id,
      commandId: uuidv7(),
      correlationId: row.id,
      causationId: null,
      // One event per situation, kind, and level, so a repeated run publishes nothing new.
      idempotencyKey: `${row.id}:${kind}:${row.escalationLevel}`,
      actorPrincipalId: principalId,
      occurredAt: occurredAt.toISOString(),
      payload: {
        situationId: row.id,
        type: row.type,
        severity: row.severity,
        escalationLevel: row.escalationLevel,
      },
    })

    yield* messaging.consumeOnce(
      { tenantId: row.tenantId, consumerId, eventId },
      deliver(row, kind, eventId, extraRecipients),
    )
  })

  const holdersOf = (tenantId: string, capability: string) =>
    authorization.listCapabilityHolders({
      tenantId,
      // SAFETY: callers pass only capabilities of SituationsCapabilities, which are registered.
      capability: capability as Parameters<
        typeof authorization.listCapabilityHolders
      >[0]["capability"],
    })

  /** What each detector reads from its owner, as the subjects that need a situation. */
  const receivables = (scope: Scope, at: Date) =>
    settlement
      .listOverdueReceivables({ ...scope, asOf: at.toISOString().slice(0, 10) })
      .pipe(
        Effect.map(
          (items): Found =>
            new Map(
              items.map((item) => [
                item.invoiceId,
                { subjectType: "billing.document", severity: receivableSeverity(item.daysOverdue) },
              ]),
            ),
        ),
      )

  const mismatches = (scope: Scope) =>
    Effect.gen(function* () {
      const bills = yield* billing.listBillMismatches(scope)
      const found = new Map<string, { subjectType: string; severity: Severity }>()

      for (const bill of bills) {
        const gap = bill.difference.replace(/^-/, "")

        const needsApproval = yield* approvals.isRequired({
          principal: scope.principal,
          tenantId: scope.tenantId,
          subjectType: "billing.supplier_bill_variance",
          amount: gap,
        })

        found.set(bill.invoiceId, {
          subjectType: "billing.document",
          severity: mismatchSeverity(needsApproval),
        })
      }

      // SAFETY: the map holds exactly the entries built above.
      return found as Found
    })

  const waitingApprovals = (scope: Scope, at: Date, calendar: LoadedCalendar) =>
    approvals
      .listWaiting({
        principal: scope.principal,
        tenantId: scope.tenantId,
        olderThan: waitingCutoff(at, calendar).toISOString(),
      })
      .pipe(
        Effect.map(
          (items): Found =>
            new Map(
              items.map((item) => [
                item.requestId,
                {
                  subjectType: "approvals.request",
                  severity: approvalSeverity(item.reachesLastStep),
                },
              ]),
            ),
        ),
      )

  type Scope = {
    readonly principal: Schema.Schema.Type<typeof DetectInput>["principal"]
    readonly tenantId: string
    readonly legalEntityId: string
  }

  /** Opens a situation for a subject that has none; false if another run opened it first. */
  const openOne = Effect.fn("SituationsService.openOne")(function* (
    scope: Scope,
    type: SituationType,
    subjectId: string,
    finding: Found extends ReadonlyMap<string, infer V> ? V : never,
    at: Date,
    calendar: LoadedCalendar,
  ) {
    const [row] = yield* database.query(
      (db) =>
        db
          .insert(situations)
          .values({
            tenantId: scope.tenantId,
            legalEntityId: scope.legalEntityId,
            type,
            subjectType: finding.subjectType,
            subjectId,
            severity: finding.severity,
            detectedAt: at,
            escalationDueAt: firstEscalationDue(finding.severity, at, calendar),
          })
          .onConflictDoNothing()
          .returning(),
      "situations.open.insert",
    )

    if (row === undefined) return false

    yield* publish(scope.principal.userAccountId, row, "opened", at, [])

    return true
  })

  /** Brings an open situation's severity up to date; a situation that turns high is due sooner. */
  const reviseOne = Effect.fn("SituationsService.reviseOne")(function* (
    existing: Row,
    severity: Severity,
    calendar: LoadedCalendar,
  ) {
    const sooner =
      existing.ownerId === null && existing.escalationLevel === 0 && severity === "high"

    yield* database.query(
      (db) =>
        db
          .update(situations)
          .set({
            severity,
            escalationDueAt: sooner
              ? firstEscalationDue("high", existing.detectedAt, calendar)
              : existing.escalationDueAt,
          })
          .where(eq(situations.id, existing.id)),
      "situations.update",
    )
  })

  /** Resolves a situation whose cause is gone; false if it was already resolved. */
  const closeOne = Effect.fn("SituationsService.closeOne")(function* (
    scope: Scope,
    row: Row,
    at: Date,
  ) {
    const [closed] = yield* database.query(
      (db) =>
        db
          .update(situations)
          .set({ resolvedAt: at, escalationDueAt: null })
          .where(and(eq(situations.id, row.id), isNull(situations.resolvedAt)))
          .returning(),
      "situations.resolve",
    )

    if (closed === undefined) return false

    yield* publish(scope.principal.userAccountId, closed, "resolved", at, [])

    return true
  })

  const detectType = Effect.fn("SituationsService.detectType")(function* (
    scope: Scope,
    type: SituationType,
    found: Found,
    at: Date,
    calendar: LoadedCalendar,
  ) {
    const open = yield* database.query(
      (db) =>
        db
          .select()
          .from(situations)
          .where(
            and(
              eq(situations.tenantId, scope.tenantId),
              eq(situations.legalEntityId, scope.legalEntityId),
              eq(situations.type, type),
              isNull(situations.resolvedAt),
            ),
          ),
      "situations.open",
    )

    const byKey = new Map(open.map((row) => [row.subjectId, row]))
    let opened = 0
    let updated = 0
    let resolved = 0

    for (const [subjectId, finding] of found) {
      const existing = byKey.get(subjectId)

      if (existing === undefined) {
        if (yield* openOne(scope, type, subjectId, finding, at, calendar)) opened += 1
      } else if (existing.severity !== finding.severity) {
        yield* reviseOne(existing, finding.severity, calendar)
        updated += 1
      }
    }

    for (const row of open) {
      if (!found.has(row.subjectId) && (yield* closeOne(scope, row, at))) resolved += 1
    }

    return { type, status: "ran" as const, opened, updated, resolved }
  })

  const detect = Effect.fn("SituationsService.detect")(function* (
    input: Schema.Codec.Encoded<typeof DetectInput>,
  ) {
    const decoded = yield* authorized(DetectInput, SituationsCapabilities.situationDetect)(input)
    const at = yield* instantOf(decoded.at)
    const calendar = yield* loadCalendar(decoded.tenantId, decoded.legalEntityId)

    const scope: Scope = {
      principal: decoded.principal,
      tenantId: decoded.tenantId,
      legalEntityId: decoded.legalEntityId,
    }

    // An owner that denies the caller leaves its type untouched: with no read, nothing is known.
    const run = (type: SituationType, read: Effect.Effect<Found, ReadFailure>) =>
      read.pipe(
        Effect.flatMap((found) => detectType(scope, type, found, at, calendar)),
        Effect.catchTag("AuthorizationDenied", () =>
          Effect.succeed({
            type,
            status: "denied" as const,
            opened: 0,
            updated: 0,
            resolved: 0,
          }),
        ),
      )

    const outcomes = [
      yield* run("receivable_overdue", receivables(scope, at)),
      yield* run("bill_mismatch", mismatches(scope)),
      yield* run("approval_waiting", waitingApprovals(scope, at, calendar)),
    ]

    return {
      legalEntityId: decoded.legalEntityId,
      at: at.toISOString(),
      outcomes,
    } satisfies Detection
  })

  /** Raises one due situation a level and tells the role it now goes to; false if it moved first. */
  const escalateOne = Effect.fn("SituationsService.escalateOne")(function* (
    row: Row,
    calendar: LoadedCalendar,
    at: Date,
    principalId: string,
  ) {
    const step = nextEscalation(row.escalationLevel, row.escalationDueAt!, calendar)

    const [raised] = yield* database.query(
      (db) =>
        db
          .update(situations)
          .set({ escalationLevel: step.level, escalationDueAt: step.due })
          .where(
            and(
              eq(situations.id, row.id),
              eq(situations.escalationLevel, row.escalationLevel),
              isNull(situations.ownerId),
              isNull(situations.resolvedAt),
            ),
          )
          .returning(),
      "situations.escalation.raise",
    )

    // Someone else moved it first: nothing to publish, and the run stays a no-op.
    if (raised === undefined) return false

    const holders = yield* holdersOf(
      row.tenantId,
      step.level === 1 ? SituationsCapabilities.flowOwn : SituationsCapabilities.flowSupervise,
    )

    yield* publish(principalId, raised, "escalated", at, holders)

    return true
  })

  const advanceEscalations = Effect.fn("SituationsService.advanceEscalations")(function* (
    input: Schema.Codec.Encoded<typeof AdvanceInput>,
  ) {
    const decoded = yield* authorized(AdvanceInput, SituationsCapabilities.situationDetect)(input)
    const at = yield* instantOf(decoded.at)
    const calendar = yield* loadCalendar(decoded.tenantId, decoded.legalEntityId)
    let escalated = 0

    // A situation can be more than one step behind, so keep going while one is due.
    for (let pass = 0; pass < 2; pass += 1) {
      const due = yield* database.query(
        (db) =>
          db
            .select()
            .from(situations)
            .where(
              and(
                eq(situations.tenantId, decoded.tenantId),
                eq(situations.legalEntityId, decoded.legalEntityId),
                isNull(situations.resolvedAt),
                isNull(situations.ownerId),
                lte(situations.escalationDueAt, at),
              ),
            )
            .orderBy(asc(situations.escalationDueAt))
            .limit(200),
        "situations.escalation.due",
      )

      if (due.length === 0) break

      for (const row of due) {
        if (yield* escalateOne(row, calendar, at, decoded.principal.userAccountId)) escalated += 1
      }
    }

    return { legalEntityId: decoded.legalEntityId, at: at.toISOString(), escalated }
  })

  const list = Effect.fn("SituationsService.list")(function* (
    input: Schema.Codec.Encoded<typeof ListSituationsInput>,
  ) {
    const decoded = yield* authorized(
      ListSituationsInput,
      SituationsCapabilities.situationRead,
    )(input)

    const rows = yield* database.query(
      (db) =>
        db
          .select()
          .from(situations)
          .where(
            and(
              eq(situations.tenantId, decoded.tenantId),
              decoded.legalEntityId === undefined
                ? undefined
                : eq(situations.legalEntityId, decoded.legalEntityId),
              decoded.type === undefined ? undefined : eq(situations.type, decoded.type),
              decoded.ownerId === undefined ? undefined : eq(situations.ownerId, decoded.ownerId),
              statusFilter(decoded.status),
            ),
          )
          .orderBy(desc(situations.detectedAt), desc(situations.id))
          .limit(decoded.limit ?? 100),
      "situations.list",
    )

    return rows.map(toSituation)
  })

  const assign = Effect.fn("SituationsService.assign")(function* (
    input: Schema.Codec.Encoded<typeof AssignSituationsInput>,
  ) {
    const decoded = yield* authorized(
      AssignSituationsInput,
      SituationsCapabilities.situationAssign,
    )(input)

    const eligible = yield* holdersOf(decoded.tenantId, SituationsCapabilities.flowOwn)

    if (!eligible.includes(decoded.ownerId)) {
      return yield* Effect.fail(
        new OwnerNotEligible({ tenantId: decoded.tenantId, ownerId: decoded.ownerId }),
      )
    }

    const ids = [...new Set(decoded.situationIds)]

    // One transaction: either every situation is taken or none is.
    return yield* database.withTransaction(
      Effect.gen(function* () {
        const found = yield* database.query(
          (db) =>
            db
              .select()
              .from(situations)
              .where(
                and(
                  eq(situations.tenantId, decoded.tenantId),
                  inArray(situations.id, ids),
                  isNull(situations.resolvedAt),
                ),
              )
              .for("update"),
          "situations.assign.lock",
        )

        const missing = ids.find((id) => !found.some((row) => row.id === id))

        if (missing !== undefined) {
          return yield* Effect.fail(
            new SituationNotFound({ tenantId: decoded.tenantId, situationId: missing }),
          )
        }

        // Taking a situation ends its escalation; its level stays as history.
        const taken = yield* database.query(
          (db) =>
            db
              .update(situations)
              .set({ ownerId: decoded.ownerId, escalationDueAt: null })
              .where(and(eq(situations.tenantId, decoded.tenantId), inArray(situations.id, ids)))
              .returning(),
          "situations.assign",
        )

        return taken.toSorted((left, right) => left.id.localeCompare(right.id)).map(toSituation)
      }),
      "situations.assign.atomic",
    )
  })

  const configureCalendar = Effect.fn("SituationsService.configureCalendar")(function* (
    input: Schema.Codec.Encoded<typeof ConfigureCalendarInput>,
  ) {
    const decoded = yield* authorized(
      ConfigureCalendarInput,
      SituationsCapabilities.calendarConfigure,
    )(input)

    const weekdays = [...new Set(decoded.weekdays)].toSorted()

    if (weekdays.length === 0) {
      return yield* Effect.fail(
        new CalendarInvalid({
          tenantId: decoded.tenantId,
          reason: "at least one weekday must be a working day",
        }),
      )
    }

    yield* database.withTransaction(
      Effect.gen(function* () {
        yield* database.query(
          (db) =>
            db
              .insert(workingCalendars)
              .values({
                tenantId: decoded.tenantId,
                legalEntityId: decoded.legalEntityId,
                weekdays,
              })
              .onConflictDoUpdate({
                target: [workingCalendars.tenantId, workingCalendars.legalEntityId],
                set: { weekdays },
              }),
          "situations.calendar.set",
        )

        yield* database.query(
          (db) =>
            db
              .delete(nonWorkingDays)
              .where(
                and(
                  eq(nonWorkingDays.tenantId, decoded.tenantId),
                  eq(nonWorkingDays.legalEntityId, decoded.legalEntityId),
                ),
              ),
          "situations.calendar.clear",
        )

        if (decoded.nonWorkingDays.length > 0) {
          yield* database.query(
            (db) =>
              db
                .insert(nonWorkingDays)
                .values(
                  decoded.nonWorkingDays.map((entry) => ({
                    tenantId: decoded.tenantId,
                    legalEntityId: decoded.legalEntityId,
                    day: entry.day,
                    name: entry.name,
                  })),
                )
                .onConflictDoNothing(),
            "situations.calendar.days.insert",
          )
        }
      }),
      "situations.calendar.configure.atomic",
    )

    return yield* getCalendarOf(decoded.tenantId, decoded.legalEntityId)
  })

  const getCalendarOf = (tenantId: string, legalEntityId: string) =>
    loadCalendar(tenantId, legalEntityId).pipe(
      Effect.map((calendar): Schema.Schema.Type<typeof Calendar> => ({
        legalEntityId,
        weekdays: calendar.weekdays,
        nonWorkingDays: calendar.days,
      })),
    )

  const getCalendar = Effect.fn("SituationsService.getCalendar")(function* (
    input: Schema.Codec.Encoded<typeof GetCalendarInput>,
  ) {
    const decoded = yield* authorized(GetCalendarInput, SituationsCapabilities.situationRead)(input)

    return yield* getCalendarOf(decoded.tenantId, decoded.legalEntityId)
  })

  const follow = Effect.fn("SituationsService.follow")(function* (
    input: Schema.Codec.Encoded<typeof FollowInput>,
  ) {
    // A user follows only what they can read.
    const decoded = yield* authorized(
      FollowInput,
      SituationsCapabilities.situationRead,
    )(input).pipe(
      Effect.catchTag("AuthorizationDenied", () =>
        Effect.fail(
          new FollowNotAllowed({
            // SAFETY: the input failed authorization, so it was at least an object with a tenant.
            tenantId: (input as { tenantId: string }).tenantId,
            reason: "following needs the right to read situations",
          }),
        ),
      ),
    )

    const [created] = yield* database.query(
      (db) =>
        db
          .insert(situationFollows)
          .values({
            tenantId: decoded.tenantId,
            userId: decoded.principal.userAccountId,
            flowType: decoded.flowType ?? null,
            subjectType: decoded.subjectType ?? null,
            subjectId: decoded.subjectId ?? null,
          })
          .onConflictDoNothing()
          .returning(),
      "situations.follow",
    )

    const row =
      created ??
      (yield* database.query(
        (db) =>
          db
            .select()
            .from(situationFollows)
            .where(
              and(
                eq(situationFollows.tenantId, decoded.tenantId),
                eq(situationFollows.userId, decoded.principal.userAccountId),
                decoded.flowType === undefined
                  ? and(
                      eq(situationFollows.subjectType, decoded.subjectType!),
                      eq(situationFollows.subjectId, decoded.subjectId!),
                    )
                  : eq(situationFollows.flowType, decoded.flowType),
              ),
            ),
        "situations.follow.existing",
      ))[0]!

    return toFollow(row)
  })

  const toFollow = (row: typeof situationFollows.$inferSelect): Follow => ({
    id: row.id,
    userId: row.userId,
    // SAFETY: the flow type column is written only from a decoded situation type.
    flowType: row.flowType as Follow["flowType"],
    subjectType: row.subjectType,
    subjectId: row.subjectId,
  })

  const unfollow = Effect.fn("SituationsService.unfollow")(function* (
    input: Schema.Codec.Encoded<typeof UnfollowInput>,
  ) {
    const decoded = yield* Schema.decodeUnknownEffect(UnfollowInput)(input)

    const removed = yield* database.query(
      (db) =>
        db
          .delete(situationFollows)
          .where(
            and(
              eq(situationFollows.tenantId, decoded.tenantId),
              eq(situationFollows.id, decoded.followId),
              eq(situationFollows.userId, decoded.principal.userAccountId),
            ),
          )
          .returning({ id: situationFollows.id }),
      "situations.unfollow",
    )

    if (removed.length === 0) {
      return yield* Effect.fail(
        new FollowNotFound({ tenantId: decoded.tenantId, followId: decoded.followId }),
      )
    }
  })

  const listFollows = Effect.fn("SituationsService.listFollows")(function* (
    input: Schema.Codec.Encoded<typeof ListFollowsInput>,
  ) {
    const decoded = yield* Schema.decodeUnknownEffect(ListFollowsInput)(input)

    const rows = yield* database.query(
      (db) =>
        db
          .select()
          .from(situationFollows)
          .where(
            and(
              eq(situationFollows.tenantId, decoded.tenantId),
              eq(situationFollows.userId, decoded.principal.userAccountId),
            ),
          )
          .orderBy(asc(situationFollows.createdAt), asc(situationFollows.id)),
      "situations.follows.list",
    )

    return rows.map(toFollow)
  })

  const toItem = (row: typeof situationInbox.$inferSelect): InboxItem => ({
    id: row.id,
    situationId: row.situationId,
    // SAFETY: the kind column is constrained to the three event kinds.
    kind: row.kind as InboxItem["kind"],
    severity: row.severity,
    escalationLevel: row.escalationLevel,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
  })

  const listInbox = Effect.fn("SituationsService.listInbox")(function* (
    input: Schema.Codec.Encoded<typeof ListInboxInput>,
  ) {
    const decoded = yield* Schema.decodeUnknownEffect(ListInboxInput)(input)

    const rows = yield* database.query(
      (db) =>
        db
          .select()
          .from(situationInbox)
          .where(
            and(
              eq(situationInbox.tenantId, decoded.tenantId),
              eq(situationInbox.userId, decoded.principal.userAccountId),
              decoded.unreadOnly === true ? isNull(situationInbox.readAt) : undefined,
            ),
          )
          .orderBy(desc(situationInbox.createdAt), desc(situationInbox.id))
          .limit(200),
      "situations.inbox.list",
    )

    return rows.map(toItem)
  })

  const markRead = Effect.fn("SituationsService.markRead")(function* (
    input: Schema.Codec.Encoded<typeof MarkReadInput>,
  ) {
    const decoded = yield* Schema.decodeUnknownEffect(MarkReadInput)(input)

    const done = yield* database.query(
      (db) =>
        db
          .update(situationInbox)
          .set({ readAt: new Date() })
          .where(
            and(
              eq(situationInbox.tenantId, decoded.tenantId),
              eq(situationInbox.userId, decoded.principal.userAccountId),
              inArray(situationInbox.id, [...decoded.itemIds]),
              isNull(situationInbox.readAt),
            ),
          )
          .returning({ id: situationInbox.id }),
      "situations.inbox.read",
    )

    return done.length
  })

  return {
    detect,
    advanceEscalations,
    list,
    assign,
    configureCalendar,
    getCalendar,
    follow,
    unfollow,
    listFollows,
    listInbox,
    markRead,
  } satisfies SituationsService
})

/** A request is waiting past its SLA when it is older than two working days (ADR-0129). */
const waitingCutoff = (at: Date, calendar: LoadedCalendar) =>
  subtractWorkingDays(at, SLA_WORKING_DAYS, calendar.weekdays, calendar.nonWorkingDays)

export const SituationsLive = Layer.effect(SituationsService, makeSituationsService)
