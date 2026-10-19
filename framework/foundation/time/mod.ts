import * as Schema from "effect/Schema"

const IsoTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

export const InstantString = Schema.String.check(
  Schema.isPattern(IsoTimestamp),
  Schema.makeFilter((value) => !Number.isNaN(new Date(value).getTime()), {
    expected: "an ISO 8601 timestamp with a timezone",
  }),
)

/** A valid ISO 8601 calendar date (`YYYY-MM-DD`) without a time or zone. */
export const CalendarDate = Schema.String.check(
  Schema.makeFilter(
    (value) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
      const date = new Date(`${value}T00:00:00.000Z`)
      return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    },
    { expected: "a valid ISO calendar date" },
  ),
)
export type CalendarDate = Schema.Schema.Type<typeof CalendarDate>

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export const daysBetween = (from: CalendarDate, to: CalendarDate): number =>
  Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000)

/** The calendar date `days` days after `date`. */
export const addDays = (date: CalendarDate, days: number): CalendarDate =>
  new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10)
