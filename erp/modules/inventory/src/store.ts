import type { InventoryService } from "./contract.ts"

/** Persistence-facing inventory operations. Implementations preserve transaction semantics. */
export type InventoryStore = InventoryService
