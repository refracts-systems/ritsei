import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import {
  ApprovalCapabilities,
  ApprovalService,
} from "../../../../framework/modules/approvals/mod.ts"
import { runMigrations } from "../../../../framework/platform/mod.ts"
import { seedErpFixture } from "../../../../tests/support/erp-fixture.ts"
import { erpChainLayers } from "../../../../tests/support/erp-layers.ts"
import { withTemporaryDatabase } from "../../../../tests/support/postgres-database.ts"
import { InventoryCapabilities, StockKeepingService } from "../../inventory/mod.ts"
import { PartyCapabilities, PartyService } from "../../party/mod.ts"
import { ProductCapabilities, ProductService } from "../../product/mod.ts"
import { TaxCapabilities } from "../../tax/mod.ts"
import {
  ProcurementCapabilities,
  ProcurementService,
  PurchaseDocumentService,
  PurchaseOrderApprovalRequired,
} from "../mod.ts"

const databaseUrl = process.env["DATABASE_URL"]
const buyer = { userAccountId: "cover-buyer", sessionId: "cover-buyer-session" }
const approver = { userAccountId: "cover-approver", sessionId: "cover-approver-session" }
const subjectType = "procurement.purchase_order"

// [PRC-REL-1]
it.effect.skipIf(databaseUrl === undefined)(
  "an approval is accepted by both confirmation paths only when it equals the order total",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const { tenantId, legalEntityId } = yield* seedErpFixture(client)

        const capabilities = [
          ...Object.values(ApprovalCapabilities),
          ...Object.values(InventoryCapabilities),
          ...Object.values(PartyCapabilities),
          ...Object.values(ProcurementCapabilities),
          ...Object.values(ProductCapabilities),
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
          const party = yield* PartyService
          const products = yield* ProductService
          const stock = yield* StockKeepingService
          const procurement = yield* ProcurementService
          const purchasing = yield* PurchaseDocumentService
          const approvals = yield* ApprovalService
          const scope = { principal: buyer, tenantId }

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

          yield* stock.registerProductItem({ ...scope, productId: widget.id })

          yield* approvals.configurePolicy({
            ...scope,
            subjectType,
            threshold: "500.00",
            approverCapability: ProcurementCapabilities.purchaseOrderApprove,
          })

          // An order totalling 600.00 whose approval was granted for `amount`. Owner commands
          // always submit the order total, so a different amount is set up by hand.
          const approvedFor = (amount: string) =>
            Effect.gen(function* () {
              const order = yield* procurement.createPurchaseOrder({
                ...scope,
                supplierAccountId: supplier.id,
                lines: [{ itemId: widget.id, quantity: "100", unitPrice: "6.00" }],
              })

              assert.strictEqual(order.total, "600.00")

              const request = yield* approvals.submit({
                ...scope,
                subjectType,
                subjectId: order.id,
                amount,
                reason: "approval amount under test",
              })

              yield* approvals.decide({
                principal: approver,
                tenantId,
                requestId: request.id,
                decision: "approve",
              })

              return order.id
            })

          // What each path does, as a status: "confirmed", or the approval status it refused with.
          const release = (purchaseOrderId: string) =>
            purchasing
              .releasePurchaseOrder({
                ...scope,
                purchaseOrderId,
                idempotencyKey: `r-${purchaseOrderId}`,
              })
              .pipe(
                Effect.map((order) => order.status),
                Effect.catchTag(
                  "PurchaseOrderApprovalRequired",
                  (error: PurchaseOrderApprovalRequired) =>
                    Effect.succeed(`refused: ${error.status}`),
                ),
              )

          const confirm = (purchaseOrderId: string) =>
            procurement
              .confirmPurchaseOrder({
                ...scope,
                purchaseOrderId,
                idempotencyKey: `c-${purchaseOrderId}`,
              })
              .pipe(
                Effect.map((order) => order.status),
                Effect.catchTag(
                  "PurchaseOrderApprovalRequired",
                  (error: PurchaseOrderApprovalRequired) =>
                    Effect.succeed(`refused: ${error.status}`),
                ),
              )

          const outcomes: Array<[string, string, string]> = []

          for (const amount of ["599.99", "600.00", "600.01"]) {
            outcomes.push([
              amount,
              yield* release(yield* approvedFor(amount)),
              yield* confirm(yield* approvedFor(amount)),
            ])
          }

          // Observed behavior. An approval for less than the total is refused by both paths. An
          // approval for more is accepted by release's own check but refused by the confirmation
          // it delegates to, so the two paths agree: only an exact approval confirms.
          assert.deepStrictEqual(outcomes, [
            ["599.99", "refused: approved", "refused: approved"],
            ["600.00", "confirmed", "confirmed"],
            ["600.01", "refused: approved", "refused: approved"],
          ])
        }).pipe(Effect.provide(erpChainLayers(client, grants)))
      }),
    ),
  { timeout: 180_000 },
)
