import * as Layer from "effect/Layer"
import type { Sql } from "postgres"

import { Database } from "../../framework/foundation/mod.ts"
import { makeAuthorizationTestLayer } from "../../framework/modules/authorization/mod.ts"
import { NumberingLive } from "../../framework/modules/numbering/mod.ts"
import { makePostgresDatabase } from "../../framework/platform/mod.ts"
import { GeneralLedgerLive } from "../../erp/modules/accounting/mod.ts"
import { StockKeepingLive } from "../../erp/modules/inventory/mod.ts"
import { ProductLive } from "../../erp/modules/product/mod.ts"

type Grant = {
  readonly userAccountId: string
  readonly tenantId: string
  readonly capability: string
}

/**
 * The PostgreSQL-backed services an ERP chain test composes: platform, authorization with the given
 * grants, numbering, the general ledger, products, and stock keeping.
 */
export const erpChainLayers = (client: Sql, grants: ReadonlyArray<Grant>) => {
  const database = Layer.succeed(Database, makePostgresDatabase(client))
  const authorization = makeAuthorizationTestLayer(
    grants as Parameters<typeof makeAuthorizationTestLayer>[0],
  )
  const platform = Layer.mergeAll(database, authorization)
  const numbering = NumberingLive.pipe(Layer.provide(database))
  const ledger = GeneralLedgerLive.pipe(Layer.provide(Layer.merge(platform, numbering)))
  const product = ProductLive.pipe(Layer.provide(platform))
  const stock = StockKeepingLive.pipe(Layer.provide(Layer.mergeAll(platform, ledger, product)))
  return Layer.mergeAll(platform, numbering, ledger, product, stock)
}
