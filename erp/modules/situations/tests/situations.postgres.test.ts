import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as TestClock from "effect/testing/TestClock"

import { uuidv7 } from "../../../../framework/foundation/mod.ts"
import {
  ApprovalCapabilities,
  ApprovalService,
} from "../../../../framework/modules/approvals/mod.ts"
import { runMigrations } from "../../../../framework/platform/mod.ts"
import { seedErpFixture } from "../../../../tests/support/erp-fixture.ts"
import { erpChainLayers } from "../../../../tests/support/erp-layers.ts"
import { withTemporaryDatabase } from "../../../../tests/support/postgres-database.ts"
import { postgresConstraint } from "../../../../tests/support/postgres-error.ts"
import { AccountingCapabilities, GeneralLedgerService } from "../../accounting/mod.ts"
import { BillingCapabilities, BillingService } from "../../billing/mod.ts"
import { InventoryCapabilities, StockKeepingService } from "../../inventory/mod.ts"
import { PartyCapabilities, PartyService } from "../../party/mod.ts"
import { ProductCapabilities, ProductService } from "../../product/mod.ts"
import {
  ProcurementCapabilities,
  ProcurementService,
  PurchaseDocumentService,
} from "../../procurement/mod.ts"
import { SalesCapabilities, SalesDocumentService, SalesService } from "../../sales/mod.ts"
import { SettlementCapabilities } from "../../settlement/mod.ts"
import { TaxCapabilities } from "../../tax/mod.ts"
import { SituationsCapabilities, SituationsService } from "../mod.ts"

const databaseUrl = process.env["DATABASE_URL"]
const person = (name: string) => ({ userAccountId: name, sessionId: `${name}-session` })
const ops = person("sit-ops")
const watcher = person("sit-watcher")
const owner = person("sit-owner")
const supervisor = person("sit-supervisor")
const outsider = person("sit-outsider")

const at = (date: string) => TestClock.setTime(Date.parse(`${date}T03:00:00.000Z`))

it.effect.skipIf(databaseUrl === undefined)(
  "detects three kinds of situation, escalates by working days, follows, and assigns in bulk",
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

        const everything = [
          ...Object.values(AccountingCapabilities),
          ...Object.values(ApprovalCapabilities),
          ...Object.values(BillingCapabilities),
          ...Object.values(InventoryCapabilities),
          ...Object.values(PartyCapabilities),
          ...Object.values(ProcurementCapabilities),
          ...Object.values(ProductCapabilities),
          ...Object.values(SalesCapabilities),
          ...Object.values(SettlementCapabilities),
          ...Object.values(SituationsCapabilities),
          ...Object.values(TaxCapabilities),
        ]

        const grant = (who: ReturnType<typeof person>, capabilities: ReadonlyArray<string>) =>
          capabilities.map((capability) => ({
            userAccountId: who.userAccountId,
            tenantId,
            capability,
          }))

        const grants = [
          ...grant(ops, everything),
          ...grant(watcher, [SituationsCapabilities.situationRead]),
          ...grant(owner, [SituationsCapabilities.flowOwn, SituationsCapabilities.situationRead]),
          ...grant(supervisor, [SituationsCapabilities.flowSupervise]),
        ]

        yield* Effect.gen(function* () {
          const ledger = yield* GeneralLedgerService
          const party = yield* PartyService
          const products = yield* ProductService
          const stock = yield* StockKeepingService
          const salesDocuments = yield* SalesDocumentService
          const sales = yield* SalesService
          const procurement = yield* ProcurementService
          const purchasing = yield* PurchaseDocumentService
          const billing = yield* BillingService
          const approvals = yield* ApprovalService
          const situations = yield* SituationsService
          const scope = { principal: ops, tenantId }

          const detect = (when: string) =>
            situations.detect({ ...scope, legalEntityId, at: `${when}Z` })

          const advance = (when: string) =>
            situations.advanceEscalations({ ...scope, legalEntityId, at: `${when}Z` })

          const open = () =>
            situations
              .list({ ...scope, status: "open" })
              .pipe(Effect.map((rows) => new Map(rows.map((row) => [row.type, row]))))

          yield* at("2026-09-01")
          yield* ledger.applyChartTemplate({ ...scope, legalEntityId, template: "neutral_trading" })

          // ---- Data behind the three detections.
          const widget = yield* products.createProduct({
            ...scope,
            code: "WIDGET",
            name: "Widget",
            type: "stockable",
          })

          yield* stock.registerProductItem({ ...scope, productId: widget.id })

          const buyer = yield* party.create({ ...scope, kind: "organization", name: "PT Pembeli" })
          yield* party.assignRole({ ...scope, partyId: buyer.id, role: "customer" })

          const customerRelationship = yield* party.createRelationship({
            ...scope,
            partyId: buyer.id,
            legalEntityId,
            kind: "customer",
          })

          const customer = yield* salesDocuments.createPartyCustomer({
            ...scope,
            partyRelationshipId: customerRelationship.id,
            email: "finance@pembeli.test",
          })

          // A receivable: delivered and invoiced in September, never paid.
          yield* at("2026-09-03")

          const order = yield* sales.createOrder({
            ...scope,
            customerId: customer.id,
            lines: [{ itemId: widget.id, quantity: "10", unitPrice: "10.00" }],
          })

          yield* sales.confirmOrder({
            ...scope,
            orderId: order.id,
            commandId: uuidv7(),
            correlationId: uuidv7(),
            idempotencyKey: `confirm-${order.id}`,
          })

          const lineId = (yield* salesDocuments.getFulfillment({ ...scope, orderId: order.id }))
            .lines[0]!.orderLineId

          yield* salesDocuments.recordDelivery({
            ...scope,
            orderId: order.id,
            warehouseId: warehouse!.id,
            deliveryDate: "2026-09-05",
            lines: [{ orderLineId: lineId, quantity: "10" }],
          })

          const invoice = yield* billing.invoiceSalesOrder({
            ...scope,
            orderId: order.id,
            invoiceDate: "2026-09-06",
          })

          // A supplier bill that differs from what was received: 5 received at 6.00, billed at 7.00.
          const vendor = yield* party.create({ ...scope, kind: "organization", name: "PT Pemasok" })
          yield* party.assignRole({ ...scope, partyId: vendor.id, role: "supplier" })

          const supplierRelationship = yield* party.createRelationship({
            ...scope,
            partyId: vendor.id,
            legalEntityId,
            kind: "supplier",
          })

          const supplier = yield* procurement.createSupplierAccount({
            ...scope,
            supplierRelationshipId: supplierRelationship.id,
          })

          yield* purchasing.setSupplierPrice({
            ...scope,
            supplierAccountId: supplier.id,
            productId: widget.id,
            unitPrice: "6.00",
          })

          const drafted = yield* purchasing.draftPurchaseOrder({
            ...scope,
            supplierAccountId: supplier.id,
            lines: [{ productId: widget.id, quantity: "5" }],
          })

          const released = yield* purchasing.releasePurchaseOrder({
            ...scope,
            purchaseOrderId: drafted.purchaseOrderId,
            idempotencyKey: `release-${drafted.purchaseOrderId}`,
          })

          const purchaseLineId = released.lines[0]!.purchaseOrderLineId

          yield* purchasing.receiveValued({
            ...scope,
            purchaseOrderId: drafted.purchaseOrderId,
            warehouseId: warehouse!.id,
            receiptDate: "2026-09-10",
            lines: [{ purchaseOrderLineId: purchaseLineId, quantity: "5" }],
          })

          const bill = yield* billing.billPurchaseOrder({
            ...scope,
            purchaseOrderId: drafted.purchaseOrderId,
            billDate: "2026-09-12",
            supplierReference: "SUP-1",
            lines: [{ purchaseOrderLineId: purchaseLineId, quantity: "5", unitPrice: "7.00" }],
          })

          // An approval request nobody has taken.
          yield* approvals.configurePolicy({
            ...scope,
            subjectType: "test.waiting",
            threshold: "100.00",
            approverCapability: "procurement.purchase_order.approve",
          })

          const waiting = yield* approvals.submit({
            principal: person("sit-requester"),
            tenantId,
            subjectType: "test.waiting",
            subjectId: uuidv7(),
            amount: "300.00",
            reason: "order",
          })

          // ---- Calendar: Monday to Friday, and one listed holiday.
          const calendar = yield* situations.configureCalendar({
            ...scope,
            legalEntityId,
            weekdays: [1, 2, 3, 4, 5],
            nonWorkingDays: [{ day: "2026-12-15", name: "Cuti bersama" }],
          })

          assert.deepStrictEqual(calendar.nonWorkingDays, [
            { day: "2026-12-15", name: "Cuti bersama" },
          ])

          assert.strictEqual(
            (yield* Effect.flip(
              situations.configureCalendar({
                ...scope,
                legalEntityId,
                weekdays: [],
                nonWorkingDays: [],
              }),
            ))._tag,
            "CalendarInvalid",
          )

          // ---- Following needs the right to read.
          assert.strictEqual(
            (yield* Effect.flip(
              situations.follow({ principal: outsider, tenantId, flowType: "receivable_overdue" }),
            ))._tag,
            "FollowNotAllowed",
          )

          const followed = yield* situations.follow({
            principal: watcher,
            tenantId,
            flowType: "receivable_overdue",
          })

          // Following twice is one subscription.
          assert.strictEqual(
            (yield* situations.follow({
              principal: watcher,
              tenantId,
              flowType: "receivable_overdue",
            })).id,
            followed.id,
          )

          // ---- Detect (Thursday 2026-12-10): three situations open, and again opens nothing.
          const first = yield* detect("2026-12-10T09:00:00.000")

          assert.deepStrictEqual(
            first.outcomes.map((outcome) => [outcome.type, outcome.status, outcome.opened]),
            [
              ["receivable_overdue", "ran", 1],
              ["bill_mismatch", "ran", 1],
              ["approval_waiting", "ran", 1],
            ],
          )

          const again = yield* detect("2026-12-10T09:00:00.000")
          assert.deepStrictEqual(
            again.outcomes.map((outcome) => outcome.opened),
            [0, 0, 0],
          )

          const situationsNow = yield* open()
          assert.strictEqual(situationsNow.size, 3)

          const receivable = situationsNow.get("receivable_overdue")!
          const mismatch = situationsNow.get("bill_mismatch")!
          const approval = situationsNow.get("approval_waiting")!

          assert.strictEqual(receivable.subjectId, invoice.id)
          assert.strictEqual(receivable.severity, "high")
          assert.strictEqual(mismatch.subjectId, bill.id)
          assert.strictEqual(mismatch.severity, "medium")
          assert.strictEqual(approval.subjectId, waiting.id)
          assert.strictEqual(approval.severity, "high")

          // Due after one working day for high (Friday), two for medium (Monday).
          assert.strictEqual(receivable.escalationDueAt, "2026-12-11T09:00:00.000Z")
          assert.strictEqual(mismatch.escalationDueAt, "2026-12-14T09:00:00.000Z")

          // The follower of the flow was told once; nobody else was.
          const told = (who: ReturnType<typeof person>) =>
            situations.listInbox({ principal: who, tenantId })

          assert.deepStrictEqual(
            (yield* told(watcher)).map((item) => [item.kind, item.situationId]),
            [["opened", receivable.id]],
          )

          assert.deepStrictEqual(yield* told(owner), [])

          // ---- Escalation: nothing before it is due.
          assert.strictEqual((yield* advance("2026-12-10T15:00:00.000")).escalated, 0)

          // Friday: the two high ones go to the flow owner, who is told; the medium one waits.
          assert.strictEqual((yield* advance("2026-12-11T10:00:00.000")).escalated, 2)
          assert.strictEqual((yield* advance("2026-12-11T10:00:00.000")).escalated, 0)

          const afterFriday = yield* open()
          assert.strictEqual(afterFriday.get("receivable_overdue")!.escalationLevel, 1)
          assert.strictEqual(afterFriday.get("approval_waiting")!.escalationLevel, 1)
          assert.strictEqual(afterFriday.get("bill_mismatch")!.escalationLevel, 0)

          // Escalating never assigns.
          assert.strictEqual(afterFriday.get("receivable_overdue")!.ownerId, null)

          assert.deepStrictEqual(
            (yield* told(owner)).map((item) => item.kind),
            ["escalated", "escalated"],
          )

          assert.deepStrictEqual(yield* told(supervisor), [])

          // The follower is also told of the escalation of what they follow.
          assert.deepStrictEqual((yield* told(watcher)).map((item) => item.kind).toSorted(), [
            "escalated",
            "opened",
          ])

          // Monday: the medium one is due (the weekend does not count).
          assert.strictEqual((yield* advance("2026-12-14T10:00:00.000")).escalated, 1)

          // The holiday is skipped: two working days after Friday are Monday and Wednesday (Tuesday
          // the 15th is listed), so the supervisor is due Wednesday, not Tuesday.
          assert.strictEqual((yield* advance("2026-12-15T10:00:00.000")).escalated, 0)
          assert.strictEqual((yield* advance("2026-12-16T10:00:00.000")).escalated, 2)

          const afterSecond = yield* open()
          assert.strictEqual(afterSecond.get("receivable_overdue")!.escalationLevel, 2)
          assert.strictEqual(afterSecond.get("receivable_overdue")!.escalationDueAt, null)

          assert.deepStrictEqual(
            (yield* told(supervisor)).map((item) => item.kind),
            ["escalated", "escalated"],
          )

          // ---- Bulk assignment is one command: all or nothing, and only to a flow owner.
          assert.strictEqual(
            (yield* Effect.flip(
              situations.assign({
                ...scope,
                situationIds: [mismatch.id],
                ownerId: watcher.userAccountId,
              }),
            ))._tag,
            "OwnerNotEligible",
          )

          const unknown = yield* Effect.flip(
            situations.assign({
              ...scope,
              situationIds: [mismatch.id, uuidv7()],
              ownerId: owner.userAccountId,
            }),
          )

          assert.strictEqual(unknown._tag, "SituationNotFound")
          assert.strictEqual((yield* open()).get("bill_mismatch")!.ownerId, null)

          const assigned = yield* situations.assign({
            ...scope,
            situationIds: [mismatch.id, approval.id],
            ownerId: owner.userAccountId,
          })

          assert.deepStrictEqual(assigned.map((row) => [row.ownerId, row.escalationDueAt]).flat(), [
            owner.userAccountId,
            null,
            owner.userAccountId,
            null,
          ])

          // Repeating it changes nothing, and a taken situation no longer escalates.
          const repeated = yield* situations.assign({
            ...scope,
            situationIds: [mismatch.id, approval.id],
            ownerId: owner.userAccountId,
          })

          assert.deepStrictEqual(
            repeated.map((row) => row.id),
            assigned.map((row) => row.id),
          )
          assert.strictEqual((yield* advance("2027-01-20T10:00:00.000")).escalated, 0)

          // ---- Paying the invoice resolves its situation, and the follower hears of it once.
          yield* billing.applySettlement({
            ...scope,
            invoiceId: invoice.id,
            amount: invoice.openAmount,
            source: { type: "settlement.payment", id: uuidv7() },
            settledOn: "2026-12-12",
          })

          const resolution = yield* detect("2026-12-18T09:00:00.000")

          assert.deepStrictEqual(
            resolution.outcomes.map((outcome) => [outcome.type, outcome.resolved]),
            [
              ["receivable_overdue", 1],
              ["bill_mismatch", 0],
              ["approval_waiting", 0],
            ],
          )

          assert.isUndefined((yield* open()).get("receivable_overdue"))

          const history = yield* situations.list({
            ...scope,
            type: "receivable_overdue",
            status: "resolved",
          })

          assert.strictEqual(history.length, 1)
          assert.isNotNull(history[0]!.resolvedAt)

          assert.deepStrictEqual((yield* told(watcher)).map((item) => item.kind).toSorted(), [
            "escalated",
            "escalated",
            "opened",
            "resolved",
          ])

          // Detecting again repeats nothing.
          yield* detect("2026-12-18T09:00:00.000")
          assert.strictEqual((yield* told(watcher)).length, 4)

          // ---- Reading the inbox marks nothing; marking read does, once.
          const unread = yield* situations.listInbox({
            principal: watcher,
            tenantId,
            unreadOnly: true,
          })

          assert.strictEqual(unread.length, 4)

          assert.strictEqual(
            yield* situations.markRead({
              principal: watcher,
              tenantId,
              itemIds: unread.map((item) => item.id),
            }),
            4,
          )

          assert.strictEqual(
            yield* situations.markRead({
              principal: watcher,
              tenantId,
              itemIds: unread.map((item) => item.id),
            }),
            0,
          )

          // Someone else's notification is not theirs to mark.
          assert.strictEqual(
            yield* situations.markRead({
              principal: owner,
              tenantId,
              itemIds: unread.map((item) => item.id),
            }),
            0,
          )

          // ---- Following is read only and can be dropped; a stranger cannot drop it.
          assert.strictEqual(
            (yield* Effect.flip(
              situations.unfollow({ principal: owner, tenantId, followId: followed.id }),
            ))._tag,
            "FollowNotFound",
          )

          yield* situations.unfollow({ principal: watcher, tenantId, followId: followed.id })
          assert.deepStrictEqual(
            yield* situations.listFollows({ principal: watcher, tenantId }),
            [],
          )

          // ---- A reader without the detect capability cannot run a detection.
          assert.instanceOf(
            yield* Effect.flip(situations.detect({ principal: watcher, tenantId, legalEntityId })),
            Error,
          )

          // ---- Only one open situation per subject, whoever tries to add another.
          const duplicate = yield* Effect.tryPromise({
            try: () => client`
              insert into situations.situations
                (tenant_id, legal_entity_id, type, subject_type, subject_id, severity)
              values (${tenantId}, ${legalEntityId}, 'bill_mismatch', 'billing.document',
                      ${bill.id}, 'low')
            `,
            catch: (cause) => cause,
          }).pipe(Effect.flip)

          assert.strictEqual(postgresConstraint(duplicate), "situations_open_subject_key")
        }).pipe(Effect.provide(erpChainLayers(client, grants)))
      }),
    ),
  { timeout: 300_000 },
)
