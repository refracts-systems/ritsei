import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  foreignKey,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core"

import { tenants } from "./auth.ts"
import { createdAt, id, type JsonValue, updatedAt } from "./common.ts"

export const customFieldsSchema = pgSchema("custom_fields")

export const customFieldKind = customFieldsSchema.enum("custom_field_kind", [
  "text",
  "number",
  "date",
  "boolean",
  "choice",
])

/** A field a tenant added to one document type that its owner released for custom fields (ADR-0109). */
export const customFieldDefinitions = customFieldsSchema.table(
  "custom_field_definitions",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    documentType: text("document_type").notNull(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    kind: customFieldKind("kind").notNull(),
    required: boolean("required").notNull().default(false),
    /** The allowed values of a `choice` field; null for every other kind. */
    choices: jsonb("choices").$type<string[]>(),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("custom_field_definitions_tenant_id_id_key").on(table.tenantId, table.id),
    unique("custom_field_definitions_key").on(table.tenantId, table.documentType, table.key),
    check("custom_field_definitions_key_check", sql`${table.key} ~ '^[a-z][a-z0-9_]{0,39}$'`),
    check(
      "custom_field_definitions_document_type_check",
      sql`${table.documentType} ~ '^[a-z][a-z0-9_]*[.][a-z][a-z0-9_]*$'`,
    ),
    check("custom_field_definitions_label_check", sql`${table.label} ~ '[^[:space:]]'`),
    check(
      "custom_field_definitions_choices_check",
      sql`(${table.kind} = 'choice') = (${table.choices} is not null and jsonb_typeof(${table.choices}) = 'array' and jsonb_array_length(${table.choices}) > 0)`,
    ),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "custom_field_definitions_tenant_id_fkey",
    }).onDelete("cascade"),
  ],
)

/** One value of one field on one document; the document is referenced by id only (ADR-0109). */
export const customFieldValues = customFieldsSchema.table(
  "custom_field_values",
  {
    tenantId: uuid("tenant_id").notNull(),
    documentType: text("document_type").notNull(),
    documentId: uuid("document_id").notNull(),
    key: text("key").notNull(),
    value: jsonb("value").$type<JsonValue>().notNull(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.documentType, table.documentId, table.key] }),
    foreignKey({
      columns: [table.tenantId, table.documentType, table.key],
      foreignColumns: [
        customFieldDefinitions.tenantId,
        customFieldDefinitions.documentType,
        customFieldDefinitions.key,
      ],
      name: "custom_field_values_definition_fkey",
    }).onDelete("restrict"),
  ],
)
