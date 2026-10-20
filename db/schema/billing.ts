import { sql } from "drizzle-orm"
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  pgSchema,
  primaryKey,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core"

import { tenants } from "./auth.ts"
import { createdAt, id, money } from "./common.ts"
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
