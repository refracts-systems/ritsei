import { assert, describe, it } from "@effect/vitest"

import { PostingRole } from "../../accounting/mod.ts"
import { indonesiaTrading, identifierRejection, nikRejection, npwpRejection } from "../mod.ts"

describe("Indonesian taxpayer identifiers", () => {
  it("accepts an NPWP of 15 or 16 digits, written with dots and dashes or not", () => {
    assert.isUndefined(npwpRejection("01.234.567.8-901.000"))
    assert.isUndefined(npwpRejection("012345678901000"))
    assert.isUndefined(npwpRejection("0123456789010001"))
  })

  it("rejects an NPWP with the wrong number of digits or with letters", () => {
    assert.isDefined(npwpRejection("12345"))
    assert.isDefined(npwpRejection("01.234.567.8-901.00"))
    assert.isDefined(npwpRejection("0123456789010AB0"))
  })

  it("accepts a NIK with a real birth date, for men and for women", () => {
    assert.isUndefined(nikRejection("3171011503900001"))
    assert.isUndefined(nikRejection("3171015503900001"))
  })

  it("rejects a NIK of the wrong length or with an impossible birth date", () => {
    assert.isDefined(nikRejection("317101150390000"))
    assert.isDefined(nikRejection("3171019903900001"))
    assert.isDefined(nikRejection("3171011513900001"))
  })

  it("applies a rule only to the schemes it knows", () => {
    assert.isDefined(identifierRejection({ scheme: "NPWP", value: "123" }))
    assert.isDefined(identifierRejection({ scheme: "NIK", value: "123" }))
    assert.isUndefined(identifierRejection({ scheme: "PASSPORT", value: "123" }))
  })
})

describe("Indonesian chart template", () => {
  const codes = indonesiaTrading.accounts.map((account) => account.code)

  it("has unique account codes and parents that exist", () => {
    assert.strictEqual(new Set(codes).size, codes.length)

    for (const account of indonesiaTrading.accounts) {
      assert.isTrue(account.parentCode === undefined || codes.includes(account.parentCode))
    }
  })

  it("maps every posting role to an account of the chart", () => {
    for (const role of PostingRole.literals) {
      assert.isTrue(codes.includes(indonesiaTrading.postingRules[role]), role)
    }
  })
})
