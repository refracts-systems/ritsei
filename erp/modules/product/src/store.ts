import type * as Effect from "effect/Effect"

import type { DatabaseFailure } from "../../../../framework/foundation/mod.ts"
import type { CreateProductCommand, ListProductsCommand, Product } from "./contract.ts"
import type { ProductAlreadyExists } from "./errors.ts"

export interface ProductStore {
  readonly listProducts: (
    command: ListProductsCommand,
  ) => Effect.Effect<ReadonlyArray<Product>, DatabaseFailure>
  readonly getProduct: (
    tenantId: string,
    productId: string,
  ) => Effect.Effect<Product | undefined, DatabaseFailure>
  readonly createProduct: (
    command: CreateProductCommand,
  ) => Effect.Effect<Product, ProductAlreadyExists | DatabaseFailure>
}
