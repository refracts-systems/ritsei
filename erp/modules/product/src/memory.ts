import * as Effect from "effect/Effect"

import { uuidv7 } from "../../../../framework/foundation/mod.ts"
import type { Product } from "./contract.ts"
import { ProductAlreadyExists } from "./errors.ts"
import type { ProductStore } from "./store.ts"

/** Deterministic test store with the same tenant-scoped unique-code invariant. */
export const makeProductMemoryStore = (): ProductStore => {
  const records: Product[] = []
  return {
    listProducts: (command) =>
      Effect.sync(() => {
        const search = command.search?.toLowerCase()
        return records
          .filter(
            (record) =>
              record.tenantId === command.tenantId &&
              (command.type === undefined || record.type === command.type) &&
              (search === undefined ||
                record.code.toLowerCase().includes(search) ||
                record.name.toLowerCase().includes(search)),
          )
          .toSorted((left, right) => left.code.localeCompare(right.code))
          .slice(0, command.limit ?? 200)
      }),
    getProduct: (tenantId, productId) =>
      Effect.sync(() =>
        records.find((record) => record.tenantId === tenantId && record.id === productId),
      ),
    createProduct: (command) =>
      Effect.suspend(() => {
        const duplicate = records.some(
          (record) => record.tenantId === command.tenantId && record.code === command.code,
        )
        if (duplicate) {
          return Effect.fail(
            new ProductAlreadyExists({ tenantId: command.tenantId, code: command.code }),
          )
        }
        const record: Product = {
          id: uuidv7(),
          tenantId: command.tenantId,
          code: command.code,
          name: command.name,
          type: command.type,
          category: command.category ?? null,
          unitOfMeasure: command.unitOfMeasure ?? "EA",
          active: true,
        }
        records.push(record)
        return Effect.succeed(record)
      }),
  }
}
