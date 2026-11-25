import { addWorkingDays } from "./calendar.ts"

export type Severity = "low" | "medium" | "high"

export type CalendarDays = {
  readonly weekdays: ReadonlyArray<number>
  readonly nonWorkingDays: ReadonlySet<string>
}

/** The three situations detected from data that exists today (ADR-0129). */
export const SituationTypes = ["receivable_overdue", "bill_mismatch", "approval_waiting"] as const

export type SituationType = (typeof SituationTypes)[number]

/** One to 30 days past due is medium, beyond that high. */
export const receivableSeverity = (daysOverdue: number): Severity =>
  daysOverdue > 30 ? "high" : "medium"

/** A bill that differs from what was received is medium, high when the gap needs an approval. */
export const mismatchSeverity = (gapNeedsApproval: boolean): Severity =>
  gapNeedsApproval ? "high" : "medium"

/** A request waiting past its SLA is medium, high when its amount is in the policy's last step. */
export const approvalSeverity = (reachesLastStep: boolean): Severity =>
  reachesLastStep ? "high" : "medium"

/** Working days before an untaken situation goes to the flow owner: one when high, else two. */
export const firstEscalationDays = (severity: Severity) => (severity === "high" ? 1 : 2)

/** Working days from the flow owner being told to the supervisor being told. */
export const secondEscalationDays = 2

/** When a situation first escalates, counted from when it was detected. */
export const firstEscalationDue = (severity: Severity, detectedAt: Date, calendar: CalendarDays) =>
  addWorkingDays(
    detectedAt,
    firstEscalationDays(severity),
    calendar.weekdays,
    calendar.nonWorkingDays,
  )

/**
 * What escalating a situation that is due does: the next level and when the next step falls due
 * (null after the last), counted from the instant it was due so a late run does not drift.
 */
export const nextEscalation = (level: number, due: Date, calendar: CalendarDays) =>
  level === 0
    ? {
        level: 1,
        due: addWorkingDays(due, secondEscalationDays, calendar.weekdays, calendar.nonWorkingDays),
      }
    : { level: 2, due: null }
