import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Result from "effect/Result"

import * as Domain from "../../../../framework/foundation/domain-model/mod.ts"
import { uuidv7 } from "../../../../framework/foundation/mod.ts"
import {
  AuthorizationDenied,
  makeAuthorizationTestLayer,
} from "../../../../framework/modules/authorization/mod.ts"
import {
  ComputeTax,
  CreateTaxCode,
  MemoryTaxCodeStore,
  ScheduleTaxCodeRate,
  TaxCode,
  TaxCodeCreated,
  TaxCodeNotFound,
  TaxCodeRateAlreadyExists,
  TaxCodeRateScheduled,
  TaxModel,
  TaxModelHandlers,
} from "../src/domain-model.ts"
import {
  TaxCapabilities,
  makeTaxTestLayer,
  TaxCodeNotFound as ServiceTaxCodeNotFound,
  TaxService,
} from "../mod.ts"

const { Story } = Domain

const story = Story.make(TaxModel, {
  layer: TaxModelHandlers.pipe(Layer.provide(MemoryTaxCodeStore)),
})

const vatId = "018f2000-0000-7000-8000-000000000a01"
const luxuryId = "018f2000-0000-7000-8000-000000000a02"
const inputVatId = "018f2000-0000-7000-8000-000000000a03"
const unknownId = "018f2000-0000-7000-8000-000000000aff"

const vat = TaxCode.ref(vatId)
const luxury = TaxCode.ref(luxuryId)
const inputVat = TaxCode.ref(inputVatId)

const vatCreated = new TaxCodeCreated({ code: "VAT11", rate: "11.0000", direction: "sales" })
const luxuryCreated = new TaxCodeCreated({ code: "LUX", rate: "12.5000", direction: "sales" })
const inputCreated = new TaxCodeCreated({ code: "IN11", rate: "11.0000", direction: "purchase" })

const line = (key: string, base: string, taxCodeId: string | null) => ({ key, base, taxCodeId })

describe("Tax on Alchemy, class A rules", () => {
  it("the model is well defined", () => assert.deepStrictEqual(Domain.verify(TaxModel), []))

  // [TAX-CALC-1] The rounding itself is `taxOn`, which tax-arithmetic.test.ts covers by property;
  // here the story shows that tax is rounded on each line and never on the document total.
  it.effect("[TAX-CALC-1] rounds half up on each line, so a total is the sum of its lines", () =>
    story(
      Story.when(vat, new CreateTaxCode({ code: "VAT11", rate: "11", direction: "sales" })),
      Story.then(vat, vatCreated),
      Story.when(luxury, new CreateTaxCode({ code: "LUX", rate: "10", direction: "sales" })),
      Story.then(luxury, new TaxCodeCreated({ code: "LUX", rate: "10.0000", direction: "sales" })),
      // 0.05 at 10% is exactly half a cent: it rounds up. 0.04 rounds down.
      Story.query(
        ComputeTax,
        {
          direction: "sales",
          lines: [
            line("a", "0.05", luxuryId),
            line("b", "0.05", luxuryId),
            line("c", "0.04", luxuryId),
          ],
        },
        (computation) => {
          assert.deepStrictEqual(
            computation.lines.map((l) => l.tax),
            ["0.01", "0.01", "0.00"],
          )
          // Rounding the 0.14 total once would give 0.01.
          assert.strictEqual(computation.totalTax, "0.02")
          assert.deepStrictEqual(computation.summary, [
            { taxCodeId: luxuryId, base: "0.14", tax: "0.02" },
          ])
        },
      ),
    ),
  )

  // [TAX-CALC-2]
  it.effect(
    "[TAX-CALC-2] computes per line and per code, and leaves a line without a code untaxed",
    () =>
      story(
        Story.given(vat, vatCreated),
        Story.given(luxury, luxuryCreated),
        Story.query(
          ComputeTax,
          {
            direction: "sales",
            lines: [
              line("a", "100.00", vatId),
              line("b", "33.33", luxuryId),
              line("c", "10.00", null),
              line("d", "45.50", vatId),
            ],
          },
          (computation) => {
            assert.deepStrictEqual(
              computation.lines.map((l) => [l.key, l.taxCodeId, l.rate, l.tax]),
              [
                ["a", vatId, "11.0000", "11.00"],
                ["b", luxuryId, "12.5000", "4.17"],
                ["c", null, "0.0000", "0.00"],
                ["d", vatId, "11.0000", "5.01"],
              ],
            )
            // One summary row per code, in order of first appearance.
            assert.deepStrictEqual(computation.summary, [
              { taxCodeId: vatId, base: "145.50", tax: "16.01" },
              { taxCodeId: luxuryId, base: "33.33", tax: "4.17" },
            ])
            assert.strictEqual(computation.totalTax, "20.18")
          },
        ),
      ),
  )

  // [TAX-CALC-2]
  it.effect(
    "[TAX-CALC-2] refuses a code of the other direction, and a code that does not exist",
    () =>
      story(
        Story.given(vat, vatCreated),
        Story.given(inputVat, inputCreated),
        Story.query(ComputeTax, {
          direction: "sales",
          lines: [line("a", "1.00", vatId), line("b", "1.00", inputVatId)],
        }),
        Story.rejected(new TaxCodeNotFound({ taxCodeId: inputVatId })),
        Story.query(ComputeTax, {
          direction: "purchase",
          lines: [line("a", "1.00", vatId)],
        }),
        Story.rejected(new TaxCodeNotFound({ taxCodeId: vatId })),
        Story.query(ComputeTax, {
          direction: "sales",
          lines: [line("a", "1.00", unknownId), line("b", "1.00", inputVatId)],
        }),
        Story.rejected(new TaxCodeNotFound({ taxCodeId: unknownId })),
        // The same code is fine in its own direction.
        Story.query(
          ComputeTax,
          { direction: "purchase", lines: [line("a", "100.00", inputVatId)] },
          (computation) => assert.strictEqual(computation.totalTax, "11.00"),
        ),
      ),
  )

  // [TAX-RATE-1]
  it.effect("[TAX-RATE-1] charges the latest period starting on or before the date", () =>
    story(
      Story.given(vat, vatCreated),
      // Added out of order on purpose.
      Story.when(vat, new ScheduleTaxCodeRate({ effectiveFrom: "2035-07-01", rate: "13" })),
      Story.then(vat, new TaxCodeRateScheduled({ effectiveFrom: "2035-07-01", rate: "13.0000" })),
      Story.when(vat, new ScheduleTaxCodeRate({ effectiveFrom: "2030-01-01", rate: "12" })),
      Story.then(vat, new TaxCodeRateScheduled({ effectiveFrom: "2030-01-01", rate: "12.0000" })),
      ...rateOn(undefined, "11.0000", "11.00"),
      ...rateOn("2029-12-31", "11.0000", "11.00"),
      ...rateOn("2030-01-01", "12.0000", "12.00"),
      ...rateOn("2035-06-30", "12.0000", "12.00"),
      ...rateOn("2035-07-01", "13.0000", "13.00"),
      ...rateOn("2040-01-01", "13.0000", "13.00"),
    ),
  )

  // [TAX-RATE-1]
  it.effect(
    "[TAX-RATE-1] refuses a second period on a start date, at any rate, and keeps the first",
    () =>
      story(
        Story.given(vat, vatCreated),
        Story.when(vat, new ScheduleTaxCodeRate({ effectiveFrom: "2030-01-01", rate: "12" })),
        Story.then(vat, new TaxCodeRateScheduled({ effectiveFrom: "2030-01-01", rate: "12.0000" })),
        Story.when(vat, new ScheduleTaxCodeRate({ effectiveFrom: "2030-01-01", rate: "9" })),
        Story.rejected(
          new TaxCodeRateAlreadyExists({ taxCodeId: vatId, effectiveFrom: "2030-01-01" }),
        ),
        // Not idempotent: the same rate on the same date is refused too, since a period never changes.
        Story.when(vat, new ScheduleTaxCodeRate({ effectiveFrom: "2030-01-01", rate: "12" })),
        Story.rejected(
          new TaxCodeRateAlreadyExists({ taxCodeId: vatId, effectiveFrom: "2030-01-01" }),
        ),
        Story.then(vat),
        ...rateOn("2030-01-01", "12.0000", "12.00"),
        // A rate change is a later period.
        Story.when(vat, new ScheduleTaxCodeRate({ effectiveFrom: "2031-01-01", rate: "9" })),
        Story.then(vat, new TaxCodeRateScheduled({ effectiveFrom: "2031-01-01", rate: "9.0000" })),
        ...rateOn("2030-12-31", "12.0000", "12.00"),
        ...rateOn("2031-01-01", "9.0000", "9.00"),
      ),
  )

  // [TAX-RATE-1]
  it.effect("[TAX-RATE-1] schedules a period only on a tax code that exists", () =>
    story(
      Story.when(vat, new ScheduleTaxCodeRate({ effectiveFrom: "2030-01-01", rate: "12" })),
      Story.rejected(new TaxCodeNotFound({ taxCodeId: vatId })),
      Story.then(vat),
    ),
  )

  it.effect("creating a tax code again records nothing and keeps its periods", () =>
    story(
      Story.when(vat, new CreateTaxCode({ code: "VAT11", rate: "11", direction: "sales" })),
      Story.then(vat, vatCreated),
      Story.when(vat, new ScheduleTaxCodeRate({ effectiveFrom: "2030-01-01", rate: "12" })),
      Story.then(vat, new TaxCodeRateScheduled({ effectiveFrom: "2030-01-01", rate: "12.0000" })),
      Story.when(vat, new CreateTaxCode({ code: "VAT11", rate: "11", direction: "sales" })),
      Story.then(vat),
      ...rateOn("2030-01-01", "12.0000", "12.00"),
    ),
  )
})

// Authorization runs in the service before a command is sent (phase 0), so these stories run
// against the production memory service layer rather than the Alchemy model.
const principal = { userAccountId: "tax-user", sessionId: "tax-session" }
const tenantId = "018f2000-0000-7000-8000-0000000000aa"
const otherTenantId = "018f2000-0000-7000-8000-0000000000bb"

type Capability = (typeof TaxCapabilities)[keyof typeof TaxCapabilities]

const layerGranting = (grants: ReadonlyArray<{ capability: Capability; tenantId: string }>) =>
  makeTaxTestLayer().pipe(
    Layer.provide(
      makeAuthorizationTestLayer(
        grants.map((grant) => ({ userAccountId: principal.userAccountId, ...grant })),
      ),
    ),
  )

// Every operation of the service with the capability it needs, called as `scope`.
type Operation = readonly [Capability, (tax: TaxService) => Effect.Effect<unknown, unknown>]

const operations = (scope: { tenantId: string }): ReadonlyArray<Operation> => [
  [TaxCapabilities.taxCodeRead, (tax: TaxService) => tax.listTaxCodes({ principal, ...scope })],
  [
    TaxCapabilities.taxCodeRead,
    (tax: TaxService) =>
      tax.determineTaxCodes({ principal, ...scope, direction: "sales", productIds: [] }),
  ],
  [
    TaxCapabilities.taxCodeRead,
    (tax: TaxService) => tax.computeTax({ principal, ...scope, direction: "sales", lines: [] }),
  ],
  [
    TaxCapabilities.taxCodeCreate,
    (tax: TaxService) =>
      tax.createTaxCode({
        principal,
        ...scope,
        code: "X",
        name: "X",
        rate: "1",
        direction: "sales",
      }),
  ],
  [
    TaxCapabilities.taxRateSchedule,
    (tax: TaxService) =>
      tax.addTaxCodeRate({
        principal,
        ...scope,
        taxCodeId: uuidv7(),
        effectiveFrom: "2030-01-01",
        rate: "1",
      }),
  ],
  [
    TaxCapabilities.productTaxConfigure,
    (tax: TaxService) =>
      tax.setProductTaxDefault({
        principal,
        ...scope,
        productId: uuidv7(),
        direction: "sales",
        taxCodeId: uuidv7(),
      }),
  ],
]

const wasDenied = (result: Result.Result<unknown, unknown>) =>
  Result.isFailure(result) && result.failure instanceof AuthorizationDenied

describe("Tax authorization on the production service", () => {
  // [TAX-AUTH-1]
  it.effect("denies every operation without a grant", () =>
    Effect.gen(function* () {
      const tax = yield* TaxService

      for (const [capability, call] of operations({ tenantId })) {
        assert.isTrue(wasDenied(yield* Effect.result(call(tax))), capability)
      }
    }).pipe(Effect.provide(layerGranting([]))),
  )

  // [TAX-AUTH-1]
  it.effect(
    "allows an operation only with its own capability, so no other capability stands in",
    () =>
      Effect.gen(function* () {
        for (const granted of Object.values(TaxCapabilities)) {
          yield* Effect.gen(function* () {
            const tax = yield* TaxService

            for (const [needed, call] of operations({ tenantId })) {
              assert.strictEqual(
                wasDenied(yield* Effect.result(call(tax))),
                needed !== granted,
                `${granted} granted, ${needed} needed`,
              )
            }
          }).pipe(Effect.provide(layerGranting([{ capability: granted, tenantId }])))
        }
      }),
  )

  // [TAX-AUTH-1]
  it.effect("denies every operation in a tenant where the capabilities are not granted", () =>
    Effect.gen(function* () {
      const tax = yield* TaxService

      for (const [capability, call] of operations({ tenantId: otherTenantId })) {
        assert.isTrue(wasDenied(yield* Effect.result(call(tax))), capability)
      }
    }).pipe(
      Effect.provide(
        layerGranting(
          Object.values(TaxCapabilities).map((capability) => ({ capability, tenantId })),
        ),
      ),
    ),
  )
})

describe("Tax defaults of a product on the production service", () => {
  // [TAX-PROD-1] PostgreSQL binds the default through the composite foreign key
  // product_tax_defaults_tax_code_fkey; the memory service states the same refusal.
  it.effect("binds a product default to a code of the same direction only", () =>
    Effect.gen(function* () {
      const tax = yield* TaxService
      const scope = { principal, tenantId }
      const productId = uuidv7()

      const sales = yield* tax.createTaxCode({
        ...scope,
        code: "VAT11",
        name: "Output VAT",
        rate: "11",
        direction: "sales",
      })

      const purchase = yield* tax.createTaxCode({
        ...scope,
        code: "IN11",
        name: "Input VAT",
        rate: "11",
        direction: "purchase",
      })

      const bind = (direction: "sales" | "purchase", taxCodeId: string) =>
        tax.setProductTaxDefault({ ...scope, productId, direction, taxCodeId })

      yield* bind("sales", sales.id)
      yield* bind("purchase", purchase.id)

      assert.instanceOf(yield* Effect.flip(bind("sales", purchase.id)), ServiceTaxCodeNotFound)
      assert.instanceOf(yield* Effect.flip(bind("purchase", sales.id)), ServiceTaxCodeNotFound)
      assert.instanceOf(yield* Effect.flip(bind("sales", uuidv7())), ServiceTaxCodeNotFound)

      const defaults = (direction: "sales" | "purchase") =>
        tax.determineTaxCodes({ ...scope, direction, productIds: [productId] })

      // A refused binding leaves the defaults as they were.
      assert.strictEqual((yield* defaults("sales")).get(productId), sales.id)
      assert.strictEqual((yield* defaults("purchase")).get(productId), purchase.id)
    }).pipe(
      Effect.provide(
        layerGranting(
          Object.values(TaxCapabilities).map((capability) => ({ capability, tenantId })),
        ),
      ),
    ),
  )
})

// The tax of 100.00 on the code `vat`, charged on a date.
function rateOn(date: string | undefined, rate: string, tax: string) {
  const lines = [line("a", "100.00", vatId)]

  return [
    Story.query(
      ComputeTax,
      date === undefined ? { direction: "sales", lines } : { direction: "sales", date, lines },
      (computation) => {
        assert.strictEqual(computation.lines[0]!.rate, rate)
        assert.strictEqual(computation.totalTax, tax)
      },
    ),
  ]
}
