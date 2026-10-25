import * as Layer from "effect/Layer"
import type { Sql } from "postgres"

import { Database } from "../../framework/foundation/mod.ts"
import { makeAuthorizationTestLayer } from "../../framework/modules/authorization/mod.ts"
import { NumberingLive } from "../../framework/modules/numbering/mod.ts"
import { ApprovalsLive } from "../../framework/modules/approvals/mod.ts"
import { CustomFieldsLive, customFieldPointsOf } from "../../framework/modules/custom-fields/mod.ts"
import { makePostgresDatabase } from "../../framework/platform/mod.ts"
import {
  AccountingFiscalCalendarLive,
  GeneralLedgerLive,
} from "../../erp/modules/accounting/mod.ts"
import { StockKeepingLive } from "../../erp/modules/inventory/mod.ts"
import { BillingCreditExposureLive, BillingLive } from "../../erp/modules/billing/mod.ts"
import { DocumentsLive } from "../../erp/modules/documents/mod.ts"
import { PartyLive } from "../../erp/modules/party/mod.ts"
import { OrderToCashLive } from "../../erp/modules/process/mod.ts"
import { SettlementLive } from "../../erp/modules/settlement/mod.ts"
import { ProductFieldsLive, ProductLive } from "../../erp/modules/product/mod.ts"
import { ProcurementLive, PurchaseDocumentsLive } from "../../erp/modules/procurement/mod.ts"
import { InventoryLive } from "../../erp/modules/inventory/mod.ts"
import {
  SalesCustomerFieldsLive,
  SalesDocumentsLive,
  SalesLive,
} from "../../erp/modules/sales/mod.ts"
import { TaxLive } from "../../erp/modules/tax/mod.ts"
import { makeMessagingService, MessagingService } from "../../framework/modules/messaging/mod.ts"

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
    // SAFETY: the grants have the shape the test layer takes.
    grants as Parameters<typeof makeAuthorizationTestLayer>[0],
  )

  const platform = Layer.mergeAll(database, authorization)

  const numbering = NumberingLive.pipe(
    Layer.provide(
      Layer.merge(database, AccountingFiscalCalendarLive.pipe(Layer.provide(database))),
    ),
  )

  const ledger = GeneralLedgerLive.pipe(Layer.provide(Layer.merge(platform, numbering)))
  const product = ProductLive.pipe(Layer.provide(platform))

  const customFields = CustomFieldsLive.pipe(
    Layer.provide(
      Layer.merge(platform, customFieldPointsOf(["sales.customer", "product.product"])),
    ),
  )

  const salesCustomerFields = SalesCustomerFieldsLive.pipe(
    Layer.provide(Layer.merge(platform, customFields)),
  )

  const productFields = ProductFieldsLive.pipe(Layer.provide(Layer.merge(platform, customFields)))
  const stock = StockKeepingLive.pipe(Layer.provide(Layer.mergeAll(platform, ledger, product)))

  const messaging = Layer.effect(MessagingService, makeMessagingService).pipe(
    Layer.provide(database),
  )

  const party = PartyLive.pipe(Layer.provide(Layer.mergeAll(platform, messaging)))
  const tax = TaxLive.pipe(Layer.provide(platform))

  const creditExposure = BillingCreditExposureLive.pipe(Layer.provide(platform))

  const sales = SalesDocumentsLive.pipe(
    Layer.provide(Layer.mergeAll(platform, party, tax, numbering, creditExposure)),
  )

  const legacySales = SalesLive.pipe(
    Layer.provide(Layer.mergeAll(platform, messaging, creditExposure)),
  )

  const approvals = ApprovalsLive.pipe(Layer.provide(platform))
  const inventory = InventoryLive.pipe(Layer.provide(Layer.merge(platform, messaging)))

  const procurement = ProcurementLive.pipe(
    Layer.provide(Layer.mergeAll(platform, party, inventory, messaging, approvals)),
  )

  const purchasing = PurchaseDocumentsLive.pipe(
    Layer.provide(
      Layer.mergeAll(platform, approvals, numbering, party, product, tax, stock, procurement),
    ),
  )

  const billing = BillingLive.pipe(
    Layer.provide(
      Layer.mergeAll(platform, ledger, numbering, tax, sales, product, purchasing, approvals),
    ),
  )

  const settlement = SettlementLive.pipe(
    Layer.provide(Layer.mergeAll(platform, ledger, billing, numbering)),
  )

  const documents = DocumentsLive.pipe(
    Layer.provide(Layer.mergeAll(legacySales, sales, procurement, purchasing, billing, settlement)),
  )

  const orderToCash = OrderToCashLive.pipe(
    Layer.provide(Layer.mergeAll(platform, sales, stock, product)),
  )

  return Layer.mergeAll(
    platform,
    numbering,
    ledger,
    product,
    stock,
    messaging,
    party,
    tax,
    sales,
    legacySales,
    billing,
    settlement,
    approvals,
    inventory,
    procurement,
    purchasing,
    documents,
    orderToCash,
    customFields,
    salesCustomerFields,
    productFields,
  )
}
