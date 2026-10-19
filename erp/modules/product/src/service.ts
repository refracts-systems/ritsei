import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import type { Principal } from "../../../../framework/modules/auth/mod.ts"
import { AuthorizationService } from "../../../../framework/modules/authorization/mod.ts"
import { ProductCapabilities } from "./capabilities.ts"
import {
  CreateProductInput,
  GetProductInput,
  ListProductsInput,
  type ProductService,
} from "./contract.ts"
import { ProductNotFound } from "./errors.ts"
import type { ProductStore } from "./store.ts"

export const makeProductServiceFromStore = <R>(
  storeEffect: Effect.Effect<ProductStore, never, R>,
) =>
  Effect.gen(function* () {
    const store = yield* storeEffect
    const authorization = yield* AuthorizationService
    const authorize = (
      input: { principal: Schema.Schema.Type<typeof Principal>; tenantId: string },
      capability: string,
    ) =>
      authorization.authorize({ principal: input.principal, tenantId: input.tenantId, capability })

    const listProducts = Effect.fn("ProductService.listProducts")(function* (input: unknown) {
      const decoded = yield* Schema.decodeUnknownEffect(ListProductsInput)(input)
      yield* authorize(decoded, ProductCapabilities.productRead)
      return yield* store.listProducts(decoded)
    })
    const getProduct = Effect.fn("ProductService.getProduct")(function* (input: unknown) {
      const decoded = yield* Schema.decodeUnknownEffect(GetProductInput)(input)
      yield* authorize(decoded, ProductCapabilities.productRead)
      const product = yield* store.getProduct(decoded.tenantId, decoded.productId)
      if (product === undefined) {
        return yield* Effect.fail(
          new ProductNotFound({ tenantId: decoded.tenantId, productId: decoded.productId }),
        )
      }
      return product
    })
    const createProduct = Effect.fn("ProductService.createProduct")(function* (input: unknown) {
      const decoded = yield* Schema.decodeUnknownEffect(CreateProductInput)(input)
      yield* authorize(decoded, ProductCapabilities.productCreate)
      const { principal: _principal, ...command } = decoded
      return yield* store.createProduct({ ...command, code: command.code.toUpperCase() })
    })

    return { listProducts, getProduct, createProduct } satisfies ProductService
  })
