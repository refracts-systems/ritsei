import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { decodeInput, decodeResponse, mutationRequest, requestJson } from "../../shared/api.ts"

const Uuid = Schema.String.check(Schema.isUUID())
const Name = Schema.String.check(Schema.isPattern(/\S/), Schema.isMaxLength(256))

/** Browser view of the Product transport contract served by the product module. */
const ProductType = Schema.Literals(["stockable", "consumable", "service"])
export const Product = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  code: Name,
  name: Name,
  type: ProductType,
  category: Schema.NullOr(Name),
  unitOfMeasure: Schema.String.check(Schema.isPattern(/^[A-Z][A-Z0-9_-]*$/)),
  active: Schema.Boolean,
})
export type Product = Schema.Schema.Type<typeof Product>
const ProductList = Schema.Array(Product).check(Schema.isMaxLength(200))
const CreateProductInput = Schema.Struct({ code: Name, name: Name, type: ProductType })
const route = "/product/products"

export const listProducts = Effect.fn("Frontend.Product.listProducts")(function* () {
  const body = yield* requestJson(route)
  return yield* decodeResponse(ProductList, body)
})

export const createProduct = Effect.fn("Frontend.Product.createProduct")(function* (
  input: unknown,
) {
  const decoded = yield* decodeInput(CreateProductInput, input)
  const body = yield* mutationRequest(route, "POST", decoded)
  return yield* decodeResponse(Product, body, "unknown-outcome")
})
