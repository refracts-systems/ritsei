import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type { RequestFailure } from "./api.ts"
import { decodeResponse, querySuffix, requestJson } from "./api.ts"
import { Warehouse, inventoryRoutes } from "./contracts/generated/inventory.ts"
import { PartyDirectoryEntry, partyRoutes } from "./contracts/generated/party.ts"
import { type ApiScope, runRequest } from "./runtime.ts"
import { createServerQuery } from "./server-query.ts"
import { Uuid } from "./schemas.ts"

/** Browser view of the Product transport contract, for pickers and for naming product ids. */
const Product = Schema.Struct({
  id: Uuid,
  code: Schema.String,
  name: Schema.String,
  type: Schema.Literals(["stockable", "consumable", "service"]),
})

export type Product = Schema.Schema.Type<typeof Product>

const ProductList = Schema.Array(Product).check(Schema.isMaxLength(200))
const PartyDirectory = Schema.Array(PartyDirectoryEntry).check(Schema.isMaxLength(200))
const WarehouseList = Schema.Array(Warehouse).check(Schema.isMaxLength(200))

export const listProducts = Effect.fn("Frontend.Lookups.listProducts")(function* () {
  const body = yield* requestJson(`/product/products${querySuffix({ limit: 200 })}`)

  return yield* decodeResponse(ProductList, body)
})

export const listWarehouses = Effect.fn("Frontend.Lookups.listWarehouses")(function* () {
  const body = yield* requestJson(`${inventoryRoutes.listWarehouses}${querySuffix({ limit: 200 })}`)

  return yield* decodeResponse(WarehouseList, body)
})

/** Products for pickers; names are a convenience, so a failed load leaves the list empty. */
export function createProductsQuery(scope: ApiScope) {
  return createServerQuery<readonly Product[], RequestFailure>({
    tenantId: scope.tenantId,
    key: ["lookups", "products"],
    cache: "lookup",
    load: ({ signal }) =>
      runRequest(scope, listProducts().pipe(Effect.catch(() => Effect.succeed([]))), signal),
  })
}

export function createWarehousesQuery(scope: ApiScope) {
  return createServerQuery<Schema.Schema.Type<typeof WarehouseList>, RequestFailure>({
    tenantId: scope.tenantId,
    key: ["lookups", "warehouses"],
    cache: "lookup",
    load: ({ signal }) => runRequest(scope, listWarehouses(), signal),
  })
}

export const listPartyDirectory = Effect.fn("Frontend.Lookups.listPartyDirectory")(function* () {
  const body = yield* requestJson(`${partyRoutes.list}${querySuffix({ limit: 200 })}`)

  return yield* decodeResponse(PartyDirectory, body)
})

/** Party names for display; a failed load leaves identifiers in place. */
export function createPartyDirectoryQuery(scope: ApiScope) {
  return createServerQuery<readonly PartyDirectoryEntry[], RequestFailure>({
    tenantId: scope.tenantId,
    key: ["lookups", "party_directory"],
    cache: "lookup",
    load: ({ signal }) =>
      runRequest(scope, listPartyDirectory().pipe(Effect.catch(() => Effect.succeed([]))), signal),
  })
}
