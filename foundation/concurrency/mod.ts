import * as Context from "effect/Context"
import * as Schema from "effect/Schema"

const NonEmptyString = Schema.String.check(Schema.isPattern(/\S/))
const DecimalInteger = Schema.String.check(Schema.isPattern(/^(0|[1-9][0-9]*)$/))

/** Exact decimal representation of a non-negative PostgreSQL BIGINT generation. */
export const LeaseGeneration = DecimalInteger

export const FencingContext = Schema.Struct({
  scope: NonEmptyString,
  generation: LeaseGeneration,
})

export type FencingContext = Schema.Schema.Type<typeof FencingContext>

export interface FencingContextService extends FencingContext {}

export const FencingContextService = Context.Service<FencingContextService>("RITSEI/FencingContext")
