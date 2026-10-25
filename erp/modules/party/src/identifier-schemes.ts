import * as Context from "effect/Context"

/**
 * Value rules for the identifier schemes a localization knows, such as a taxpayer number. The
 * runtime provides it from the installed localizations (ADR-0111); a scheme without a rule is
 * accepted as given.
 */
export interface IdentifierSchemes {
  /** The reason a value is not valid for the scheme, or undefined when it is, or no rule exists. */
  readonly rejection: (input: {
    readonly provider: string
    readonly scheme: string
    readonly value: string
  }) => string | undefined
}

export const IdentifierSchemes = Context.Service<IdentifierSchemes>("RITSEI/IdentifierSchemes")
