/**
 * The pure parts of PRC-SUP-1: which Party relationship may own a Supplier Account, and the
 * Alchemy instance key that makes the account unique per relationship. Production calls both
 * (`store.ts`, `memory.ts`); the class C model calls the same functions.
 */

/** Only an active relationship of kind `supplier` may own a Supplier Account. */
export const isEligibleSupplierRelationship = (relationship: {
  readonly kind: string
  readonly active: boolean
}) => relationship.kind === "supplier" && relationship.active

/**
 * `<tenantId>/<supplierRelationshipId>`: the instance key of the one Supplier Account of a Party
 * relationship. Neither part changes after creation. It is not the row id, which stays a UUIDv7.
 */
export const supplierAccountInstanceKey = (tenantId: string, supplierRelationshipId: string) =>
  `${tenantId}/${supplierRelationshipId}`
