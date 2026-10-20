import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import { Etag, HttpPlatform } from "effect/http"
import * as HttpApiMiddleware from "effect/http-api/HttpApiMiddleware"
import * as HttpApiTest from "effect/http-api/HttpApiTest"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"

import { Database, uuidv7 } from "../../../../framework/foundation/mod.ts"
import {
  AuthorizationDenied,
  makeAuthorizationTestLayer,
} from "../../../../framework/modules/authorization/mod.ts"
import {
  BearerAuth,
  CurrentPrincipal,
  makeModuleApi,
} from "../../../../framework/modules/http/mod.ts"
import { validateModuleRegistry } from "../../../../framework/modules/module/mod.ts"
import { makePostgresDatabase, runMigrations } from "../../../../framework/platform/mod.ts"
import { seedErpFixture } from "../../../../tests/support/erp-fixture.ts"
import { withTemporaryDatabase } from "../../../../tests/support/postgres-database.ts"
import { TaxHttpGroup, TaxHttpHandlers } from "../http.ts"
import {
  makeTaxTestLayer,
  TaxCapabilities,
  TaxCodeAlreadyExists,
  TaxCodeNotFound,
  TaxLive,
  TaxModule,
  taxOn,
  TaxProductNotFound,
  TaxService,
} from "../mod.ts"

const principal = { userAccountId: "tax-user", sessionId: "tax-session" }
const tenantId = "018f2000-0000-7000-8000-0000000000aa"
const grantsFor = (tenant: string) =>
  Object.values(TaxCapabilities).map((capability) => ({
    userAccountId: principal.userAccountId,
    tenantId: tenant,
    capability,
  }))
const granted = makeTaxTestLayer().pipe(
  Layer.provide(makeAuthorizationTestLayer(grantsFor(tenantId))),
)
const ungranted = makeTaxTestLayer().pipe(Layer.provide(makeAuthorizationTestLayer([])))

const TestHttpServices = Layer.mergeAll(Path.layer, Etag.layerWeak, HttpPlatform.layer).pipe(
  Layer.provideMerge(FileSystem.layerNoop({})),
)

describe("tax module", () => {
  it("declares a valid manifest", () => {
    assert.deepStrictEqual(validateModuleRegistry([TaxModule]), [])
  })

  it("rounds tax half up per line", () => {
    assert.strictEqual(taxOn("100.00", "11"), "11.00")
    assert.strictEqual(taxOn("0.05", "10"), "0.01")
    assert.strictEqual(taxOn("0.04", "10"), "0.00")
    assert.strictEqual(taxOn("33.33", "12.5"), "4.17")
  })

  it.effect("computes tax per line and per code, and rejects codes of the other direction", () =>
    Effect.gen(function* () {
      const tax = yield* TaxService
      const vat = yield* tax.createTaxCode({
        principal,
        tenantId,
        code: "vat11",
        name: "Output VAT 11%",
        rate: "11",
        direction: "sales",
      })
      assert.strictEqual(vat.code, "VAT11")
      assert.strictEqual(vat.rate, "11.0000")
      const inputVat = yield* tax.createTaxCode({
        principal,
        tenantId,
        code: "IN11",
        name: "Input VAT 11%",
        rate: "11",
        direction: "purchase",
      })
      const duplicate = yield* Effect.flip(
        tax.createTaxCode({
          principal,
          tenantId,
          code: "VAT11",
          name: "x",
          rate: "1",
          direction: "sales",
        }),
      )
      assert.instanceOf(duplicate, TaxCodeAlreadyExists)

      const computed = yield* tax.computeTax({
        principal,
        tenantId,
        direction: "sales",
        lines: [
          { key: "a", base: "100.00", taxCodeId: vat.id },
          { key: "b", base: "45.50", taxCodeId: vat.id },
          { key: "c", base: "10.00", taxCodeId: null },
        ],
      })
      assert.deepStrictEqual(
        computed.lines.map((line) => line.tax),
        ["11.00", "5.01", "0.00"],
      )
      assert.deepStrictEqual(computed.summary, [
        { taxCodeId: vat.id, base: "145.50", tax: "16.01" },
      ])
      assert.strictEqual(computed.totalTax, "16.01")

      const wrongDirection = yield* Effect.flip(
        tax.computeTax({
          principal,
          tenantId,
          direction: "sales",
          lines: [{ key: "a", base: "1.00", taxCodeId: inputVat.id }],
        }),
      )
      assert.instanceOf(wrongDirection, TaxCodeNotFound)

      const productId = uuidv7()
      yield* tax.setProductTaxDefault({
        principal,
        tenantId,
        productId,
        direction: "sales",
        taxCodeId: vat.id,
      })
      const mismatched = yield* Effect.flip(
        tax.setProductTaxDefault({
          principal,
          tenantId,
          productId,
          direction: "sales",
          taxCodeId: inputVat.id,
        }),
      )
      assert.instanceOf(mismatched, TaxCodeNotFound)
      const determined = yield* tax.determineTaxCodes({
        principal,
        tenantId,
        direction: "sales",
        productIds: [productId, uuidv7()],
      })
      assert.deepStrictEqual([...determined.values()], [vat.id, null])
    }).pipe(Effect.provide(granted)),
  )

  it.effect("denies operations without a granted capability", () =>
    Effect.gen(function* () {
      const tax = yield* TaxService
      const denied = yield* Effect.flip(tax.listTaxCodes({ principal, tenantId }))
      assert.instanceOf(denied, AuthorizationDenied)
    }).pipe(Effect.provide(ungranted)),
  )
})

it.layer(TestHttpServices)("tax HTTP endpoint", (it) => {
  it.effect("serves create and list through the bearer-protected routes", () =>
    Effect.gen(function* () {
      const bearer = Layer.succeed(BearerAuth, {
        bearer: (effect) => Effect.provideService(effect, CurrentPrincipal, principal),
      })
      const bearerClient = HttpApiMiddleware.layerClient(BearerAuth, ({ request, next }) =>
        next(HttpClientRequest.bearerToken(request, "tax-token")),
      )
      const handlers = TaxHttpHandlers.pipe(Layer.provide(bearer), Layer.provide(granted))
      const client = yield* HttpApiTest.groups(makeModuleApi(TaxHttpGroup), ["Tax"]).pipe(
        Effect.provide(Layer.mergeAll(handlers, bearerClient, bearer)),
      )
      const headers = { "x-tenant-id": tenantId }
      const created = yield* client.Tax.createTaxCode({
        headers,
        payload: { code: "ZERO", name: "Zero rated", rate: "0", direction: "sales" },
      })
      assert.strictEqual(created.rate, "0.0000")
      assert.deepStrictEqual(yield* client.Tax.listTaxCodes({ headers, query: {} }), [created])
    }),
  )
})

const databaseUrl = process.env["DATABASE_URL"]

it.effect.skipIf(databaseUrl === undefined)(
  "binds product tax defaults to products and same-direction codes in PostgreSQL",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const fixture = yield* seedErpFixture(client)
        const [product] = yield* Effect.promise(
          () => client<{ id: string }[]>`
            insert into product.products (tenant_id, code, name, type, unit_of_measure)
            values (${fixture.tenantId}, 'WIDGET', 'Widget', 'stockable', 'EA') returning id
          `,
        )
        yield* Effect.gen(function* () {
          const tax = yield* TaxService
          const scope = { principal, tenantId: fixture.tenantId }
          const vat = yield* tax.createTaxCode({
            ...scope,
            code: "VAT11",
            name: "VAT",
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
          yield* tax.setProductTaxDefault({
            ...scope,
            productId: product!.id,
            direction: "sales",
            taxCodeId: vat.id,
          })
          const missingProduct = yield* Effect.flip(
            tax.setProductTaxDefault({
              ...scope,
              productId: uuidv7(),
              direction: "sales",
              taxCodeId: vat.id,
            }),
          )
          assert.instanceOf(missingProduct, TaxProductNotFound)
          const wrongDirection = yield* Effect.flip(
            tax.setProductTaxDefault({
              ...scope,
              productId: product!.id,
              direction: "sales",
              taxCodeId: purchase.id,
            }),
          )
          assert.instanceOf(wrongDirection, TaxCodeNotFound)
          const determined = yield* tax.determineTaxCodes({
            ...scope,
            direction: "sales",
            productIds: [product!.id],
          })
          assert.strictEqual(determined.get(product!.id), vat.id)
        }).pipe(
          Effect.provide(
            TaxLive.pipe(
              Layer.provide(
                Layer.mergeAll(
                  Layer.succeed(Database, makePostgresDatabase(client)),
                  makeAuthorizationTestLayer(grantsFor(fixture.tenantId)),
                ),
              ),
            ),
          ),
        )
      }),
    ),
  { timeout: 120_000 },
)
