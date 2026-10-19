import * as Schema from "effect/Schema"

const IsoTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

export const InstantString = Schema.String.check(
  Schema.isPattern(IsoTimestamp),
  Schema.makeFilter((value) => !Number.isNaN(new Date(value).getTime()), {
    expected: "an ISO 8601 timestamp with a timezone",
  }),
)
