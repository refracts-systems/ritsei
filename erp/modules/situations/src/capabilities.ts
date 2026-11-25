// Deny by default: a tenant administrator must grant each capability before it takes effect.
export const SituationsCapabilities = {
  situationRead: "situations.situation.read",
  situationAssign: "situations.situation.assign",
  situationDetect: "situations.situation.detect",
  /** The flow owner: may take situations, and is told when nobody has (ADR-0129). */
  flowOwn: "situations.flow.own",
  /** The supervisor: told when the flow owner has not acted either. */
  flowSupervise: "situations.flow.supervise",
  calendarConfigure: "situations.calendar.configure",
} as const
