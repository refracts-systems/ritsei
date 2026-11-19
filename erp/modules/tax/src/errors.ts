import * as Schema from "effect/Schema"

const Uuid = Schema.String.check(Schema.isUUID())

export class TaxCodeAlreadyExists extends Schema.TaggedError<TaxCodeAlreadyExists>()(
  "TaxCodeAlreadyExists",
  { tenantId: Uuid, code: Schema.String },
) {}

/** The tax code does not exist, is inactive, or applies to the other direction. */
export class TaxCodeNotFound extends Schema.TaggedError<TaxCodeNotFound>()("TaxCodeNotFound", {
  tenantId: Uuid,
  taxCodeId: Uuid,
}) {}

export class TaxProductNotFound extends Schema.TaggedError<TaxProductNotFound>()(
  "TaxProductNotFound",
  { tenantId: Uuid, productId: Uuid },
) {}

/** The tax code already has a rate period starting on that date; periods are never changed. */
export class TaxCodeRateAlreadyExists extends Schema.TaggedError<TaxCodeRateAlreadyExists>()(
  "TaxCodeRateAlreadyExists",
  { tenantId: Uuid, taxCodeId: Uuid, effectiveFrom: Schema.String },
) {}
