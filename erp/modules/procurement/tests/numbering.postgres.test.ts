import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as TestClock from "effect/testing/TestClock"

import { Database, DatabaseFailure, uuidv7 } from "../../../../framework/foundation/mod.ts"
import {
  AuthorizationDenied,
  AuthorizationService,
} from "../../../../framework/modules/authorization/mod.ts"
import { MessagingService } from "../../../../framework/modules/messaging/mod.ts"
import { NumberingLive } from "../../../../framework/modules/numbering/mod.ts"
import { runMigrations } from "../../../../framework/platform/mod.ts"
import { seedErpFixture } from "../../../../tests/support/erp-fixture.ts"
import { erpChainLayers } from "../../../../tests/support/erp-layers.ts"
import { postgresConstraint } from "../../../../tests/support/postgres-error.ts"
import { withTemporaryDatabase } from "../../../../tests/support/postgres-database.ts"
import { PartyCapabilities, PartyService } from "../../party/mod.ts"
import { makeProcurementService, ProcurementCapabilities, ProcurementService } from "../mod.ts"

const databaseUrl = process.env["DATABASE_URL"]

const principal = { userAccountId: "purchase-number-user", sessionId: "purchase-number-session" }

const confirmer = {
  userAccountId: "purchase-number-confirmer",
  sessionId: "purchase-number-limited",
}

const postgresFailure = <A>(effect: () => Promise<A>) =>
  Effect.tryPromise({ try: effect, catch: (cause) => cause }).pipe(Effect.flip)

// [PRC-NUM-1]
it.effect.skipIf(databaseUrl === undefined)(
  "numbers a purchase order when confirmed, gapless per legal entity and fiscal year",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const { tenantId, legalEntityId } = yield* seedErpFixture(client)

        const grants = [
          ...Object.values(PartyCapabilities),
          ...Object.values(ProcurementCapabilities),
        ]
          .map((capability) => ({ userAccountId: principal.userAccountId, tenantId, capability }))
          .concat([
            {
              userAccountId: confirmer.userAccountId,
              tenantId,
              capability: ProcurementCapabilities.purchaseOrderConfirm,
            },
          ])

        yield* Effect.gen(function* () {
          const party = yield* PartyService
          const procurement = yield* ProcurementService
          const scope = { principal, tenantId }

          const issued = () =>
            Effect.promise(
              () => client<{ value: string }[]>`
                select i.value::text as value
                from numbering.issued_numbers i
                join numbering.number_series s on s.id = i.series_id
                where s.document_type = 'procurement.purchase_order'
                order by s.period_key, i.value
              `,
            ).pipe(Effect.map((rows) => rows.map((row) => row.value)))

          const confirm = (service: typeof procurement, purchaseOrderId: string, key?: string) =>
            service.confirmPurchaseOrder({
              ...scope,
              purchaseOrderId,
              idempotencyKey: key ?? `confirm-${purchaseOrderId}`,
            })

          yield* TestClock.setTime(Date.UTC(2026, 2, 10, 3))

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

          const draftOrder = () =>
            procurement.createPurchaseOrder({
              ...scope,
              supplierAccountId: supplier.id,
              lines: [{ itemId: uuidv7(), quantity: "2", unitPrice: "12.50" }],
            })

          // A draft has no number, and PostgreSQL refuses to give one to a draft.
          const draft = yield* draftOrder()
          assert.strictEqual(draft.number, null)

          const numberedDraft = yield* postgresFailure(
            () => client`
              update procurement.purchase_orders set number = 'PO/2026/00001' where id = ${draft.id}
            `,
          )

          assert.strictEqual(
            postgresConstraint(numberedDraft),
            "purchase_orders_draft_number_check",
          )

          // Confirming numbers the order in its supplier's legal entity; the same key repeats it.
          const confirmed = yield* confirm(procurement, draft.id)
          assert.strictEqual(confirmed.number, "PO/2026/00001")

          // The legal entity the number was issued in is recorded with the order.
          const [recorded] = yield* Effect.promise(
            () => client<{ legalEntityId: string | null }[]>`
              select legal_entity_id as "legalEntityId" from procurement.purchase_orders
              where id = ${draft.id}
            `,
          )

          assert.strictEqual(recorded?.legalEntityId, legalEntityId)
          assert.strictEqual((yield* confirm(procurement, draft.id)).number, "PO/2026/00001")

          assert.strictEqual(
            (yield* procurement.getPurchaseOrder({ ...scope, purchaseOrderId: draft.id })).number,
            "PO/2026/00001",
          )

          const second = yield* draftOrder()

          // Numbering reads the supplier's relationship, so a caller who may not read it is denied
          // and takes no number.
          const denied = yield* Effect.flip(
            procurement.confirmPurchaseOrder({
              principal: confirmer,
              tenantId,
              purchaseOrderId: second.id,
              idempotencyKey: "limited-confirmer",
            }),
          )

          assert.instanceOf(denied, AuthorizationDenied)
          assert.strictEqual((yield* confirm(procurement, second.id)).number, "PO/2026/00002")

          // A confirmation that fails after the number is allocated rolls the number back.
          const messaging = yield* MessagingService
          const database = yield* Database
          const authorization = yield* AuthorizationService

          const failing = yield* Effect.provide(
            makeProcurementService,
            Layer.mergeAll(
              Layer.succeed(Database, database),
              Layer.succeed(AuthorizationService, authorization),
              Layer.succeed(PartyService, party),
              Layer.succeed(MessagingService, {
                ...messaging,
                append: () =>
                  Effect.fail(
                    new DatabaseFailure({ operation: "messaging.test.append", cause: null }),
                  ),
              }),
              NumberingLive.pipe(Layer.provide(Layer.succeed(Database, database))),
            ),
          )

          const lost = yield* draftOrder()
          yield* Effect.flip(confirm(failing, lost.id))

          assert.strictEqual(
            (yield* procurement.getPurchaseOrder({ ...scope, purchaseOrderId: lost.id })).status,
            "draft",
          )

          assert.deepStrictEqual(yield* issued(), ["1", "2"])
          assert.strictEqual((yield* confirm(procurement, lost.id)).number, "PO/2026/00003")
          assert.deepStrictEqual(yield* issued(), ["1", "2", "3"])

          // The series restarts at 1 in the next fiscal year (the calendar year without a calendar).
          yield* TestClock.setTime(Date.UTC(2027, 0, 2, 3))
          const newYear = yield* draftOrder()
          assert.strictEqual((yield* confirm(procurement, newYear.id)).number, "PO/2027/00001")
        }).pipe(Effect.provide(erpChainLayers(client, grants)))
      }),
    ),
  { timeout: 180_000 },
)
