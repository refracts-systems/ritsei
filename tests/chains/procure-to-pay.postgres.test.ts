import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import { uuidv7 } from "../../framework/foundation/mod.ts"
import {
  ApprovalCapabilities,
  ApprovalService,
  SelfApprovalForbidden,
} from "../../framework/modules/approvals/mod.ts"
import { runMigrations } from "../../framework/platform/mod.ts"
import { AccountingCapabilities, GeneralLedgerService } from "../../erp/modules/accounting/mod.ts"
import {
  BillExceedsReceipt,
  BillingCapabilities,
  BillingService,
  BillVarianceSubject,
} from "../../erp/modules/billing/mod.ts"
import { DocumentsService } from "../../erp/modules/documents/mod.ts"
import { InventoryCapabilities, StockKeepingService } from "../../erp/modules/inventory/mod.ts"
import { PartyCapabilities, PartyService } from "../../erp/modules/party/mod.ts"
import {
  ProcurementCapabilities,
  ProcurementService,
  PurchaseDocumentService,
  PurchaseOrderApprovalRequired,
  PurchaseReceiptQuantityExceeded,
  PurchaseReturnExceedsReceipt,
} from "../../erp/modules/procurement/mod.ts"
import { ProductCapabilities, ProductService } from "../../erp/modules/product/mod.ts"
import { SettlementCapabilities, SettlementService } from "../../erp/modules/settlement/mod.ts"
import { TaxCapabilities, TaxService } from "../../erp/modules/tax/mod.ts"
import { seedErpFixture } from "../support/erp-fixture.ts"
import { erpChainLayers } from "../support/erp-layers.ts"
import { withTemporaryDatabase } from "../support/postgres-database.ts"

const databaseUrl = process.env["DATABASE_URL"]
const buyer = { userAccountId: "p2p-buyer", sessionId: "p2p-buyer-session" }
const approver = { userAccountId: "p2p-approver", sessionId: "p2p-approver-session" }

it.effect.skipIf(databaseUrl === undefined)(
  "approves, receives, returns, bills with a three-way match, pays, and reconciles",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const fixture = yield* seedErpFixture(client)
        const { tenantId, legalEntityId } = fixture

        const [warehouse] = yield* Effect.promise(
          () => client<{ id: string }[]>`
            insert into inventory.warehouses (tenant_id, legal_entity_id, name)
            values (${tenantId}, ${legalEntityId}, 'Main') returning id
          `,
        )

        const capabilities = [
          ...Object.values(AccountingCapabilities),
          ...Object.values(ApprovalCapabilities),
          ...Object.values(BillingCapabilities),
          ...Object.values(InventoryCapabilities),
          ...Object.values(PartyCapabilities),
          ...Object.values(ProcurementCapabilities),
          ...Object.values(ProductCapabilities),
          ...Object.values(SettlementCapabilities),
          ...Object.values(TaxCapabilities),
        ]

        const grants = [buyer, approver].flatMap((principal) =>
          capabilities.map((capability) => ({
            userAccountId: principal.userAccountId,
            tenantId,
            capability,
          })),
        )

        yield* Effect.gen(function* () {
          const ledger = yield* GeneralLedgerService
          const party = yield* PartyService
          const products = yield* ProductService
          const stock = yield* StockKeepingService
          const tax = yield* TaxService
          const procurement = yield* ProcurementService
          const purchasing = yield* PurchaseDocumentService
          const approvals = yield* ApprovalService
          const billing = yield* BillingService
          const settlement = yield* SettlementService
          const documents = yield* DocumentsService
          const scope = { principal: buyer, tenantId }

          // Masters: chart, supplier party role and account, stockable product, tax, price, policy.
          yield* ledger.applyChartTemplate({ ...scope, legalEntityId, template: "neutral_trading" })
          const vendor = yield* party.create({ ...scope, kind: "organization", name: "PT Pemasok" })
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

          yield* stock.registerProductItem({ ...scope, productId: widget.id })

          const inputVat = yield* tax.createTaxCode({
            ...scope,
            code: "IN11",
            name: "Input VAT 11%",
            rate: "11",
            direction: "purchase",
          })

          yield* tax.setProductTaxDefault({
            ...scope,
            productId: widget.id,
            direction: "purchase",
            taxCodeId: inputVat.id,
          })
          yield* purchasing.setSupplierPrice({
            ...scope,
            supplierAccountId: supplier.id,
            productId: widget.id,
            unitPrice: "6.00",
          })

          // Setting a price again replaces it; the list shows one price per product.
          yield* purchasing.setSupplierPrice({
            ...scope,
            supplierAccountId: supplier.id,
            productId: widget.id,
            unitPrice: "6.00",
          })
          assert.deepStrictEqual(
            yield* purchasing.listSupplierPrices({ ...scope, supplierAccountId: supplier.id }),
            [{ supplierAccountId: supplier.id, productId: widget.id, unitPrice: "6.00" }],
          )

          yield* approvals.configurePolicy({
            ...scope,
            subjectType: "procurement.purchase_order",
            threshold: "500.00",
            approverCapability: ProcurementCapabilities.purchaseOrderApprove,
          })

          // Purchase order approval above the threshold, with separation of duties.
          const drafted = yield* purchasing.draftPurchaseOrder({
            ...scope,
            supplierAccountId: supplier.id,
            lines: [{ productId: widget.id, quantity: "100" }],
          })

          assert.strictEqual(drafted.total, "600.00")
          assert.strictEqual(drafted.approval?.status, "pending")

          const release = {
            ...scope,
            purchaseOrderId: drafted.purchaseOrderId,
            idempotencyKey: `release-${drafted.purchaseOrderId}`,
          }

          const unapproved = yield* Effect.flip(purchasing.releasePurchaseOrder(release))
          assert.instanceOf(unapproved, PurchaseOrderApprovalRequired)

          // The legacy confirm command honors the same policy, and a legacy-created order gets a
          // pending request an approver can act on.
          const legacyConfirm = yield* Effect.flip(
            procurement.confirmPurchaseOrder({
              ...scope,
              purchaseOrderId: drafted.purchaseOrderId,
              idempotencyKey: "legacy-confirm",
            }),
          )

          assert.instanceOf(legacyConfirm, PurchaseOrderApprovalRequired)

          const legacyOrder = yield* procurement.createPurchaseOrder({
            ...scope,
            supplierAccountId: supplier.id,
            lines: [{ itemId: widget.id, quantity: "100", unitPrice: "6.00" }],
          })

          const legacyBlocked = yield* Effect.flip(
            procurement.confirmPurchaseOrder({
              ...scope,
              purchaseOrderId: legacyOrder.id,
              idempotencyKey: "legacy-order-confirm",
            }),
          )

          assert.instanceOf(legacyBlocked, PurchaseOrderApprovalRequired)

          const legacyRequest = yield* approvals.getForSubject({
            ...scope,
            subjectType: "procurement.purchase_order",
            subjectId: legacyOrder.id,
          })

          assert.strictEqual(legacyRequest?.status, "pending")

          // The request register lists both pending requests, newest first, and filters by status.
          const pending = yield* approvals.list({ ...scope, status: "pending" })

          assert.deepStrictEqual(
            pending.map((request) => request.subjectId),
            [legacyOrder.id, drafted.purchaseOrderId],
          )
          assert.deepStrictEqual(yield* approvals.list({ ...scope, status: "approved" }), [])

          const selfApproval = yield* Effect.flip(
            approvals.decide({ ...scope, requestId: drafted.approval!.id, decision: "approve" }),
          )

          assert.instanceOf(selfApproval, SelfApprovalForbidden)
          yield* approvals.decide({
            principal: approver,
            tenantId,
            requestId: drafted.approval!.id,
            decision: "approve",
          })
          const released = yield* purchasing.releasePurchaseOrder(release)
          assert.strictEqual(released.status, "confirmed")
          const line = released.lines[0]!
          assert.strictEqual(line.taxCodeId, inputVat.id)

          // Valued receipt at the purchase price, a return, and the over-receipt guard.
          const receipt = yield* purchasing.receiveValued({
            ...scope,
            purchaseOrderId: drafted.purchaseOrderId,
            warehouseId: warehouse!.id,
            receiptDate: "2026-10-03",
            lines: [{ purchaseOrderLineId: line.purchaseOrderLineId, quantity: "60" }],
          })

          assert.strictEqual(receipt.number, "GR/2026/00001")
          assert.strictEqual(receipt.stock.lines[0]!.value, "360.00")

          const returned = yield* purchasing.returnToSupplier({
            ...scope,
            purchaseOrderId: drafted.purchaseOrderId,
            warehouseId: warehouse!.id,
            returnDate: "2026-10-04",
            lines: [{ purchaseOrderLineId: line.purchaseOrderLineId, quantity: "5" }],
          })

          assert.strictEqual(returned.stock.lines[0]!.value, "-30.00")

          const overReturn = yield* Effect.flip(
            purchasing.returnToSupplier({
              ...scope,
              purchaseOrderId: drafted.purchaseOrderId,
              warehouseId: warehouse!.id,
              returnDate: "2026-10-04",
              lines: [{ purchaseOrderLineId: line.purchaseOrderLineId, quantity: "56" }],
            }),
          )

          assert.instanceOf(overReturn, PurchaseReturnExceedsReceipt)

          // Three-way match: a bill cannot exceed received quantity net of returns.
          const overBill = yield* Effect.flip(
            billing.billPurchaseOrder({
              ...scope,
              purchaseOrderId: drafted.purchaseOrderId,
              billDate: "2026-10-05",
              supplierReference: "SUP-INV-001",
              lines: [
                {
                  purchaseOrderLineId: line.purchaseOrderLineId,
                  quantity: "60",
                  unitPrice: "6.20",
                },
              ],
            }),
          )

          assert.instanceOf(overBill, BillExceedsReceipt)
          assert.strictEqual(overBill.billable, "55")

          const firstBill = yield* billing.billPurchaseOrder({
            ...scope,
            purchaseOrderId: drafted.purchaseOrderId,
            billDate: "2026-10-05",
            supplierReference: "SUP-INV-001",
            lines: [
              { purchaseOrderLineId: line.purchaseOrderLineId, quantity: "55", unitPrice: "6.20" },
            ],
          })

          assert.strictEqual(firstBill.number, "BILL/2026/00001")
          assert.deepStrictEqual(
            [firstBill.subtotal, firstBill.taxTotal, firstBill.total],
            ["341.00", "37.51", "378.51"],
          )

          yield* purchasing.receiveValued({
            ...scope,
            purchaseOrderId: drafted.purchaseOrderId,
            warehouseId: warehouse!.id,
            receiptDate: "2026-10-10",
            lines: [{ purchaseOrderLineId: line.purchaseOrderLineId, quantity: "40" }],
          })

          const overReceipt = yield* Effect.flip(
            purchasing.receiveValued({
              ...scope,
              purchaseOrderId: drafted.purchaseOrderId,
              warehouseId: warehouse!.id,
              receiptDate: "2026-10-10",
              lines: [{ purchaseOrderLineId: line.purchaseOrderLineId, quantity: "1" }],
            }),
          )

          assert.instanceOf(overReceipt, PurchaseReceiptQuantityExceeded)

          // Billing five units beyond receipt needs an approved variance.
          const billId = uuidv7()

          const varianceBill = {
            ...scope,
            billId,
            purchaseOrderId: drafted.purchaseOrderId,
            billDate: "2026-10-12",
            supplierReference: "SUP-INV-002",
            lines: [
              { purchaseOrderLineId: line.purchaseOrderLineId, quantity: "45", unitPrice: "6.00" },
            ],
          }

          const unapprovedVariance = yield* Effect.flip(billing.billPurchaseOrder(varianceBill))
          assert.instanceOf(unapprovedVariance, BillExceedsReceipt)
          yield* approvals.configurePolicy({
            ...scope,
            subjectType: BillVarianceSubject,
            threshold: "0.00",
            approverCapability: ProcurementCapabilities.purchaseOrderApprove,
          })

          const variance = yield* approvals.submit({
            ...scope,
            subjectType: BillVarianceSubject,
            subjectId: billId,
            amount: "30.00",
            reason: "Supplier billed five units shipped separately",
          })

          yield* approvals.decide({
            principal: approver,
            tenantId,
            requestId: variance.id,
            decision: "approve",
          })
          const secondBill = yield* billing.billPurchaseOrder(varianceBill)
          assert.deepStrictEqual(
            [secondBill.subtotal, secondBill.taxTotal, secondBill.total],
            ["270.00", "29.70", "299.70"],
          )

          // Outgoing payments and payables aging.
          const paid = yield* settlement.makePayment({
            ...scope,
            legalEntityId,
            partyId: vendor.id,
            paymentDate: "2026-10-20",
            amount: "578.51",
            allocations: [
              { invoiceId: firstBill.id, amount: "378.51" },
              { invoiceId: secondBill.id, amount: "200.00" },
            ],
          })

          assert.strictEqual(paid.number, "PAY/2026/00001")
          assert.strictEqual(paid.unallocatedAmount, "0.00")

          // One payment settles two bills; the chain lists it once, after both bills.
          const flow = yield* documents.chain({
            ...scope,
            documentType: "billing.document",
            documentId: secondBill.id,
          })

          assert.deepStrictEqual(
            flow.nodes.map((node) => [node.type, node.state]),
            [
              ["procurement.purchase_order", "confirmed"],
              ["procurement.receipt", "received"],
              ["procurement.receipt", "received"],
              ["billing.supplier_bill", "settled"],
              ["billing.supplier_bill", "open"],
              ["settlement.payment", "allocated"],
            ],
          )
          assert.deepStrictEqual(
            flow.nodes.filter((node) => node.current).map((node) => node.id),
            [secondBill.id],
          )
          assert.deepStrictEqual(
            (yield* documents.chain({
              ...scope,
              documentType: "procurement.purchase_order",
              documentId: drafted.purchaseOrderId,
            })).nodes.map((node) => node.id),
            flow.nodes.map((node) => node.id),
          )

          const aging = yield* settlement.aging({
            ...scope,
            legalEntityId,
            side: "payable",
            asOf: "2026-12-31",
          })

          const payable = yield* ledger.roleBalance({
            ...scope,
            legalEntityId,
            role: "payable",
            asOf: "2026-12-31",
          })

          assert.strictEqual(aging.totals.total, "99.70")
          assert.strictEqual(payable.balance, "-99.70")

          // The day before the payment both bills were still fully open.
          const agingBefore = yield* settlement.aging({
            ...scope,
            legalEntityId,
            side: "payable",
            asOf: "2026-10-19",
          })

          const payableBefore = yield* ledger.roleBalance({
            ...scope,
            legalEntityId,
            role: "payable",
            asOf: "2026-10-19",
          })

          assert.strictEqual(agingBefore.totals.total, "678.21")
          assert.strictEqual(payableBefore.balance, "-678.21")

          // Stock valuation equals the inventory account; GRNI clears; variance is visible.
          const valuation = yield* stock.valuation({ ...scope, legalEntityId })
          assert.deepStrictEqual(valuation.rows, [
            { itemId: widget.id, quantity: "95", value: "570.00" },
          ])

          const balance = (
            role:
              | "inventory"
              | "goods_received_not_invoiced"
              | "purchase_price_variance"
              | "input_tax",
          ) =>
            ledger
              .roleBalance({ ...scope, legalEntityId, role, asOf: "2026-12-31" })
              .pipe(Effect.map((result) => result.balance))

          assert.strictEqual(yield* balance("inventory"), valuation.totalValue)
          assert.strictEqual(yield* balance("goods_received_not_invoiced"), "0.00")
          assert.strictEqual(yield* balance("purchase_price_variance"), "41.00")
          assert.strictEqual(yield* balance("input_tax"), "67.21")

          // A supplier credit note for the whole first bill, billed at 6.20 against a 6.00 purchase
          // price, returns goods received not invoiced at the 330.00 the bill cleared and reverses
          // the 11.00 variance it booked.
          const credit = yield* billing.creditInvoice({
            ...scope,
            invoiceId: firstBill.id,
            creditDate: "2026-10-22",
            lines: [{ invoiceLineId: firstBill.lines[0]!.id, quantity: "55" }],
          })

          assert.strictEqual(credit.total, "378.51")
          assert.strictEqual(credit.lines[0]!.matchedValue, "330.00")
          assert.strictEqual(yield* balance("goods_received_not_invoiced"), "-330.00")
          assert.strictEqual(yield* balance("purchase_price_variance"), "30.00")
          assert.strictEqual(yield* balance("input_tax"), "29.70")

          const agingAfterCredit = yield* settlement.aging({
            ...scope,
            legalEntityId,
            side: "payable",
            asOf: "2026-12-31",
          })

          const payableAfterCredit = yield* ledger.roleBalance({
            ...scope,
            legalEntityId,
            role: "payable",
            asOf: "2026-12-31",
          })

          assert.strictEqual(agingAfterCredit.totals.total, "-278.81")
          assert.strictEqual(payableAfterCredit.balance, "278.81")

          const trialBalance = yield* ledger.trialBalance({
            ...scope,
            legalEntityId,
            to: "2026-12-31",
          })

          assert.strictEqual(trialBalance.totalDebit, trialBalance.totalCredit)
        }).pipe(Effect.provide(erpChainLayers(client, grants)))
      }),
    ),
  { timeout: 180_000 },
)
