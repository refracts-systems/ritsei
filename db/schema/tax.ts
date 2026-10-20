import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  foreignKey,
  numeric,
  pgSchema,
  primaryKey,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core"

import { tenants } from "./auth.ts"
import { createdAt, id, updatedAt } from "./common.ts"
import { products } from "./product.ts"

export const taxSchema = pgSchema("tax")

export const taxDirection = taxSchema.enum("tax_direction", ["sales", "purchase"])

/** Jurisdiction-neutral tax codes; localization modules create their concrete codes (ADR-0098). */
export const taxCodes = taxSchema.table(
  "tax_codes",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    /** Percent with four decimals, for example 11.0000. */
    rate: numeric("rate", { precision: 7, scale: 4 }).notNull(),
    direction: taxDirection("direction").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("tax_codes_tenant_id_id_key").on(table.tenantId, table.id),
    unique("tax_codes_tenant_id_direction_key").on(table.tenantId, table.id, table.direction),
    unique("tax_codes_tenant_code_key").on(table.tenantId, table.code),
    check(
      "tax_codes_code_check",
      sql`${table.code} = upper(btrim(${table.code})) and ${table.code} ~ '[^[:space:]]'`,
    ),
    check(
      "tax_codes_name_check",
      sql`${table.name} = btrim(${table.name}) and ${table.name} ~ '[^[:space:]]'`,
    ),
    check("tax_codes_rate_check", sql`${table.rate} >= 0 and ${table.rate} <= 100`),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "tax_codes_tenant_id_fkey",
    }).onDelete("cascade"),
  ],
)

/** The tax code a product defaults to when sold or bought. */
export const productTaxDefaults = taxSchema.table(
  "product_tax_defaults",
  {
    tenantId: uuid("tenant_id").notNull(),
    productId: uuid("product_id").notNull(),
    direction: taxDirection("direction").notNull(),
    taxCodeId: uuid("tax_code_id").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.productId, table.direction] }),
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
      name: "product_tax_defaults_product_fkey",
    }),
    foreignKey({
      columns: [table.tenantId, table.taxCodeId, table.direction],
      foreignColumns: [taxCodes.tenantId, taxCodes.id, taxCodes.direction],
      name: "product_tax_defaults_tax_code_fkey",
    }),
  ],
)
