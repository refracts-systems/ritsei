import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import type { ExternalSchema } from "./contract.ts"

class InvalidExternalSchema extends Error {
  constructor() {
    super("external catalog schema is not executable")
  }
}

/** Decode only schemas with no hidden decoding services. */
export const decodeExternalSchema = (
  schema: ExternalSchema,
  input: Schema.Codec.Encoded<typeof schema>,
) =>
  Effect.suspend(() => {
    if (!Schema.isSchema(schema)) return Effect.fail(new InvalidExternalSchema())

    try {
      return Schema.decodeUnknownEffect(schema)(input)
    } catch {
      return Effect.fail(new InvalidExternalSchema())
    }
  }).pipe(
    Effect.catchCause((cause) =>
      Cause.hasDies(cause) ? Effect.fail(new InvalidExternalSchema()) : Effect.failCause(cause),
    ),
  )
