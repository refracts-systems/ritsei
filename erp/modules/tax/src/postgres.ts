import { and, asc, eq, inArray, lte } from "drizzle-orm"
import * as Effect from "effect/Effect"

import { productTaxDefaults, taxCodeRates, taxCodes } from "../../../../db/schema/tax.ts"
import { Database, isDatabaseConstraint } from "../../../../framework/foundation/mod.ts"
import { normalizeRate } from "./contract.ts"
import {
  TaxCodeAlreadyExists,
  TaxCodeNotFound,
  TaxCodeRateAlreadyExists,
  TaxProductNotFound,
} from "./errors.ts"
import type { TaxStore } from "./store.ts"

const rateSelection = {
  tenantId: taxCodeRates.tenantId,
  taxCodeId: taxCodeRates.taxCodeId,
  effectiveFrom: taxCodeRates.effectiveFrom,
  rate: taxCodeRates.rate,
}

const selection = {
  id: taxCodes.id,
  tenantId: taxCodes.tenantId,
  code: taxCodes.code,
  name: taxCodes.name,
  rate: taxCodes.rate,
  direction: taxCodes.direction,
  active: taxCodes.active,
}

const normalized = <T extends { rate: string }>(row: T) => ({
  ...row,
  rate: normalizeRate(row.rate),
})

export const makeTaxPostgresStore = Effect.fn("Tax.makePostgresStore")(function* () {
  const database = yield* Database

  return {
    listTaxCodes: (tenantId, direction, limit) =>
      database
        .query(
          (db) =>
            db
              .select(selection)
              .from(taxCodes)
              .where(
                and(
                  eq(taxCodes.tenantId, tenantId),
                  direction === undefined ? undefined : eq(taxCodes.direction, direction),
                ),
              )
              .orderBy(asc(taxCodes.code))
              .limit(limit),
          "tax.tax_code.list",
        )
        .pipe(Effect.map((rows) => rows.map(normalized))),
    getTaxCodes: (tenantId, ids) =>
      ids.length === 0
        ? Effect.succeed([])
        : database
            .query(
              (db) =>
                db
                  .select(selection)
                  .from(taxCodes)
                  .where(and(eq(taxCodes.tenantId, tenantId), inArray(taxCodes.id, [...ids]))),
              "tax.tax_code.get",
            )
            .pipe(Effect.map((rows) => rows.map(normalized))),
    createTaxCode: (command) =>
      database
        .query(
          (db) =>
            db
              .insert(taxCodes)
              .values({
                tenantId: command.tenantId,
                code: command.code,
                name: command.name,
                rate: command.rate,
                direction: command.direction,
              })
              .returning(selection),
          "tax.tax_code.create",
        )
        .pipe(
          Effect.map((rows) => normalized(rows[0]!)),
          Effect.mapError((error) =>
            isDatabaseConstraint(error, "tax_codes_tenant_code_key")
              ? new TaxCodeAlreadyExists({ tenantId: command.tenantId, code: command.code })
              : error,
          ),
        ),
    addTaxCodeRate: (value) =>
      database
        .query(
          (db) =>
            db
              .insert(taxCodeRates)
              .values({
                tenantId: value.tenantId,
                taxCodeId: value.taxCodeId,
                effectiveFrom: value.effectiveFrom,
                rate: value.rate,
              })
              .returning(rateSelection),
          "tax.tax_code_rate.add",
        )
        .pipe(
          Effect.map((rows) => normalized(rows[0]!)),
          Effect.mapError((error) => {
            if (isDatabaseConstraint(error, "tax_code_rates_pkey")) {
              return new TaxCodeRateAlreadyExists(value)
            }

            if (isDatabaseConstraint(error, "tax_code_rates_tax_code_fkey", "23503")) {
              return new TaxCodeNotFound({ tenantId: value.tenantId, taxCodeId: value.taxCodeId })
            }

            return error
          }),
        ),
    ratePeriodsUpTo: (tenantId, taxCodeIds, date) =>
      taxCodeIds.length === 0
        ? Effect.succeed([])
        : database
            .query(
              (db) =>
                db
                  .select(rateSelection)
                  .from(taxCodeRates)
                  .where(
                    and(
                      eq(taxCodeRates.tenantId, tenantId),
                      inArray(taxCodeRates.taxCodeId, [...taxCodeIds]),
                      lte(taxCodeRates.effectiveFrom, date),
                    ),
                  ),
              "tax.tax_code_rate.list",
            )
            .pipe(Effect.map((rows) => rows.map(normalized))),
    setProductTaxDefault: (value) =>
      database
        .query(
          (db) =>
            db
              .insert(productTaxDefaults)
              .values(value)
              .onConflictDoUpdate({
                target: [
                  productTaxDefaults.tenantId,
                  productTaxDefaults.productId,
                  productTaxDefaults.direction,
                ],
                set: { taxCodeId: value.taxCodeId, updatedAt: new Date() },
              }),
          "tax.product_tax_default.set",
        )
        .pipe(
          Effect.as(value),
          Effect.mapError((error) => {
            if (isDatabaseConstraint(error, "product_tax_defaults_product_fkey", "23503")) {
              return new TaxProductNotFound({
                tenantId: value.tenantId,
                productId: value.productId,
              })
            }

            if (isDatabaseConstraint(error, "product_tax_defaults_tax_code_fkey", "23503")) {
              return new TaxCodeNotFound({ tenantId: value.tenantId, taxCodeId: value.taxCodeId })
            }

            return error
          }),
        ),
    productTaxDefaults: (tenantId, direction, productIds) =>
      productIds.length === 0
        ? Effect.succeed([])
        : database.query(
            (db) =>
              db
                .select({
                  tenantId: productTaxDefaults.tenantId,
                  productId: productTaxDefaults.productId,
                  direction: productTaxDefaults.direction,
                  taxCodeId: productTaxDefaults.taxCodeId,
                })
                .from(productTaxDefaults)
                .where(
                  and(
                    eq(productTaxDefaults.tenantId, tenantId),
                    eq(productTaxDefaults.direction, direction),
                    inArray(productTaxDefaults.productId, [...productIds]),
                  ),
                ),
            "tax.product_tax_default.list",
          ),
  } satisfies TaxStore
})
