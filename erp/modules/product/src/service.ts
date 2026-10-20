import * as Effect from "effect/Effect"

import {
  AuthorizationService,
  scopedCommand,
} from "../../../../framework/modules/authorization/mod.ts"
import { ProductCapabilities } from "./capabilities.ts"
import {
  CreateProductInput,
  GetProductInput,
  ListProductsInput,
  type ProductService,
} from "./contract.ts"
import { ProductNotFound } from "./errors.ts"
import type { ProductStore } from "./store.ts"
import type * as Schema from "effect/Schema"

export const makeProductServiceFromStore = <R>(
  storeEffect: Effect.Effect<ProductStore, never, R>,
) =>
  Effect.gen(function* () {
    const store = yield* storeEffect
    const authorization = yield* AuthorizationService
    const authorized = scopedCommand(authorization)

    const listProducts = Effect.fn("ProductService.listProducts")(function* (
      input: Schema.Codec.Encoded<typeof ListProductsInput>,
    ) {
      const decoded = yield* authorized(ListProductsInput, ProductCapabilities.productRead)(input)
      return yield* store.listProducts(decoded)
    })
    const getProduct = Effect.fn("ProductService.getProduct")(function* (
      input: Schema.Codec.Encoded<typeof GetProductInput>,
    ) {
      const decoded = yield* authorized(GetProductInput, ProductCapabilities.productRead)(input)
      const product = yield* store.getProduct(decoded.tenantId, decoded.productId)
      if (product === undefined) {
        return yield* Effect.fail(
          new ProductNotFound({ tenantId: decoded.tenantId, productId: decoded.productId }),
        )
      }
      return product
    })
    const createProduct = Effect.fn("ProductService.createProduct")(function* (
      input: Schema.Codec.Encoded<typeof CreateProductInput>,
    ) {
      const decoded = yield* authorized(
        CreateProductInput,
        ProductCapabilities.productCreate,
      )(input)
      const { principal: _principal, ...command } = decoded
      return yield* store.createProduct({ ...command, code: command.code.toUpperCase() })
    })

    return { listProducts, getProduct, createProduct } satisfies ProductService
  })
