import * as Data from "effect/Data"

/** Pure decision of `createPartyCustomer` (SAL-CUST-2). */

export type PartyCustomerDecision = Data.TaggedEnum<{
  /** An active customer relationship with no customer yet: create one from Party. */
  Create: {}
  /** The relationship already has a customer: return it, create nothing. */
  Existing: {}
  /** Not an active relationship of kind `customer`. */
  InvalidRole: {}
}>

export const PartyCustomerDecision = Data.taggedEnum<PartyCustomerDecision>()

/** The role check comes first, so a customer whose relationship was since deactivated is refused. */
export const decidePartyCustomer = (
  relationship: { readonly kind: string; readonly active: boolean },
  hasCustomer: boolean,
): PartyCustomerDecision => {
  if (relationship.kind !== "customer" || !relationship.active) {
    return PartyCustomerDecision.InvalidRole()
  }

  return hasCustomer ? PartyCustomerDecision.Existing() : PartyCustomerDecision.Create()
}
