import * as Schema from "effect/Schema"

import { CalendarDate, PositiveQuantity } from "../../../../framework/foundation/mod.ts"

/** A lot code or a serial: a trimmed string of up to 64 characters, compared exactly (ADR-0131). */
export const TrackingCode = Schema.String.check(
  Schema.makeFilter((value) => value === value.trim() && value.length >= 1 && value.length <= 64, {
    expected: "a trimmed code of 1 to 64 characters",
  }),
)

/**
 * What identifies the stock of a tracked line: lots with their quantities (a new lot may carry its
 * expiry), or the serials, one per unit. An untracked item takes none.
 */
export const StockIdentity = Schema.Struct({
  lots: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        code: TrackingCode,
        quantity: PositiveQuantity,
        expiry: Schema.optionalKey(CalendarDate),
      }),
    ).check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  ),
  serials: Schema.optionalKey(
    Schema.Array(TrackingCode).check(Schema.isMinLength(1), Schema.isMaxLength(1000)),
  ),
})

export type StockIdentity = Schema.Schema.Type<typeof StockIdentity>
