import * as Schema from "effect/Schema"

/** Schema primitives that module contracts share instead of redefining. */

export const Uuid = Schema.String.check(Schema.isUUID())

/** Trimmed, nonblank text of at most `maximum` characters. */
export const TrimmedText = (maximum: number) =>
  Schema.String.check(
    Schema.makeFilter(
      (value) => /\S/.test(value) && value === value.trim() && value.length <= maximum,
      { expected: `a trimmed nonblank text of at most ${maximum} characters` },
    ),
  )

/** Trimmed, nonblank, uppercase code of at most `maximum` characters. */
export const UpperCode = (maximum: number) =>
  Schema.String.check(
    Schema.makeFilter(
      (value) =>
        /\S/.test(value) &&
        value === value.trim() &&
        value === value.toUpperCase() &&
        value.length <= maximum,
      { expected: `a trimmed uppercase code of at most ${maximum} characters` },
    ),
  )

const MAX_BIGINT = 9_223_372_036_854_775_807n

/** A positive whole quantity that fits PostgreSQL `bigint`, as a decimal string. */
export const PositiveQuantity = Schema.String.check(
  Schema.makeFilter((value) => /^[1-9]\d*$/.test(value) && BigInt(value) <= MAX_BIGINT, {
    expected: "a positive PostgreSQL bigint quantity",
  }),
)

/** A non-negative whole quantity that fits PostgreSQL `bigint`, as a decimal string. */
export const NonNegativeQuantity = Schema.String.check(
  Schema.makeFilter((value) => /^(0|[1-9]\d*)$/.test(value) && BigInt(value) <= MAX_BIGINT, {
    expected: "a non-negative PostgreSQL bigint quantity",
  }),
)

/** A signed exact amount with two decimals; positive is a debit balance. */
export const SignedAmount = Schema.String.check(Schema.isPattern(/^-?\d{1,20}\.\d{2}$/))

/** A dotted lowercase name owned by a module, such as `billing.customer_invoice`. */
export const DottedName = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_.]*$/))
