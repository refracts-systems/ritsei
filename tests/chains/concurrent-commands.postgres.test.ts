import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Result from "effect/Result"

import { uuidv7 } from "../../framework/foundation/mod.ts"
import {
  ApprovalAlreadyDecided,
  ApprovalCapabilities,
  ApprovalService,
} from "../../framework/modules/approvals/mod.ts"
import { runMigrations } from "../../framework/platform/mod.ts"
import { AccountingCapabilities, GeneralLedgerService } from "../../erp/modules/accounting/mod.ts"
import {
  BillingCapabilities,
  BillingService,
  NothingToInvoice,
  SettlementExceedsOpenAmount,
} from "../../erp/modules/billing/mod.ts"
import { InventoryCapabilities, StockKeepingService } from "../../erp/modules/inventory/mod.ts"
import { PartyCapabilities, PartyService } from "../../erp/modules/party/mod.ts"
import { OrderToCashService } from "../../erp/modules/process/mod.ts"
import { ProcurementCapabilities } from "../../erp/modules/procurement/mod.ts"
import { ProductCapabilities, ProductService } from "../../erp/modules/product/mod.ts"
import {
  DeliveryExceedsOrder,
  SalesCapabilities,
  SalesDocumentService,
  SalesService,
} from "../../erp/modules/sales/mod.ts"
import { SettlementCapabilities, SettlementService } from "../../erp/modules/settlement/mod.ts"
import { TaxCapabilities } from "../../erp/modules/tax/mod.ts"
import { seedErpFixture } from "../support/erp-fixture.ts"
import { erpChainLayers } from "../support/erp-layers.ts"
import { withTemporaryDatabase } from "../support/postgres-database.ts"

const databaseUrl = process.env["DATABASE_URL"]
const principal = { userAccountId: "racer-user", sessionId: "racer-session" }
const firstApprover = { userAccountId: "approver-one", sessionId: "approver-one-session" }
const secondApprover = { userAccountId: "approver-two", sessionId: "approver-two-session" }

/** Runs both commands at once and reports how each ended, so a test asserts the race's outcome. */
const race = <A, E, R>(first: Effect.Effect<A, E, R>, second: Effect.Effect<A, E, R>) =>
  Effect.all([Effect.result(first), Effect.result(second)], { concurrency: 2 })

const outcomes = <A, E>(results: ReadonlyArray<Result.Result<A, E>>) => ({
  succeeded: results.flatMap((result) => (Result.isSuccess(result) ? [result.success] : [])),
  failed: results.flatMap((result) => (Result.isFailure(result) ? [result.failure] : [])),
})

it.effect.skipIf(databaseUrl === undefined)(
  "lets only one of two simultaneous commands win a stock, billing, payment, or approval race",
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
          ...Object.values(SalesCapabilities),
          ...Object.values(SettlementCapabilities),
          ...Object.values(TaxCapabilities),
        ]

        const grants = [principal, firstApprover, secondApprover].flatMap((user) =>
          capabilities.map((capability) => ({
            userAccountId: user.userAccountId,
            tenantId,
            capability,
          })),
        )

        yield* Effect.gen(function* () {
          const ledger = yield* GeneralLedgerService
          const party = yield* PartyService
          const products = yield* ProductService
          const stock = yield* StockKeepingService
          const salesDocuments = yield* SalesDocumentService
          const sales = yield* SalesService
          const orderToCash = yield* OrderToCashService
          const billing = yield* BillingService
          const settlement = yield* SettlementService
          const approvals = yield* ApprovalService
          const scope = { principal, tenantId }

          // One confirmed order of ten widgets at 10.00 each, with a hundred widgets on hand.
          yield* ledger.applyChartTemplate({ ...scope, legalEntityId, template: "neutral_trading" })
          const buyer = yield* party.create({ ...scope, kind: "organization", name: "PT Pembeli" })
          yield* party.assignRole({ ...scope, partyId: buyer.id, role: "customer" })

          const relationship = yield* party.createRelationship({
            ...scope,
            partyId: buyer.id,
            legalEntityId,
            kind: "customer",
          })

          const customer = yield* salesDocuments.createPartyCustomer({
            ...scope,
            partyRelationshipId: relationship.id,
            email: "finance@pembeli.test",
          })

          const widget = yield* products.createProduct({
            ...scope,
            code: "WIDGET",
            name: "Widget",
            type: "stockable",
          })

          yield* stock.registerProductItem({ ...scope, productId: widget.id })
          yield* stock.receiveValued({
            ...scope,
            warehouseId: warehouse!.id,
            postingDate: "2026-10-01",
            source: { type: "inventory.opening_stock", id: uuidv7() },
            counterRole: "inventory_adjustment",
            lines: [{ itemId: widget.id, quantity: "100", unitCost: "6.00" }],
          })

          const priceList = yield* salesDocuments.createPriceList({
            ...scope,
            name: "Retail IDR",
            currency: "IDR",
          })

          yield* salesDocuments.setPrice({
            ...scope,
            priceListId: priceList.id,
            productId: widget.id,
            unitPrice: "10.00",
          })
          yield* salesDocuments.assignCustomerPriceList({
            ...scope,
            customerId: customer.id,
            priceListId: priceList.id,
          })

          const quotation = yield* salesDocuments.draftQuotation({
            ...scope,
            customerId: customer.id,
            validUntil: "2026-10-31",
            lines: [{ productId: widget.id, quantity: "10" }],
          })

          yield* salesDocuments.sendQuotation({ ...scope, quotationId: quotation.id })
          yield* salesDocuments.acceptQuotation({ ...scope, quotationId: quotation.id })

          const { orderId } = yield* salesDocuments.convertQuotation({
            ...scope,
            quotationId: quotation.id,
          })

          yield* sales.confirmOrder({
            ...scope,
            orderId,
            commandId: uuidv7(),
            correlationId: uuidv7(),
            idempotencyKey: `confirm-${orderId}`,
          })

          const order = yield* salesDocuments.getFulfillment({ ...scope, orderId })
          const line = order.lines[0]!

          const deliver = () =>
            orderToCash.deliverOrder({
              ...scope,
              orderId,
              warehouseId: warehouse!.id,
              deliveryDate: "2026-10-05",
              lines: [{ orderLineId: line.orderLineId, quantity: "10" }],
            })

          // Two deliveries of the whole order: one is delivered, the other exceeds the order.
          const deliveries = outcomes(yield* race(deliver(), deliver()))

          assert.strictEqual(deliveries.succeeded.length, 1)
          assert.strictEqual(deliveries.failed.length, 1)
          assert.instanceOf(deliveries.failed[0], DeliveryExceedsOrder)

          const valuation = yield* stock.valuation({ ...scope, legalEntityId })

          assert.deepStrictEqual(valuation.rows, [
            { itemId: widget.id, quantity: "90", value: "540.00" },
          ])

          // Two invoices for the same delivered quantity: one invoices it, the other finds nothing.
          const invoice = () =>
            billing.invoiceSalesOrder({ ...scope, orderId, invoiceDate: "2026-10-06" })

          const invoices = outcomes(yield* race(invoice(), invoice()))

          assert.strictEqual(invoices.succeeded.length, 1)
          assert.instanceOf(invoices.failed[0], NothingToInvoice)

          const invoiced = invoices.succeeded[0]!

          assert.strictEqual(invoiced.total, "100.00")

          // Two payments that each settle the whole invoice: only one fits.
          const collect = () =>
            settlement.receivePayment({
              ...scope,
              legalEntityId,
              partyId: buyer.id,
              paymentDate: "2026-10-07",
              amount: "100.00",
              allocations: [{ invoiceId: invoiced.id, amount: "100.00" }],
            })

          const payments = outcomes(yield* race(collect(), collect()))

          assert.strictEqual(payments.succeeded.length, 1)
          assert.instanceOf(payments.failed[0], SettlementExceedsOpenAmount)
          assert.strictEqual(
            (yield* billing.getDocument({ ...scope, invoiceId: invoiced.id })).openAmount,
            "0.00",
          )
          assert.strictEqual(
            (yield* settlement.listPayments({ ...scope, legalEntityId })).length,
            1,
          )

          // Two approvers deciding one request: the first decision stands.
          yield* approvals.configurePolicy({
            ...scope,
            subjectType: "procurement.purchase_order",
            threshold: "10.00",
            approverCapability: ProcurementCapabilities.purchaseOrderApprove,
          })

          const request = yield* approvals.submit({
            ...scope,
            subjectType: "procurement.purchase_order",
            subjectId: uuidv7(),
            amount: "500.00",
            reason: "Purchase order total exceeds the approval threshold",
          })

          const decide = (approver: typeof firstApprover) =>
            approvals.decide({
              principal: approver,
              tenantId,
              requestId: request.id,
              decision: "approve",
            })

          const decisions = outcomes(yield* race(decide(firstApprover), decide(secondApprover)))

          assert.strictEqual(decisions.succeeded.length, 1)
          assert.instanceOf(decisions.failed[0], ApprovalAlreadyDecided)

          const [decided] = yield* approvals.list({ ...scope, status: "approved" })

          assert.strictEqual(decided?.decidedBy, decisions.succeeded[0]?.decidedBy)
        }).pipe(Effect.provide(erpChainLayers(client, grants)))

        // The ledger agrees with what the winners posted: no stock, receivable, or cash is doubled.
        const [balances] = yield* Effect.promise(
          () => client<{ debit: string; credit: string }[]>`
            select coalesce(sum(l.debit), 0)::text as debit, coalesce(sum(l.credit), 0)::text as credit
            from accounting.journal_lines l
            where l.tenant_id = ${tenantId}
          `,
        )

        assert.strictEqual(balances!.debit, balances!.credit)
      }),
    ),
  { timeout: 180_000 },
)
