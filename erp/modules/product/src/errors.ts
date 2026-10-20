import * as Schema from "effect/Schema"

const Uuid = Schema.String.check(Schema.isUUID())

export class ProductAlreadyExists extends Schema.TaggedError<ProductAlreadyExists>()(
  "ProductAlreadyExists",
  { tenantId: Uuid, code: Schema.String },
) {}

export class ProductNotFound extends Schema.TaggedError<ProductNotFound>()("ProductNotFound", {
  tenantId: Uuid,
  productId: Uuid,
}) {}
