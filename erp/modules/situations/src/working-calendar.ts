import { and, asc, eq } from "drizzle-orm"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import { nonWorkingDays, workingCalendars } from "../../../../db/schema/situations.ts"
import {
  Database,
  type DatabaseFailure,
  InstantString,
  Uuid,
} from "../../../../framework/foundation/mod.ts"
import { addWorkingDays } from "./calendar.ts"
import { calendarOf } from "./calendar-store.ts"

export const DueAfterInput = Schema.Struct({
  tenantId: Uuid,
  legalEntityId: Uuid,
  from: InstantString,
  workingDays: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 365 })),
})

/**
 * The working calendar of a legal entity as a port other modules call after they have authorized
 * their own caller, the way numbering is called (ADR-0132). It returns dates only; it holds no
 * business fact of the caller's.
 */
export interface WorkingCalendar {
  /** The instant `workingDays` working days after `from`, at the same time of day (UTC). */
  readonly dueAfter: (
    input: Schema.Codec.Encoded<typeof DueAfterInput>,
  ) => Effect.Effect<string, DatabaseFailure | Schema.SchemaError>
}

export const WorkingCalendar = Context.Service<WorkingCalendar>("RITSEI/WorkingCalendar")

export const makeWorkingCalendar = Effect.gen(function* () {
  const database = yield* Database

  const dueAfter = Effect.fn("WorkingCalendar.dueAfter")(function* (
    input: Schema.Codec.Encoded<typeof DueAfterInput>,
  ) {
    const decoded = yield* Schema.decodeUnknownEffect(DueAfterInput)(input)

    const header = (yield* database.query(
      (db) =>
        db
          .select()
          .from(workingCalendars)
          .where(
            and(
              eq(workingCalendars.tenantId, decoded.tenantId),
              eq(workingCalendars.legalEntityId, decoded.legalEntityId),
            ),
          ),
      "situations.calendar.header",
    ))[0]

    const days = yield* database.query(
      (db) =>
        db
          .select()
          .from(nonWorkingDays)
          .where(
            and(
              eq(nonWorkingDays.tenantId, decoded.tenantId),
              eq(nonWorkingDays.legalEntityId, decoded.legalEntityId),
            ),
          )
          .orderBy(asc(nonWorkingDays.day)),
      "situations.calendar.non_working",
    )

    const calendar = calendarOf(header, days)

    return addWorkingDays(
      new Date(decoded.from),
      decoded.workingDays,
      calendar.weekdays,
      calendar.nonWorkingDays,
    ).toISOString()
  })

  return { dueAfter } satisfies WorkingCalendar
})

export const WorkingCalendarLive = Layer.effect(WorkingCalendar, makeWorkingCalendar)
