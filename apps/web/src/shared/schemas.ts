import * as Schema from "effect/Schema"

/** Browser-side shapes shared by feature services that mirror backend transport fields. */
export const Uuid = Schema.String.check(Schema.isUUID())
export const CalendarDate = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/))

/** An exact decimal string, signed because balances and credit documents can be negative. */
export const Amount = Schema.String.check(Schema.isPattern(/^-?\d+(\.\d+)?$/))
