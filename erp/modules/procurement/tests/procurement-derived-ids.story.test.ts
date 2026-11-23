import { assert, describe, it } from "@effect/vitest"
import * as Predicate from "effect/Predicate"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import {
  CreateSupplierAccount,
  Procurement,
  SupplierAccount,
  SupplierAccountAlreadyExists,
  SupplierAccountCreated,
  SupplierRelationshipNotEligible,
  supplierAccountId,
} from "../src/domain-model.ts"
import { supplierAccountInstanceKey } from "../src/supplier-account.ts"

const { Story } = Domain

const story = Story.make(Procurement)

const tenantA = "00000000-0000-7000-8000-00000000000a"
const tenantB = "00000000-0000-7000-8000-00000000000b"
const relationship = "00000000-0000-7000-8000-0000000000e1"

const create = (kind: string, active: boolean) =>
  new CreateSupplierAccount({
    relationship: { kind, active },
    partyId: "party-1",
    legalEntityId: "le-1",
  })

const created = new SupplierAccountCreated({ partyId: "party-1", legalEntityId: "le-1" })

const account = SupplierAccount.ref(supplierAccountId(tenantA, relationship))

describe("Procurement derived ids on Alchemy", () => {
  it("the model is well defined", () => assert.deepStrictEqual(Domain.verify(Procurement), []))

  // [PRC-SUP-1]
  it("derives the instance key from the tenant and the Party relationship", () => {
    assert.strictEqual(
      supplierAccountInstanceKey(tenantA, relationship),
      `${tenantA}/${relationship}`,
    )
    assert.notStrictEqual(
      supplierAccountInstanceKey(tenantA, relationship),
      supplierAccountInstanceKey(tenantB, relationship),
    )
  })

  // [PRC-SUP-1]
  it.effect("creates the one Supplier Account of an active supplier relationship", () =>
    story(
      Story.when(account, create("supplier", true)),
      Story.then(account, created),
      Story.state(account, (state) => assert.isFalse(Predicate.isTagged(state, "None"))),
    ),
  )

  // [PRC-SUP-1]
  it.effect("a second creation for the relationship is refused and records nothing", () =>
    story(
      Story.given(account, created),
      Story.when(account, create("supplier", true)),
      Story.rejected(new SupplierAccountAlreadyExists()),
      Story.then(account),
    ),
  )

  // [PRC-SUP-1]
  it.effect("rejects a missing, non-supplier, or inactive relationship", () =>
    story(
      Story.when(
        account,
        new CreateSupplierAccount({ relationship: null, partyId: "p", legalEntityId: "l" }),
      ),
      Story.rejected(new SupplierRelationshipNotEligible()),
      Story.when(account, create("customer", true)),
      Story.rejected(new SupplierRelationshipNotEligible()),
      Story.when(account, create("supplier", false)),
      Story.rejected(new SupplierRelationshipNotEligible()),
      Story.then(account),
      Story.state(account, (state) => assert.isTrue(Predicate.isTagged(state, "None"))),
    ),
  )

  // [PRC-SUP-1]
  it.effect("refuses an ineligible relationship before it looks for an existing account", () =>
    story(
      Story.given(account, created),
      Story.when(account, create("supplier", false)),
      Story.rejected(new SupplierRelationshipNotEligible()),
    ),
  )

  // [PRC-SUP-1]
  it.effect("the same relationship id in another tenant is a different, empty instance", () => {
    const other = SupplierAccount.ref(supplierAccountId(tenantB, relationship))

    return story(
      Story.given(account, created),
      Story.when(other, create("supplier", true)),
      Story.then(other, created),
    )
  })
})
