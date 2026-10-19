import { sql } from "drizzle-orm"
import { boolean, check, foreignKey, pgSchema, text, unique, uuid } from "drizzle-orm/pg-core"

import { tenants } from "./auth.ts"
import { createdAt, id, updatedAt } from "./common.ts"

export const productSchema = pgSchema("product")

export const productType = productSchema.enum("product_type", [
  "stockable",
  "consumable",
  "service",
])

/** The product master that Sales, Procurement, Billing, and Inventory reference (ADR-0097). */
export const products = productSchema.table(
  "products",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    type: productType("type").notNull(),
    category: text("category"),
    unitOfMeasure: text("unit_of_measure").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("products_tenant_id_id_key").on(table.tenantId, table.id),
    unique("products_tenant_code_key").on(table.tenantId, table.code),
    check(
      "products_code_check",
      sql`${table.code} = upper(btrim(${table.code})) and ${table.code} ~ '[^[:space:]]'`,
    ),
    check(
      "products_name_check",
      sql`${table.name} = btrim(${table.name}) and ${table.name} ~ '[^[:space:]]'`,
    ),
    check(
      "products_category_check",
      sql`${table.category} is null or (${table.category} = btrim(${table.category}) and ${table.category} ~ '[^[:space:]]')`,
    ),
    check("products_unit_of_measure_check", sql`${table.unitOfMeasure} ~ '^[A-Z][A-Z0-9_-]*$'`),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "products_tenant_id_fkey",
    }).onDelete("cascade"),
  ],
)
