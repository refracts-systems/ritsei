import { sql } from "drizzle-orm"
import {
  bigint,
  check,
  foreignKey,
  integer,
  pgSchema,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core"

import { tenants } from "./auth.ts"
import { createdAt, id, updatedAt } from "./common.ts"

export const numberingSchema = pgSchema("numbering")

/** One gapless counter per tenant, scope (legal entity), document type, and fiscal period. */
export const numberSeries = numberingSchema.table(
  "number_series",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    scopeId: uuid("scope_id").notNull(),
    documentType: text("document_type").notNull(),
    periodKey: text("period_key").notNull(),
    prefix: text("prefix").notNull(),
    padding: integer("padding").notNull(),
    nextValue: bigint("next_value", { mode: "bigint" })
      .notNull()
      .default(sql`1`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("number_series_tenant_id_id_key").on(table.tenantId, table.id),
    unique("number_series_scope_type_period_key").on(
      table.tenantId,
      table.scopeId,
      table.documentType,
      table.periodKey,
    ),
    check("number_series_document_type_check", sql`${table.documentType} ~ '^[a-z][a-z0-9_.]*$'`),
    check("number_series_period_key_check", sql`${table.periodKey} ~ '^[0-9]{4}$'`),
    check(
      "number_series_prefix_check",
      sql`${table.prefix} = btrim(${table.prefix}) and length(${table.prefix}) <= 32`,
    ),
    check("number_series_padding_check", sql`${table.padding} between 1 and 12`),
    check("number_series_next_value_check", sql`${table.nextValue} >= 1`),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "number_series_tenant_id_fkey",
    }).onDelete("cascade"),
  ],
)

/** Every issued number, so uniqueness and gaplessness are provable from stored facts. */
export const issuedNumbers = numberingSchema.table(
  "issued_numbers",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    seriesId: uuid("series_id").notNull(),
    value: bigint("value", { mode: "bigint" }).notNull(),
    number: text("number").notNull(),
    documentId: uuid("document_id").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    unique("issued_numbers_series_value_key").on(table.seriesId, table.value),
    unique("issued_numbers_series_document_key").on(table.seriesId, table.documentId),
    unique("issued_numbers_tenant_series_number_key").on(
      table.tenantId,
      table.seriesId,
      table.number,
    ),
    check("issued_numbers_value_check", sql`${table.value} >= 1`),
    foreignKey({
      columns: [table.tenantId, table.seriesId],
      foreignColumns: [numberSeries.tenantId, numberSeries.id],
      name: "issued_numbers_series_fkey",
    }).onDelete("cascade"),
  ],
)
