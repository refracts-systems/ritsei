import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Result from "effect/Result"

import { uuidv7 } from "../../../../framework/foundation/mod.ts"
import { makeAuthorizationTestLayer } from "../../../../framework/modules/authorization/mod.ts"
import { makeMessagingTestLayer } from "../../../../framework/modules/messaging/mod.ts"
import { runMigrations } from "../../../../framework/platform/mod.ts"
import { seedErpFixture } from "../../../../tests/support/erp-fixture.ts"
import { erpChainLayers } from "../../../../tests/support/erp-layers.ts"
import { withTemporaryDatabase } from "../../../../tests/support/postgres-database.ts"
import { makePartyTestLayer, PartyCapabilities, PartyService } from "../../party/mod.ts"
import { InventoryCapabilities } from "../../inventory/mod.ts"
import { ProductCapabilities } from "../../product/mod.ts"
import { TaxCapabilities } from "../../tax/mod.ts"
import { makeProcurementTestLayer, ProcurementCapabilities, ProcurementService } from "../mod.ts"

const databaseUrl = process.env["DATABASE_URL"]
const principal = { userAccountId: "lifecycle-differential", sessionId: "session" }
const memoryTenantId = "00000000-0000-4000-8000-000000000001"

type Procurement = typeof ProcurementService.Service

/**
 * One scenario of confirmations and cancellations, as a trace of what each step returned: the status
 * it returned, or the tag of the failure (with the status for an invalid state).
 */
const trace = (procurement: Procurement, tenantId: string, supplierAccountId: string) => {
  const scope = { principal, tenantId }
  const line = { itemId: uuidv7(), quantity: "2", unitPrice: "12.50" }

  const describe = <A extends { readonly status: string }, E extends { readonly _tag: string }>(
    effect: Effect.Effect<A, E>,
  ) =>
    effect.pipe(
      Effect.result,
      Effect.map((result) => {
        if (Result.isSuccess(result)) return result.success.status

        return "status" in result.failure
          ? `${result.failure._tag}(${String(result.failure.status)})`
          : result.failure._tag
      }),
    )

  return Effect.gen(function* () {
    const create = () =>
      procurement.createPurchaseOrder({ ...scope, supplierAccountId, lines: [line] })

    const confirm = (purchaseOrderId: string, key: string) =>
      describe(procurement.confirmPurchaseOrder({ ...scope, purchaseOrderId, idempotencyKey: key }))

    const cancel = (purchaseOrderId: string) =>
      describe(procurement.cancelPurchaseOrder({ ...scope, purchaseOrderId }))

    const first = yield* create()
    const second = yield* create()
    const missing = uuidv7()

    return [
      yield* cancel(first.id), // a draft cannot be cancelled
      yield* confirm(first.id, "k1"), // draft confirms
      yield* confirm(first.id, "k1"), // the same key returns the confirmed order
      yield* confirm(first.id, "k2"), // another key on a confirmed order conflicts
      yield* confirm(second.id, "k1"), // a key another order used conflicts
      yield* confirm(second.id, "k3"), // a different order confirms with its own key
      yield* cancel(first.id), // confirmed cancels
      yield* cancel(first.id), // cancelling again returns the cancelled order
      yield* confirm(first.id, "k1"), // a cancelled order never reconfirms
      yield* confirm(first.id, "k9"),
      yield* confirm(missing, "k1"), // unknown orders are not found
      yield* cancel(missing),
    ]
  })
}

// [PRC-PO-1] [PRC-PO-3]
it.effect.skipIf(databaseUrl === undefined)(
  "the memory and PostgreSQL stores answer the same confirmation and cancellation scenario alike",
  () =>
    Effect.gen(function* () {
      // Memory store.
      const memoryGrants = [
        PartyCapabilities.partyCreate,
        PartyCapabilities.legalEntityCreate,
        PartyCapabilities.partyRoleAssign,
        PartyCapabilities.partyRelationshipCreate,
        PartyCapabilities.partyRelationshipRead,
        ProcurementCapabilities.supplierAccountCreate,
        ProcurementCapabilities.purchaseOrderCreate,
        ProcurementCapabilities.purchaseOrderConfirm,
        ProcurementCapabilities.purchaseOrderRead,
        ProcurementCapabilities.purchaseOrderCancel,
      ].map((capability) => ({
        userAccountId: principal.userAccountId,
        tenantId: memoryTenantId,
        capability,
      }))

      const authorization = makeAuthorizationTestLayer(memoryGrants)
      const party = makePartyTestLayer().pipe(Layer.provide(authorization))

      const procurementLayer = makeProcurementTestLayer().pipe(
        Layer.provide(Layer.mergeAll(authorization, party, makeMessagingTestLayer())),
      )

      const fromMemory = yield* Effect.gen(function* () {
        const parties = yield* PartyService
        const procurement = yield* ProcurementService
        const scope = { principal, tenantId: memoryTenantId }

        const owner = yield* parties.create({ ...scope, kind: "organization", name: "Buyer" })

        const legalEntity = yield* parties.createLegalEntity({
          ...scope,
          organizationId: owner.id,
        })

        const supplier = yield* parties.create({ ...scope, kind: "organization", name: "Vendor" })
        yield* parties.assignRole({ ...scope, partyId: supplier.id, role: "supplier" })

        const relationship = yield* parties.createRelationship({
          ...scope,
          partyId: supplier.id,
          legalEntityId: legalEntity.id,
          kind: "supplier",
        })

        const account = yield* procurement.createSupplierAccount({
          ...scope,
          supplierRelationshipId: relationship.id,
        })

        return yield* trace(procurement, memoryTenantId, account.id)
      }).pipe(Effect.provide(Layer.merge(party, procurementLayer)))

      // PostgreSQL store, through the same service contract.
      const fromPostgres = yield* withTemporaryDatabase(databaseUrl!, (client) =>
        Effect.gen(function* () {
          yield* runMigrations(client)
          const { tenantId, legalEntityId } = yield* seedErpFixture(client)

          const grants = [
            ...Object.values(InventoryCapabilities),
            ...Object.values(PartyCapabilities),
            ...Object.values(ProcurementCapabilities),
            ...Object.values(ProductCapabilities),
            ...Object.values(TaxCapabilities),
          ].map((capability) => ({ userAccountId: principal.userAccountId, tenantId, capability }))

          return yield* Effect.gen(function* () {
            const parties = yield* PartyService
            const procurement = yield* ProcurementService
            const scope = { principal, tenantId }

            const supplier = yield* parties.create({
              ...scope,
              kind: "organization",
              name: "Vendor",
            })

            yield* parties.assignRole({ ...scope, partyId: supplier.id, role: "supplier" })

            const relationship = yield* parties.createRelationship({
              ...scope,
              partyId: supplier.id,
              legalEntityId,
              kind: "supplier",
            })

            const account = yield* procurement.createSupplierAccount({
              ...scope,
              supplierRelationshipId: relationship.id,
            })

            return yield* trace(procurement, tenantId, account.id)
          }).pipe(Effect.provide(erpChainLayers(client, grants)))
        }),
      )

      assert.deepStrictEqual(fromMemory, [
        "PurchaseOrderInvalidState(draft)",
        "confirmed",
        "confirmed",
        "PurchaseOrderConfirmationIdempotencyConflict",
        "PurchaseOrderConfirmationIdempotencyConflict",
        "confirmed",
        "cancelled",
        "cancelled",
        "PurchaseOrderInvalidState(cancelled)",
        "PurchaseOrderInvalidState(cancelled)",
        "PurchaseOrderNotFound",
        "PurchaseOrderNotFound",
      ])

      assert.deepStrictEqual(fromPostgres, fromMemory)
    }),
  { timeout: 180_000 },
)
