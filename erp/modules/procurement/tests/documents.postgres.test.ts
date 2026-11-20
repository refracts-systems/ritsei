import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import { uuidv7 } from "../../../../framework/foundation/mod.ts"
import {
  ApprovalCapabilities,
  ApprovalService,
} from "../../../../framework/modules/approvals/mod.ts"
import { AuthorizationDenied } from "../../../../framework/modules/authorization/mod.ts"
import { runMigrations } from "../../../../framework/platform/mod.ts"
import { seedErpFixture } from "../../../../tests/support/erp-fixture.ts"
import { erpChainLayers } from "../../../../tests/support/erp-layers.ts"
import { withTemporaryDatabase } from "../../../../tests/support/postgres-database.ts"
import { AccountingCapabilities, GeneralLedgerService } from "../../accounting/mod.ts"
import { InventoryCapabilities, StockKeepingService } from "../../inventory/mod.ts"
import { PartyCapabilities, PartyService } from "../../party/mod.ts"
import { ProductCapabilities, ProductService } from "../../product/mod.ts"
import { TaxCapabilities, TaxService } from "../../tax/mod.ts"
import {
  ProcurementCapabilities,
  ProcurementService,
  PurchaseDocumentService,
  PurchaseLineNotStockable,
  PurchaseOrderInvalidState,
  SupplierPriceNotFound,
} from "../mod.ts"

const databaseUrl = process.env["DATABASE_URL"]
const buyer = { userAccountId: "purchase-docs-buyer", sessionId: "purchase-docs-buyer-session" }
const outsider = { userAccountId: "purchase-docs-outsider", sessionId: "purchase-docs-outsider" }

// [PRC-PRICE-1] [PRC-DRAFT-1] [PRC-REL-1] [PRC-VRCPT-1] [PRC-RET-1] [PRC-AUTH-1]
it.effect.skipIf(databaseUrl === undefined)(
  "refuses unpriced and service lines, unconfirmed receipts, and callers without capability",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const { tenantId, legalEntityId } = yield* seedErpFixture(client)

        const [warehouse] = yield* Effect.promise(
          () => client<{ id: string }[]>`
            insert into inventory.warehouses (tenant_id, legal_entity_id, name)
            values (${tenantId}, ${legalEntityId}, 'Main') returning id
          `,
        )

        const grants = [
          ...Object.values(AccountingCapabilities),
          ...Object.values(ApprovalCapabilities),
          ...Object.values(InventoryCapabilities),
          ...Object.values(PartyCapabilities),
          ...Object.values(ProcurementCapabilities),
          ...Object.values(ProductCapabilities),
          ...Object.values(TaxCapabilities),
        ].map((capability) => ({ userAccountId: buyer.userAccountId, tenantId, capability }))

        yield* Effect.gen(function* () {
          const ledger = yield* GeneralLedgerService
          const party = yield* PartyService
          const products = yield* ProductService
          const stock = yield* StockKeepingService
          const tax = yield* TaxService
          const procurement = yield* ProcurementService
          const purchasing = yield* PurchaseDocumentService
          const approvals = yield* ApprovalService
          const scope = { principal: buyer, tenantId }

          yield* ledger.applyChartTemplate({ ...scope, legalEntityId, template: "neutral_trading" })
          const vendor = yield* party.create({ ...scope, kind: "organization", name: "PT Vendor" })
          yield* party.assignRole({ ...scope, partyId: vendor.id, role: "supplier" })

          const relationship = yield* party.createRelationship({
            ...scope,
            partyId: vendor.id,
            legalEntityId,
            kind: "supplier",
          })

          const supplier = yield* procurement.createSupplierAccount({
            ...scope,
            supplierRelationshipId: relationship.id,
          })

          const widget = yield* products.createProduct({
            ...scope,
            code: "WIDGET",
            name: "Widget",
            type: "stockable",
          })

          const unpriced = yield* products.createProduct({
            ...scope,
            code: "UNPRICED",
            name: "Unpriced",
            type: "stockable",
          })

          const service = yield* products.createProduct({
            ...scope,
            code: "SERVICE",
            name: "Service",
            type: "service",
          })

          const inputVat = yield* tax.createTaxCode({
            ...scope,
            code: "IN11",
            name: "Input VAT 11%",
            rate: "11",
            direction: "purchase",
          })

          for (const product of [widget, unpriced]) {
            yield* stock.registerProductItem({ ...scope, productId: product.id })
            yield* tax.setProductTaxDefault({
              ...scope,
              productId: product.id,
              direction: "purchase",
              taxCodeId: inputVat.id,
            })
          }

          // Without the capability, no supplier price is set.
          const denied = yield* Effect.flip(
            purchasing.setSupplierPrice({
              principal: outsider,
              tenantId,
              supplierAccountId: supplier.id,
              productId: widget.id,
              unitPrice: "5.00",
            }),
          )

          assert.instanceOf(denied, AuthorizationDenied)
          yield* purchasing.setSupplierPrice({
            ...scope,
            supplierAccountId: supplier.id,
            productId: widget.id,
            unitPrice: "5.00",
          })

          // Only stockable, priced lines are drafted.
          const serviceLine = yield* Effect.flip(
            purchasing.draftPurchaseOrder({
              ...scope,
              supplierAccountId: supplier.id,
              lines: [{ productId: service.id, quantity: "1", unitPrice: "1.00" }],
            }),
          )

          assert.instanceOf(serviceLine, PurchaseLineNotStockable)

          const unpricedLine = yield* Effect.flip(
            purchasing.draftPurchaseOrder({
              ...scope,
              supplierAccountId: supplier.id,
              lines: [{ productId: unpriced.id, quantity: "1" }],
            }),
          )

          assert.instanceOf(unpricedLine, SupplierPriceNotFound)

          // A total equal to the threshold needs no approval and releases directly.
          yield* approvals.configurePolicy({
            ...scope,
            subjectType: "procurement.purchase_order",
            threshold: "500.00",
            approverCapability: ProcurementCapabilities.purchaseOrderApprove,
          })

          const drafted = yield* purchasing.draftPurchaseOrder({
            ...scope,
            supplierAccountId: supplier.id,
            lines: [{ productId: widget.id, quantity: "100" }],
          })

          assert.strictEqual(drafted.total, "500.00")
          assert.strictEqual(drafted.approval, null)

          // A draft order receives nothing.
          const view = yield* purchasing.getMatching({
            ...scope,
            purchaseOrderId: drafted.purchaseOrderId,
          })

          const lineId = view.lines[0]!.purchaseOrderLineId

          const draftReceipt = yield* Effect.flip(
            purchasing.receiveValued({
              ...scope,
              purchaseOrderId: drafted.purchaseOrderId,
              warehouseId: warehouse!.id,
              receiptDate: "2026-10-03",
              lines: [{ purchaseOrderLineId: lineId, quantity: "1" }],
            }),
          )

          assert.instanceOf(draftReceipt, PurchaseOrderInvalidState)

          const released = yield* purchasing.releasePurchaseOrder({
            ...scope,
            purchaseOrderId: drafted.purchaseOrderId,
            idempotencyKey: `release-${drafted.purchaseOrderId}`,
          })

          assert.strictEqual(released.status, "confirmed")

          // A repeated receipt or return id returns the recorded document.
          const receiptId = uuidv7()

          const receipt = {
            ...scope,
            receiptId,
            purchaseOrderId: drafted.purchaseOrderId,
            warehouseId: warehouse!.id,
            receiptDate: "2026-10-03",
            lines: [{ purchaseOrderLineId: lineId, quantity: "10" }],
          }

          const received = yield* purchasing.receiveValued(receipt)
          const receivedAgain = yield* purchasing.receiveValued(receipt)
          assert.strictEqual(receivedAgain.number, received.number)
          assert.strictEqual(received.stock.lines[0]!.value, "50.00")

          const ret = {
            ...scope,
            returnId: uuidv7(),
            purchaseOrderId: drafted.purchaseOrderId,
            warehouseId: warehouse!.id,
            returnDate: "2026-10-04",
            lines: [{ purchaseOrderLineId: lineId, quantity: "2" }],
          }

          const returned = yield* purchasing.returnToSupplier(ret)
          const returnedAgain = yield* purchasing.returnToSupplier(ret)
          assert.strictEqual(returnedAgain.number, returned.number)

          const after = yield* purchasing.getMatching({
            ...scope,
            purchaseOrderId: drafted.purchaseOrderId,
          })

          assert.deepStrictEqual([after.lines[0]!.received, after.lines[0]!.returned], ["10", "2"])
        }).pipe(Effect.provide(erpChainLayers(client, grants)))
      }),
    ),
  { timeout: 180_000 },
)
