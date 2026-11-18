import { sql } from "drizzle-orm"
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core"

import { tenants } from "./auth.ts"
import { createdAt, id, type JsonValue, updatedAt } from "./common.ts"

export const onboardingSchema = pgSchema("onboarding")

export const importObjectKind = onboardingSchema.enum("import_object_kind", ["party"])

export const importBatchStatus = onboardingSchema.enum("import_batch_status", [
  "staged",
  "rehearsed",
  "applied",
])

export const importRowStatus = onboardingSchema.enum("import_row_status", [
  "pending",
  "invalid",
  "applied",
])

/**
 * One staged file for one object kind (ADR-0115). The file checksum and mapping revision are part
 * of the identity, so a changed file or mapping is a new batch and can never inherit a rehearsal.
 */
export const importBatches = onboardingSchema.table(
  "import_batches",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    sourceInstance: text("source_instance").notNull(),
    sourceVersion: text("source_version"),
    objectKind: importObjectKind("object_kind").notNull(),
    fileChecksum: text("file_checksum").notNull(),
    mappingRevision: text("mapping_revision").notNull(),
    uploadedBy: text("uploaded_by").notNull(),
    status: importBatchStatus("status").notNull().default("staged"),
    rowCount: integer("row_count").notNull(),
    /** The saved dry-run preview: counts, error codes, and duration. */
    rehearsal: jsonb("rehearsal").$type<JsonValue>(),
    rehearsedAt: timestamp("rehearsed_at", { withTimezone: true }),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("import_batches_tenant_id_id_key").on(table.tenantId, table.id),
    unique("import_batches_file_key").on(
      table.tenantId,
      table.sourceInstance,
      table.objectKind,
      table.fileChecksum,
      table.mappingRevision,
    ),
    check(
      "import_batches_source_instance_check",
      sql`${table.sourceInstance} = btrim(${table.sourceInstance}) and ${table.sourceInstance} ~ '[^[:space:]]'`,
    ),
    check("import_batches_file_checksum_check", sql`${table.fileChecksum} ~ '^[0-9a-f]{64}$'`),
    check("import_batches_row_count_check", sql`${table.rowCount} >= 0`),
    check(
      "import_batches_rehearsed_check",
      sql`(${table.status} = 'staged') = (${table.rehearsedAt} is null and ${table.rehearsal} is null)`,
    ),
    check(
      "import_batches_applied_check",
      sql`(${table.status} = 'applied') = (${table.appliedAt} is not null)`,
    ),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "import_batches_tenant_id_fkey",
    }).onDelete("cascade"),
  ],
)

/** One parsed record of a batch, with its per-record errors. It never holds the raw file line. */
export const importRows = onboardingSchema.table(
  "import_rows",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    batchId: uuid("batch_id").notNull(),
    rowNumber: integer("row_number").notNull(),
    sourceId: text("source_id").notNull(),
    /** SHA-256 of the mapped fields, to tell an unchanged record from a changed one. */
    contentHash: text("content_hash").notNull(),
    fields: jsonb("fields").$type<JsonValue>().notNull(),
    status: importRowStatus("status").notNull().default("pending"),
    /** Safe errors only: a field name, a code, and a fixed message; never a source value. */
    errors: jsonb("errors")
      .$type<JsonValue>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    nativeId: uuid("native_id"),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    unique("import_rows_batch_row_key").on(table.batchId, table.rowNumber),
    index("import_rows_batch_status_idx").on(table.batchId, table.status, table.rowNumber),
    check("import_rows_row_number_check", sql`${table.rowNumber} >= 1`),
    check("import_rows_content_hash_check", sql`${table.contentHash} ~ '^[0-9a-f]{64}$'`),
    check("import_rows_errors_check", sql`jsonb_typeof(${table.errors}) = 'array'`),
    check(
      "import_rows_invalid_check",
      sql`(${table.status} = 'invalid') = (jsonb_array_length(${table.errors}) > 0)`,
    ),
    check(
      "import_rows_applied_check",
      sql`(${table.status} = 'applied') = (${table.nativeId} is not null and ${table.appliedAt} is not null)`,
    ),
    foreignKey({
      columns: [table.tenantId, table.batchId],
      foreignColumns: [importBatches.tenantId, importBatches.id],
      name: "import_rows_batch_fkey",
    }).onDelete("cascade"),
  ],
)

/**
 * The identity map: a source record, named by tenant, source instance, object kind, and stable
 * source id, and the native record an owner command created for it. The native id is held by id
 * only; the owner's table is never referenced.
 */
export const sourceIdentities = onboardingSchema.table(
  "source_identities",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    sourceInstance: text("source_instance").notNull(),
    objectKind: importObjectKind("object_kind").notNull(),
    sourceId: text("source_id").notNull(),
    nativeId: uuid("native_id").notNull(),
    contentHash: text("content_hash").notNull(),
    batchId: uuid("batch_id").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    unique("source_identities_source_key").on(
      table.tenantId,
      table.sourceInstance,
      table.objectKind,
      table.sourceId,
    ),
    unique("source_identities_native_key").on(
      table.tenantId,
      table.sourceInstance,
      table.objectKind,
      table.nativeId,
    ),
    check("source_identities_source_id_check", sql`${table.sourceId} ~ '[^[:space:]]'`),
    check("source_identities_content_hash_check", sql`${table.contentHash} ~ '^[0-9a-f]{64}$'`),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "source_identities_tenant_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.batchId],
      foreignColumns: [importBatches.tenantId, importBatches.id],
      name: "source_identities_batch_fkey",
    }),
  ],
)
