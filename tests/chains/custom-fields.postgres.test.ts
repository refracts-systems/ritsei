import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import { uuidv7 } from "../../framework/foundation/mod.ts"
import { AuthorizationDenied } from "../../framework/modules/authorization/mod.ts"
import {
  CustomFieldAlreadyDefined,
  CustomFieldDocumentTypeNotReleased,
  CustomFieldNotDefined,
  CustomFieldRequired,
  CustomFieldService,
  CustomFieldValueInvalid,
} from "../../framework/modules/custom-fields/mod.ts"
import { runMigrations } from "../../framework/platform/mod.ts"
import {
  ProductCapabilities,
  ProductFields,
  ProductNotFound,
  ProductService,
} from "../../erp/modules/product/mod.ts"
import {
  CustomerNotFound,
  SalesCapabilities,
  SalesCustomerFields,
  SalesService,
} from "../../erp/modules/sales/mod.ts"
import { seedErpFixture } from "../support/erp-fixture.ts"
import { erpChainLayers } from "../support/erp-layers.ts"
import { withTemporaryDatabase } from "../support/postgres-database.ts"

const databaseUrl = process.env["DATABASE_URL"]
const admin = { userAccountId: "fields-admin", sessionId: "fields-admin-session" }
const reader = { userAccountId: "fields-reader", sessionId: "fields-reader-session" }

it.effect.skipIf(databaseUrl === undefined)(
  "defines custom fields on a customer and a product, validates values, and keeps owners in charge",
  () =>
    withTemporaryDatabase(databaseUrl!, (client) =>
      Effect.gen(function* () {
        yield* runMigrations(client)
        const { tenantId } = yield* seedErpFixture(client)

        const grants = [
          ...Object.values(SalesCapabilities),
          ...Object.values(ProductCapabilities),
        ].map((capability) => ({ userAccountId: admin.userAccountId, tenantId, capability }))

        // The reader may look at customers and products but not change anything.
        const readerGrants = [SalesCapabilities.customerRead, ProductCapabilities.productRead].map(
          (capability) => ({ userAccountId: reader.userAccountId, tenantId, capability }),
        )

        yield* Effect.gen(function* () {
          const customerFields = yield* SalesCustomerFields
          const productFields = yield* ProductFields
          const fields = yield* CustomFieldService
          const sales = yield* SalesService
          const products = yield* ProductService
          const scope = { principal: admin, tenantId }
          const readOnly = { principal: reader, tenantId }

          const customer = yield* sales.createCustomer({
            ...scope,
            name: "Northwind",
            email: "northwind@example.test",
          })

          // Definitions: a text field, a required choice, and a duplicate that is refused.
          yield* customerFields.defineField({
            ...scope,
            key: "account_manager",
            label: "Account manager",
            kind: "text",
          })

          yield* customerFields.defineField({
            ...scope,
            key: "tier",
            label: "Tier",
            kind: "choice",
            choices: ["gold", "silver"],
          })

          const duplicate = yield* Effect.flip(
            customerFields.defineField({ ...scope, key: "tier", label: "Tier", kind: "text" }),
          )

          assert.instanceOf(duplicate, CustomFieldAlreadyDefined)

          const unreleased = yield* Effect.flip(
            fields.defineField({
              tenantId,
              documentType: "party.party",
              key: "nickname",
              label: "Nickname",
              kind: "text",
            }),
          )

          assert.instanceOf(unreleased, CustomFieldDocumentTypeNotReleased)

          assert.deepStrictEqual(
            (yield* customerFields.listFields(readOnly)).map((field) => [
              field.key,
              field.kind,
              field.position,
            ]),
            [
              ["account_manager", "text", 0],
              ["tier", "choice", 1],
            ],
          )

          // Values: set, merge, clear, and refuse what does not fit.
          assert.deepStrictEqual(
            yield* customerFields.setValues({
              ...scope,
              documentId: customer.id,
              values: { account_manager: "Sari", tier: "gold" },
            }),
            { account_manager: "Sari", tier: "gold" },
          )

          assert.deepStrictEqual(
            yield* customerFields.setValues({
              ...scope,
              documentId: customer.id,
              values: { account_manager: null },
            }),
            { tier: "gold" },
          )

          const badChoice = yield* Effect.flip(
            customerFields.setValues({
              ...scope,
              documentId: customer.id,
              values: { tier: "platinum" },
            }),
          )

          assert.instanceOf(badChoice, CustomFieldValueInvalid)

          const unknown = yield* Effect.flip(
            customerFields.setValues({
              ...scope,
              documentId: customer.id,
              values: { shoe_size: "42" },
            }),
          )

          assert.instanceOf(unknown, CustomFieldNotDefined)

          // A required field blocks writes that would leave it empty.
          yield* customerFields.defineField({
            ...scope,
            key: "credit_note",
            label: "Credit note terms",
            kind: "text",
            required: true,
          })

          const missing = yield* Effect.flip(
            customerFields.setValues({
              ...scope,
              documentId: customer.id,
              values: { account_manager: "Budi" },
            }),
          )

          assert.instanceOf(missing, CustomFieldRequired)

          assert.deepStrictEqual(
            yield* customerFields.setValues({
              ...scope,
              documentId: customer.id,
              values: { account_manager: "Budi", credit_note: "30 days" },
            }),
            { account_manager: "Budi", tier: "gold", credit_note: "30 days" },
          )

          // The owner stays in charge: its capabilities and its own not-found error apply.
          assert.instanceOf(
            yield* Effect.flip(
              customerFields.defineField({ ...readOnly, key: "x", label: "X", kind: "text" }),
            ),
            AuthorizationDenied,
          )
          assert.instanceOf(
            yield* Effect.flip(
              customerFields.setValues({
                ...readOnly,
                documentId: customer.id,
                values: { tier: "silver" },
              }),
            ),
            AuthorizationDenied,
          )
          assert.deepStrictEqual(
            yield* customerFields.getValues({ ...readOnly, documentId: customer.id }),
            { account_manager: "Budi", tier: "gold", credit_note: "30 days" },
          )
          assert.instanceOf(
            yield* Effect.flip(customerFields.getValues({ ...scope, documentId: uuidv7() })),
            CustomerNotFound,
          )

          // Types of values: numbers and dates travel as exact strings.
          const product = yield* products.createProduct({
            ...scope,
            code: "WIDGET",
            name: "Widget",
            type: "stockable",
          })

          yield* productFields.defineField({
            ...scope,
            key: "shelf",
            label: "Shelf",
            kind: "text",
          })

          yield* productFields.defineField({
            ...scope,
            key: "weight_kg",
            label: "Weight (kg)",
            kind: "number",
          })

          yield* productFields.defineField({
            ...scope,
            key: "restocked_on",
            label: "Restocked on",
            kind: "date",
          })

          yield* productFields.defineField({
            ...scope,
            key: "fragile",
            label: "Fragile",
            kind: "boolean",
          })

          assert.deepStrictEqual(
            yield* productFields.setValues({
              ...scope,
              documentId: product.id,
              values: {
                shelf: "A-3",
                weight_kg: "1.250",
                restocked_on: "2026-10-01",
                fragile: true,
              },
            }),
            { shelf: "A-3", weight_kg: "1.250", restocked_on: "2026-10-01", fragile: true },
          )

          const unfit: ReadonlyArray<Record<string, string | boolean | null>> = [
            { weight_kg: "heavy" },
            { restocked_on: "2026-02-30" },
            { fragile: "yes" },
          ]

          for (const values of unfit) {
            assert.instanceOf(
              yield* Effect.flip(
                productFields.setValues({ ...scope, documentId: product.id, values }),
              ),
              CustomFieldValueInvalid,
            )
          }

          assert.instanceOf(
            yield* Effect.flip(productFields.getValues({ ...scope, documentId: uuidv7() })),
            ProductNotFound,
          )

          // Tenants do not see each other's definitions: another tenant has none.
          assert.deepStrictEqual(
            yield* fields.listFields({ tenantId: uuidv7(), documentType: "product.product" }),
            [],
          )
        }).pipe(Effect.provide(erpChainLayers(client, [...grants, ...readerGrants])))
      }),
    ),
  { timeout: 120_000 },
)
