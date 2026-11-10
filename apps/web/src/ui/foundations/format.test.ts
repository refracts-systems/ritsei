import { assert, describe, it } from "@effect/vitest"
import { formatCount, formatDecimal } from "./format.ts"

describe("formatCount", () => {
  it("uses the singular noun for exactly one", () => {
    assert.equal(formatCount(1, "entry", "entries"), "1 entry")
  })

  it("uses the plural noun for zero and for many", () => {
    assert.equal(formatCount(0, "entry", "entries"), "0 entries")
    assert.equal(formatCount(12, "record", "records"), "12 records")
  })
})

describe("formatDecimal", () => {
  it("groups the integer part without touching the fraction", () => {
    assert.equal(formatDecimal("24750000.00", "en"), "24,750,000.00")
  })

  it("returns anything that is not a plain decimal unchanged", () => {
    assert.equal(formatDecimal("n/a", "en"), "n/a")
  })
})
