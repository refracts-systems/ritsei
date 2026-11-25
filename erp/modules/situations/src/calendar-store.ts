import type { CalendarDays } from "./rules.ts"

/** Monday to Friday count until a legal entity says otherwise (ADR-0129). */
export const defaultWeekdays: ReadonlyArray<number> = [1, 2, 3, 4, 5]

export type CalendarRow = { readonly day: string; readonly name: string }

export type LoadedCalendar = CalendarDays & {
  readonly days: ReadonlyArray<CalendarRow>
}

export const calendarOf = (
  header: { readonly weekdays: ReadonlyArray<number> } | undefined,
  days: ReadonlyArray<CalendarRow>,
): LoadedCalendar => ({
  weekdays: header?.weekdays ?? defaultWeekdays,
  nonWorkingDays: new Set(days.map((entry) => entry.day)),
  days: days.map((entry) => ({ day: entry.day, name: entry.name })),
})
