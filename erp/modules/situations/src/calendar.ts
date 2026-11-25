/** Monday is 1 and Sunday is 7, for the UTC date of an instant. */
const isoWeekday = (instant: Date) => ((instant.getUTCDay() + 6) % 7) + 1

const dayOf = (instant: Date) => instant.toISOString().slice(0, 10)

/** Whether the UTC date of an instant is a working day of a calendar. */
export const isWorkingDay = (
  instant: Date,
  weekdays: ReadonlyArray<number>,
  nonWorkingDays: ReadonlySet<string>,
) => weekdays.includes(isoWeekday(instant)) && !nonWorkingDays.has(dayOf(instant))

/**
 * The instant `days` working days after `from`, at the same time of day (UTC). Days that are not
 * working days are skipped and do not count.
 */
export const addWorkingDays = (
  from: Date,
  days: number,
  weekdays: ReadonlyArray<number>,
  nonWorkingDays: ReadonlySet<string>,
) => {
  // A calendar with no working weekday would never finish.
  if (weekdays.length === 0) return from

  let current = new Date(from)
  let remaining = days

  for (let guard = 0; remaining > 0 && guard < 3650; guard += 1) {
    current = new Date(current.getTime() + 86_400_000)

    if (isWorkingDay(current, weekdays, nonWorkingDays)) remaining -= 1
  }

  return current
}

/** The instant `days` working days before `from`, the mirror of `addWorkingDays`. */
export const subtractWorkingDays = (
  from: Date,
  days: number,
  weekdays: ReadonlyArray<number>,
  nonWorkingDays: ReadonlySet<string>,
) => {
  if (weekdays.length === 0) return from

  let current = new Date(from)
  let remaining = days

  for (let guard = 0; remaining > 0 && guard < 3650; guard += 1) {
    current = new Date(current.getTime() - 86_400_000)

    if (isWorkingDay(current, weekdays, nonWorkingDays)) remaining -= 1
  }

  return current
}
