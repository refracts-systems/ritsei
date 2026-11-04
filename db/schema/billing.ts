import { sql } from "drizzle-orm"
import {
  bigint,
  bytea,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgSchema,
  primaryKey,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core"

import { tenants } from "./auth.ts"
import { createdAt, id, json, money } from "./common.ts"
import { legalEntities, parties } from "./party.ts"

export const billingSchema = pgSchema("billing")

export const invoiceKind = billingSchema.enum("invoice_kind", [
  "customer_invoice",
  "customer_credit_note",
  "supplier_bill",
  "supplier_credit_note",
])

/**
 * Posted billing documents and their open amounts (ADR-0102). A document is created posted;
 * corrections are new credit notes, never edits.
 */
export const invoices = billingSchema.table(
  "invoices",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    legalEntityId: uuid("legal_entity_id").notNull(),
    kind: invoiceKind("kind").notNull(),
    partyId: uuid("party_id").notNull(),
    number: text("number").notNull(),
    invoiceDate: date("invoice_date", { mode: "string" }).notNull(),
    subtotal: money("subtotal"),
    taxTotal: money("tax_total"),
    total: money("total"),
    openAmount: money("open_amount"),
    sourceType: text("source_type"),
    sourceId: uuid("source_id"),
    creditedInvoiceId: uuid("credited_invoice_id"),
    supplierReference: text("supplier_reference"),
    journalEntryId: uuid("journal_entry_id").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    unique("invoices_tenant_id_id_key").on(table.tenantId, table.id),
    unique("invoices_tenant_id_number_kind_key").on(
      table.tenantId,
      table.id,
      table.number,
      table.kind,
    ),
    unique("invoices_legal_entity_kind_number_key").on(
      table.tenantId,
      table.legalEntityId,
      table.kind,
      table.number,
    ),
    index("invoices_open_items_idx").on(table.tenantId, table.legalEntityId, table.partyId),
    index("invoices_source_idx").on(table.tenantId, table.sourceType, table.sourceId),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntities.tenantId, legalEntities.id],
      name: "invoices_legal_entity_fkey",
    }),
    foreignKey({
      columns: [table.tenantId, table.partyId],
      foreignColumns: [parties.tenantId, parties.id],
      name: "invoices_party_fkey",
    }),
    foreignKey({
      columns: [table.tenantId, table.creditedInvoiceId],
      foreignColumns: [table.tenantId, table.id],
      name: "invoices_credited_invoice_fkey",
    }),
    check(
      "invoices_amounts_check",
      sql`${table.subtotal} >= 0 and ${table.taxTotal} >= 0 and
      ${table.total} = ${table.subtotal} + ${table.taxTotal} and
      ${table.openAmount} >= 0 and ${table.openAmount} <= ${table.total}`,
    ),
    check(
      "invoices_credit_reference_check",
      sql`(${table.kind} in ('customer_credit_note', 'supplier_credit_note')) = (${table.creditedInvoiceId} is not null)`,
    ),
    check(
      "invoices_source_check",
      sql`(${table.sourceType} is null and ${table.sourceId} is null) or
      (${table.sourceType} ~ '^[a-z][a-z0-9_.]*$' and ${table.sourceId} is not null)`,
    ),
  ],
)

/** Evaluation-only immutable render inputs for an issued customer invoice (ADR-0112). */
export const invoiceRenderInputs = billingSchema.table(
  "invoice_render_inputs",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    invoiceId: uuid("invoice_id").notNull(),
    invoiceNumber: text("invoice_number").notNull(),
    invoiceKind: invoiceKind("invoice_kind").notNull().default("customer_invoice"),
    snapshotChecksum: text("snapshot_checksum").notNull(),
    snapshot: json("snapshot").notNull(),
    astId: uuid("ast_id").notNull(),
    astChecksum: text("ast_checksum").notNull(),
    ast: json("ast").notNull(),
    renderFingerprint: text("render_fingerprint").notNull(),
    renderRequest: json("render_request").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    unique("invoice_render_inputs_invoice_key").on(table.tenantId, table.invoiceId),
    unique("invoice_render_inputs_artifact_fkey_key").on(
      table.tenantId,
      table.invoiceId,
      table.id,
      table.astId,
      table.renderFingerprint,
    ),
    foreignKey({
      columns: [table.tenantId, table.invoiceId, table.invoiceNumber, table.invoiceKind],
      foreignColumns: [invoices.tenantId, invoices.id, invoices.number, invoices.kind],
      name: "invoice_render_inputs_invoice_fkey",
    }),
    check("invoice_render_inputs_kind_check", sql`${table.invoiceKind} = 'customer_invoice'`),
    check(
      "invoice_render_inputs_hashes_check",
      sql`${table.snapshotChecksum} ~ '^[0-9a-f]{64}$' and
      ${table.astChecksum} ~ '^[0-9a-f]{64}$' and ${table.renderFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "invoice_render_inputs_snapshot_check",
      sql`(jsonb_typeof(${table.snapshot}) = 'object' and
      ${table.snapshot}->>'snapshotId' = ${table.id}::text and
      ${table.snapshot}->>'tenantId' = ${table.tenantId}::text and
      ${table.snapshot}->>'checksum' = ${table.snapshotChecksum} and
      ${table.snapshot}->'source'->>'owner' = 'billing' and
      ${table.snapshot}->'source'->>'type' = 'customer_invoice' and
      ${table.snapshot}->'source'->>'id' = ${table.invoiceId}::text and
      ${table.snapshot}->'payload'->>'number' = ${table.invoiceNumber}) is true`,
    ),
    check(
      "invoice_render_inputs_ast_check",
      sql`(jsonb_typeof(${table.ast}) = 'object' and
      ${table.ast}->>'astId' = ${table.astId}::text and
      ${table.ast}->>'snapshotId' = ${table.id}::text and
      ${table.ast}->>'checksum' = ${table.astChecksum} and
      ${table.ast}->>'documentType' = 'customer_invoice') is true`,
    ),
    check(
      "invoice_render_inputs_request_check",
      sql`(jsonb_typeof(${table.renderRequest}) = 'object' and
      ${table.renderRequest}->>'tenantId' = ${table.tenantId}::text and
      ${table.renderRequest}->>'snapshotId' = ${table.id}::text and
      ${table.renderRequest}->>'snapshotChecksum' = ${table.snapshotChecksum} and
      ${table.renderRequest}->>'astId' = ${table.astId}::text and
      ${table.renderRequest}->>'astChecksum' = ${table.astChecksum} and
      ${table.renderRequest}->>'renderFingerprint' = ${table.renderFingerprint} and
      ${table.renderRequest}->>'fingerprintVersion' = '2') is true`,
    ),
  ],
)

/** The single immutable PDF issued for an invoice; failures remain job state. */
export const invoiceArtifacts = billingSchema.table(
  "invoice_artifacts",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    invoiceId: uuid("invoice_id").notNull(),
    snapshotId: uuid("snapshot_id").notNull(),
    astId: uuid("ast_id").notNull(),
    renderFingerprint: text("render_fingerprint").notNull(),
    fenceScope: text("fence_scope").notNull(),
    leaseGeneration: bigint("lease_generation", { mode: "string" }).notNull(),
    contentHash: text("content_hash").notNull(),
    content: bytea("content").notNull(),
    pageCount: integer("page_count").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    unique("invoice_artifacts_invoice_key").on(table.tenantId, table.invoiceId),
    foreignKey({
      columns: [
        table.tenantId,
        table.invoiceId,
        table.snapshotId,
        table.astId,
        table.renderFingerprint,
      ],
      foreignColumns: [
        invoiceRenderInputs.tenantId,
        invoiceRenderInputs.invoiceId,
        invoiceRenderInputs.id,
        invoiceRenderInputs.astId,
        invoiceRenderInputs.renderFingerprint,
      ],
      name: "invoice_artifacts_render_input_fkey",
    }),
    check("invoice_artifacts_pages_check", sql`${table.pageCount} > 0`),
    check("invoice_artifacts_fence_scope_check", sql`${table.fenceScope} ~ '[^[:space:]]'`),
    check("invoice_artifacts_lease_generation_check", sql`${table.leaseGeneration} > 0`),
    check(
      "invoice_artifacts_content_check",
      sql`octet_length(${table.content}) >= 5 and octet_length(${table.content}) <= 50000000 and
      substring(${table.content} from 1 for 5) = decode('255044462d', 'hex') and
      ${table.contentHash} = encode(sha256(${table.content}), 'hex')`,
    ),
  ],
)

export const invoiceLines = billingSchema.table(
  "invoice_lines",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    invoiceId: uuid("invoice_id").notNull(),
    productId: uuid("product_id"),
    description: text("description").notNull(),
    quantity: bigint("quantity", { mode: "string" }).notNull(),
    unitPrice: money("unit_price"),
    netAmount: money("net_amount"),
    taxCodeId: uuid("tax_code_id"),
    taxAmount: money("tax_amount"),
    /** The order line, purchase order line, or credited invoice line this line bills. */
    sourceLineId: uuid("source_line_id"),
    /**
     * Received value a supplier bill line clears from goods received not invoiced, at the purchase
     * price; a credit note line carries its share so the credit posts back the same value.
     */
    matchedValue: money("matched_value").default("0"),
    createdAt: createdAt(),
  },
  (table) => [
    index("invoice_lines_invoice_idx").on(table.tenantId, table.invoiceId),
    index("invoice_lines_source_line_idx").on(table.tenantId, table.sourceLineId),
    foreignKey({
      columns: [table.tenantId, table.invoiceId],
      foreignColumns: [invoices.tenantId, invoices.id],
      name: "invoice_lines_invoice_fkey",
    }),
    check("invoice_lines_matched_value_check", sql`${table.matchedValue} >= 0`),
    check(
      "invoice_lines_amounts_check",
      sql`${table.quantity} > 0 and ${table.unitPrice} >= 0 and ${table.taxAmount} >= 0 and
      ${table.netAmount} = ${table.unitPrice} * ${table.quantity}`,
    ),
  ],
)

/** Payments and credit notes applied to a document's open amount. */
export const invoiceSettlements = billingSchema.table(
  "invoice_settlements",
  {
    tenantId: uuid("tenant_id").notNull(),
    invoiceId: uuid("invoice_id").notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id").notNull(),
    amount: money("amount"),
    /** The business date the amount was applied, so open items can be reported as of any date. */
    settledOn: date("settled_on", { mode: "string" }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.invoiceId, table.sourceType, table.sourceId] }),
    foreignKey({
      columns: [table.tenantId, table.invoiceId],
      foreignColumns: [invoices.tenantId, invoices.id],
      name: "invoice_settlements_invoice_fkey",
    }),
    check("invoice_settlements_amount_check", sql`${table.amount} > 0`),
    check("invoice_settlements_source_check", sql`${table.sourceType} ~ '^[a-z][a-z0-9_.]*$'`),
  ],
)

/** One row per billed source document; locking it serializes billing of that source. */
export const billingSources = billingSchema.table(
  "billing_sources",
  {
    tenantId: uuid("tenant_id").notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.sourceType, table.sourceId] }),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "billing_sources_tenant_id_fkey",
    }).onDelete("cascade"),
  ],
)
