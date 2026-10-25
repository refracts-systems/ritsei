import { and, eq } from "drizzle-orm"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"

import { products } from "../../../../db/schema/product.ts"
import { Database } from "../../../../framework/foundation/mod.ts"
import {
  type OwnerCustomFields,
  ownerCustomFieldsLayer,
} from "../../../../framework/modules/custom-fields/mod.ts"
import { ProductCapabilities } from "./capabilities.ts"
import { ProductNotFound } from "./errors.ts"

/** Custom fields on a product, released through the product manifest (ADR-0109). */
export type ProductFields = OwnerCustomFields<ProductNotFound>

export const ProductFields = Context.Service<ProductFields>("RITSEI/ProductFields")

export const ProductFieldsLive = ownerCustomFieldsLayer(
  ProductFields,
  Effect.gen(function* () {
    const database = yield* Database

    return {
      documentType: "product.product",
      configure: ProductCapabilities.customFieldConfigure,
      read: ProductCapabilities.productRead,
      write: ProductCapabilities.productCreate,
      exists: (tenantId: string, productId: string) =>
        database
          .query(
            (db) =>
              db
                .select({ id: products.id })
                .from(products)
                .where(and(eq(products.tenantId, tenantId), eq(products.id, productId)))
                .limit(1),
            "product.product.exists",
          )
          .pipe(
            Effect.flatMap((rows) =>
              rows.length === 0
                ? Effect.fail(new ProductNotFound({ tenantId, productId }))
                : Effect.void,
            ),
          ),
    }
  }),
)
