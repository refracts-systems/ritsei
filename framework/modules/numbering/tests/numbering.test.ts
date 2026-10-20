import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import { uuidv7 } from "../../../foundation/mod.ts"
import { fiscalPeriodKey, makeNumberingTestLayer, NumberingService } from "../mod.ts"
import type { Overrides } from "../../../../tests/support/overrides.ts"

const tenantId = "018f2000-0000-7000-8000-0000000000a1"
const scopeId = "018f2000-0000-7000-8000-0000000000b1"
const otherScopeId = "018f2000-0000-7000-8000-0000000000b2"

const requestFields = () => ({
  tenantId,
  scopeId,
  documentType: "billing.customer_invoice",
  documentId: uuidv7(),
  documentDate: "2026-10-20",
  fiscalYearStartMonth: 1,
  prefix: "INV/",
})

const request = (overrides: Overrides<ReturnType<typeof requestFields>> = {}) => ({
  ...requestFields(),
  ...overrides,
})

describe("numbering", () => {
  it("labels fiscal years by the calendar year in which they start", () => {
    assert.strictEqual(fiscalPeriodKey("2026-10-20", 1), "2026")
    assert.strictEqual(fiscalPeriodKey("2026-03-31", 4), "2025")
    assert.strictEqual(fiscalPeriodKey("2026-04-01", 4), "2026")
  })

  it.effect("issues consecutive numbers per scope, document type, and fiscal year", () =>
    Effect.gen(function* () {
      const numbering = yield* NumberingService
      const first = yield* numbering.allocate(request())
      const second = yield* numbering.allocate(request())
      const otherScope = yield* numbering.allocate(request({ scopeId: otherScopeId }))
      const otherType = yield* numbering.allocate(
        request({ documentType: "accounting.journal", prefix: "JE/" }),
      )
      const nextYear = yield* numbering.allocate(request({ documentDate: "2027-01-02" }))
      assert.deepStrictEqual(
        [first.number, second.number, otherScope.number, otherType.number, nextYear.number],
        ["INV/2026/00001", "INV/2026/00002", "INV/2026/00001", "JE/2026/00001", "INV/2027/00001"],
      )
    }).pipe(Effect.provide(makeNumberingTestLayer())),
  )

  it.effect("returns the same number when a document allocates again", () =>
    Effect.gen(function* () {
      const numbering = yield* NumberingService
      const documentId = uuidv7()
      const first = yield* numbering.allocate(request({ documentId }))
      const again = yield* numbering.allocate(request({ documentId }))
      const next = yield* numbering.allocate(request())
      assert.deepStrictEqual(again, first)
      assert.strictEqual(next.value, first.value + 1)
    }).pipe(Effect.provide(makeNumberingTestLayer())),
  )

  it.effect("rejects malformed document types and dates", () =>
    Effect.gen(function* () {
      const numbering = yield* NumberingService
      const badType = yield* Effect.flip(numbering.allocate(request({ documentType: "Invoice" })))
      const badDate = yield* Effect.flip(
        numbering.allocate(request({ documentDate: "2026-02-30" })),
      )
      assert.strictEqual(badType._tag, "SchemaError")
      assert.strictEqual(badDate._tag, "SchemaError")
    }).pipe(Effect.provide(makeNumberingTestLayer())),
  )
})
