import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  type DatabaseFailure,
  Uuid,
  TrimmedText,
  UpperCode,
} from "../../../../framework/foundation/mod.ts"
import { Principal } from "../../../../framework/modules/auth/mod.ts"
import type { AuthorizationDenied } from "../../../../framework/modules/authorization/mod.ts"
import type { ProductAlreadyExists, ProductNotFound } from "./errors.ts"

const Name = TrimmedText(256)
const Code = UpperCode(64)
const ScopedInput = { principal: Principal, tenantId: Uuid }

/** Stockable products keep stock in Inventory; consumables and services never do. */
export const ProductType = Schema.Literals(["stockable", "consumable", "service"])
export type ProductType = Schema.Schema.Type<typeof ProductType>
export const UnitOfMeasure = Schema.String.check(Schema.isPattern(/^[A-Z][A-Z0-9_-]*$/))

export const Product = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  code: Code,
  name: Name,
  type: ProductType,
  category: Schema.NullOr(Name),
  unitOfMeasure: UnitOfMeasure,
  active: Schema.Boolean,
})
export type Product = Schema.Schema.Type<typeof Product>

export const ListProductsInput = Schema.Struct({
  ...ScopedInput,
  search: Schema.optionalKey(Name),
  type: Schema.optionalKey(ProductType),
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 }))),
})
export const GetProductInput = Schema.Struct({ ...ScopedInput, productId: Uuid })
export const CreateProductInput = Schema.Struct({
  ...ScopedInput,
  /** Upper-cased on input; unique per tenant. */
  code: Name,
  name: Name,
  type: ProductType,
  category: Schema.optionalKey(Name),
  unitOfMeasure: Schema.optionalKey(UnitOfMeasure),
})
export type ListProductsCommand = Schema.Schema.Type<typeof ListProductsInput>
export type CreateProductCommand = Omit<Schema.Schema.Type<typeof CreateProductInput>, "principal">

type CommonFailure = AuthorizationDenied | DatabaseFailure | Schema.SchemaError

export interface ProductService {
  readonly listProducts: (
    input: Schema.Codec.Encoded<typeof ListProductsInput>,
  ) => Effect.Effect<ReadonlyArray<Product>, CommonFailure>
  readonly getProduct: (
    input: Schema.Codec.Encoded<typeof GetProductInput>,
  ) => Effect.Effect<Product, ProductNotFound | CommonFailure>
  readonly createProduct: (
    input: Schema.Codec.Encoded<typeof CreateProductInput>,
  ) => Effect.Effect<Product, ProductAlreadyExists | CommonFailure>
}

export const ProductService = Context.Service<ProductService>("RITSEI/ProductService")
