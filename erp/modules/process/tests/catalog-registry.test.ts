import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { AccountingTypedActionCatalog, AccountingTypedEventCatalog } from "../../accounting/mod.ts"
import {
  IdentityTypedActionCatalog,
  IdentityTypedEventCatalog,
} from "../../../../framework/modules/identity/mod.ts"
import { InventoryTypedActionCatalog, InventoryTypedEventCatalog } from "../../inventory/mod.ts"
import { PartyTypedActionCatalog, PartyTypedEventCatalog } from "../../party/mod.ts"
import {
  ProcurementTypedActionCatalog,
  ProcurementTypedEventCatalog,
} from "../../procurement/mod.ts"
import { SalesTypedActionCatalog, SalesTypedEventCatalog } from "../../sales/mod.ts"
import { ProcessOrderConfirmationCompletedEvent, ProcessTypedEventCatalog } from "../mod.ts"
import {
  makeProcessCatalogRegistry,
  ProcessCatalogConflict,
  ResolveProcessCatalogInput,
} from "../mod.ts"

describe("catalog compatibility", () => {
  it.effect("resolves registered PUBLIC actions and events", () =>
    Effect.gen(function* () {
      const registry = yield* makeProcessCatalogRegistry([
        ...IdentityTypedActionCatalog,
        ...IdentityTypedEventCatalog,
        ...PartyTypedActionCatalog,
        ...PartyTypedEventCatalog,
        ...InventoryTypedActionCatalog,
        ...InventoryTypedEventCatalog,
        ...AccountingTypedActionCatalog,
        ...AccountingTypedEventCatalog,
        ...SalesTypedActionCatalog,
        ...SalesTypedEventCatalog,
        ...ProcurementTypedActionCatalog,
        ...ProcurementTypedEventCatalog,
        ...ProcessTypedEventCatalog,
      ])

      const action = registry.resolveReleasedCapability({
        kind: "DomainAction",
        id: "inventory.stock.adjust",
        version: 1,
      })
      const event = registry.resolveReleasedCapability({
        kind: "DomainEvent",
        id: "process.order_confirmation.completed",
        version: 1,
      })

      assert.strictEqual(action?.id, "inventory.stock.adjust")
      assert.strictEqual(event?.id, "process.order_confirmation.completed")
      assert.strictEqual(registry.entries.length, 17)
    }),
  )

  it.effect("rejects unregistered actions and events", () =>
    Effect.gen(function* () {
      const registry = yield* makeProcessCatalogRegistry([ProcessOrderConfirmationCompletedEvent])

      assert.isUndefined(
        registry.resolveReleasedCapability({
          kind: "DomainAction",
          id: "sales.order.confirm",
          version: 1,
        }),
      )
      assert.isUndefined(
        registry.resolveReleasedCapability({
          kind: "DomainEvent",
          id: "process.order_confirmation.missing",
          version: 1,
        }),
      )

      const privateRegistry = yield* makeProcessCatalogRegistry([
        {
          ...ProcessOrderConfirmationCompletedEvent,
          id: "process.private.example",
          stability: "PRIVATE",
        },
      ])
      assert.isUndefined(
        privateRegistry.resolveReleasedCapability({
          kind: "DomainEvent",
          id: "process.private.example",
          version: 1,
        }),
      )
    }),
  )

  it.effect("rejects duplicate catalog identities", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        makeProcessCatalogRegistry([
          ProcessOrderConfirmationCompletedEvent,
          ProcessOrderConfirmationCompletedEvent,
        ]),
      )

      assert.instanceOf(failure, ProcessCatalogConflict)
      assert.strictEqual(failure.id, ProcessOrderConfirmationCompletedEvent.id)
      assert.strictEqual(failure.version, 1)
    }),
  )

  it.effect("validates catalog lookup input", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        Schema.decodeUnknownEffect(ResolveProcessCatalogInput)({
          kind: "DomainAction",
          id: "",
          version: 0,
        }),
      )

      assert.strictEqual(failure._tag, "SchemaError")
    }),
  )
})
