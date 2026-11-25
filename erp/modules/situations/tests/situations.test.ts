import { assert, describe, it } from "@effect/vitest"

import { addWorkingDays, isWorkingDay, subtractWorkingDays } from "../src/calendar.ts"
import {
  approvalSeverity,
  firstEscalationDue,
  mismatchSeverity,
  nextEscalation,
  receivableSeverity,
} from "../src/rules.ts"
import { SituationsModule } from "../mod.ts"

const weekdays = [1, 2, 3, 4, 5]
const noHolidays = new Set<string>()

// Friday 2026-10-02 at 09:00 UTC.
const friday = new Date("2026-10-02T09:00:00.000Z")

describe("situations module", () => {
  it("declares its owned schema and deny-by-default capabilities", () => {
    assert.strictEqual(SituationsModule.name, "situations")
    assert.deepStrictEqual(SituationsModule.schemas, ["situations"])
    assert.isAbove(Object.keys(SituationsModule.capabilities).length, 0)
  })

  it("counts only working days, across a weekend", () => {
    // One working day after Friday is Monday; two is Tuesday; the time of day is kept.
    assert.strictEqual(
      addWorkingDays(friday, 1, weekdays, noHolidays).toISOString(),
      "2026-10-05T09:00:00.000Z",
    )

    assert.strictEqual(
      addWorkingDays(friday, 2, weekdays, noHolidays).toISOString(),
      "2026-10-06T09:00:00.000Z",
    )

    assert.isFalse(isWorkingDay(new Date("2026-10-03T00:00:00.000Z"), weekdays, noHolidays))
    assert.strictEqual(addWorkingDays(friday, 0, weekdays, noHolidays).getTime(), friday.getTime())
  })

  it("skips a listed non-working day and honours a different weekly pattern", () => {
    const holiday = new Set(["2026-10-05"])

    assert.strictEqual(
      addWorkingDays(friday, 1, weekdays, holiday).toISOString(),
      "2026-10-06T09:00:00.000Z",
    )

    // A six-day week counts Saturday.
    assert.strictEqual(
      addWorkingDays(friday, 1, [1, 2, 3, 4, 5, 6], noHolidays).toISOString(),
      "2026-10-03T09:00:00.000Z",
    )

    // No working weekday cannot finish, so the instant is unchanged.
    assert.strictEqual(addWorkingDays(friday, 3, [], noHolidays).getTime(), friday.getTime())
  })

  it("subtracts working days as the mirror of adding them", () => {
    const tuesday = new Date("2026-10-06T09:00:00.000Z")

    assert.strictEqual(
      subtractWorkingDays(tuesday, 2, weekdays, noHolidays).toISOString(),
      "2026-10-02T09:00:00.000Z",
    )
  })

  it("grades severity and sets the first escalation by working days", () => {
    assert.strictEqual(receivableSeverity(30), "medium")
    assert.strictEqual(receivableSeverity(31), "high")
    assert.strictEqual(mismatchSeverity(true), "high")
    assert.strictEqual(mismatchSeverity(false), "medium")
    assert.strictEqual(approvalSeverity(true), "high")
    assert.strictEqual(approvalSeverity(false), "medium")

    const calendar = { weekdays, nonWorkingDays: noHolidays }

    // Detected on Friday: high escalates after one working day, others after two.
    assert.strictEqual(
      firstEscalationDue("high", friday, calendar).toISOString(),
      "2026-10-05T09:00:00.000Z",
    )

    assert.strictEqual(
      firstEscalationDue("medium", friday, calendar).toISOString(),
      "2026-10-06T09:00:00.000Z",
    )
  })

  it("moves from the owner to the supervisor, counting from the due time", () => {
    const calendar = { weekdays, nonWorkingDays: noHolidays }
    const due = new Date("2026-10-06T09:00:00.000Z")

    const first = nextEscalation(0, due, calendar)
    assert.strictEqual(first.level, 1)
    assert.strictEqual(first.due?.toISOString(), "2026-10-08T09:00:00.000Z")

    // After the supervisor there is nothing further to escalate to.
    assert.deepStrictEqual(nextEscalation(1, due, calendar), { level: 2, due: null })
  })
})
