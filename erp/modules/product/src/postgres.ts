import { and, asc, eq, ilike, or } from "drizzle-orm"
import * as Effect from "effect/Effect"

import { products } from "../../../../db/schema/product.ts"
import { Database, isDatabaseConstraint } from "../../../../framework/foundation/mod.ts"
import { ProductAlreadyExists } from "./errors.ts"
import type { ProductStore } from "./store.ts"

const selection = {
  id: products.id,
  tenantId: products.tenantId,
  code: products.code,
  name: products.name,
  type: products.type,
  category: products.category,
  unitOfMeasure: products.unitOfMeasure,
  active: products.active,
}

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (match) => `\\${match}`)

export const makeProductPostgresStore = Effect.fn("Product.makePostgresStore")(function* () {
  const database = yield* Database

  return {
    listProducts: (command) =>
      database.query((db) => {
        const pattern = command.search === undefined ? undefined : `%${escapeLike(command.search)}%`

        return db
          .select(selection)
          .from(products)
          .where(
            and(
              eq(products.tenantId, command.tenantId),
              command.type === undefined ? undefined : eq(products.type, command.type),
              pattern === undefined
                ? undefined
                : or(ilike(products.code, pattern), ilike(products.name, pattern)),
            ),
          )
          .orderBy(asc(products.code))
          .limit(command.limit ?? 200)
      }, "product.product.list"),
    getProduct: (tenantId, productId) =>
      database
        .query(
          (db) =>
            db
              .select(selection)
              .from(products)
              .where(and(eq(products.tenantId, tenantId), eq(products.id, productId))),
          "product.product.get",
        )
        .pipe(Effect.map((rows) => rows[0])),
    createProduct: (command) =>
      database
        .query(
          (db) =>
            db
              .insert(products)
              .values({
                tenantId: command.tenantId,
                code: command.code,
                name: command.name,
                type: command.type,
                category: command.category ?? null,
                unitOfMeasure: command.unitOfMeasure ?? "EA",
              })
              .returning(selection),
          "product.product.create",
        )
        .pipe(
          Effect.map((rows) => rows[0]!),
          Effect.mapError((error) =>
            isDatabaseConstraint(error, "products_tenant_code_key")
              ? new ProductAlreadyExists({ tenantId: command.tenantId, code: command.code })
              : error,
          ),
        ),
  } satisfies ProductStore
})
