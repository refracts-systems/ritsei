import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import { InventoryTypedActionCatalog } from "../../inventory/mod.ts"
import {
  makeProcessCatalogRegistry,
  ProcessCatalogConflict,
  ProcessOrderConfirmationCompletedEvent,
  ProcessReleaseValidationFailed,
  ProcessTypedEventCatalog,
  validateProcessRelease,
} from "../mod.ts"

it.effect("validates a released process against exact catalog compatibility", () =>
  Effect.gen(function* () {
    const registry = yield* makeProcessCatalogRegistry([
      ...InventoryTypedActionCatalog,
      ...ProcessTypedEventCatalog,
    ])
    const validation = yield* validateProcessRelease(registry, {
      definitionId: "018f3f77-0c5a-7cc0-8b62-6a163d214123",
      definitionVersion: 1,
      catalogVersion: 1,
      references: [
        {
          kind: "DomainAction",
          id: "inventory.stock.adjust",
          version: 1,
        },
        {
          kind: "DomainEvent",
          id: "process.order_confirmation.completed",
          version: 1,
        },
      ],
    })

    assert.strictEqual(validation.status, "VALIDATED")
    assert.strictEqual(validation.references.length, 2)
  }),
)

it.effect("rejects unregistered actions before a released process", () =>
  Effect.gen(function* () {
    const registry = yield* makeProcessCatalogRegistry([ProcessOrderConfirmationCompletedEvent])
    const failure = yield* Effect.flip(
      validateProcessRelease(registry, {
        definitionId: "018f3f77-0c5a-7cc0-8b62-6a163d214123",
        definitionVersion: 1,
        catalogVersion: 1,
        references: [
          {
            kind: "DomainAction",
            id: "sales.order.confirm",
            version: 1,
          },
        ],
      }),
    )

    assert.instanceOf(failure, ProcessReleaseValidationFailed)
    assert.strictEqual(failure.id, "sales.order.confirm")
  }),
)

it.effect("rejects a private event from a released process", () =>
  Effect.gen(function* () {
    const privateEvent = {
      ...ProcessOrderConfirmationCompletedEvent,
      id: "process.private.example",
      stability: "PRIVATE" as const,
    }
    const registry = yield* makeProcessCatalogRegistry([privateEvent])
    const failure = yield* Effect.flip(
      validateProcessRelease(registry, {
        definitionId: "018f3f77-0c5a-7cc0-8b62-6a163d214123",
        definitionVersion: 1,
        catalogVersion: 1,
        references: [
          {
            kind: "DomainEvent",
            id: "process.private.example",
            version: 1,
          },
        ],
      }),
    )

    assert.instanceOf(failure, ProcessReleaseValidationFailed)
  }),
)

it.effect("keeps duplicate catalog identities out of release validation", () =>
  Effect.gen(function* () {
    const failure = yield* Effect.flip(
      makeProcessCatalogRegistry([
        InventoryTypedActionCatalog[0]!,
        InventoryTypedActionCatalog[0]!,
      ]),
    )

    assert.instanceOf(failure, ProcessCatalogConflict)
  }),
)
