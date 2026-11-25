import { sql } from "drizzle-orm"
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core"

import { accounts } from "./accounting.ts"
import { tenants } from "./auth.ts"
import { invoices } from "./billing.ts"
import { createdAt, id, money, updatedAt } from "./common.ts"
import { legalEntities, parties } from "./party.ts"

export const settlementSchema = pgSchema("settlement")

export const settlementSide = settlementSchema.enum("settlement_side", ["receivable", "payable"])
export const paymentDirection = settlementSchema.enum("payment_direction", ["incoming", "outgoing"])

/** Payment terms decide due dates for aging (ADR-0102). */
export const paymentTerms = settlementSchema.table(
  "payment_terms",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    netDays: integer("net_days").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("payment_terms_tenant_id_id_key").on(table.tenantId, table.id),
    unique("payment_terms_tenant_code_key").on(table.tenantId, table.code),
    check("payment_terms_net_days_check", sql`${table.netDays} between 0 and 3650`),
    check(
      "payment_terms_code_check",
      sql`${table.code} = upper(btrim(${table.code})) and ${table.code} ~ '[^[:space:]]'`,
    ),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "payment_terms_tenant_id_fkey",
    }).onDelete("cascade"),
  ],
)

export const partyPaymentTerms = settlementSchema.table(
  "party_payment_terms",
  {
    tenantId: uuid("tenant_id").notNull(),
    partyId: uuid("party_id").notNull(),
    side: settlementSide("side").notNull(),
    paymentTermId: uuid("payment_term_id").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.partyId, table.side] }),
    foreignKey({
      columns: [table.tenantId, table.partyId],
      foreignColumns: [parties.tenantId, parties.id],
      name: "party_payment_terms_party_fkey",
    }),
    foreignKey({
      columns: [table.tenantId, table.paymentTermId],
      foreignColumns: [paymentTerms.tenantId, paymentTerms.id],
      name: "party_payment_terms_term_fkey",
    }),
  ],
)

/** Incoming receipts and outgoing payments; the unallocated amount stays on account. */
export const payments = settlementSchema.table(
  "payments",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    legalEntityId: uuid("legal_entity_id").notNull(),
    direction: paymentDirection("direction").notNull(),
    partyId: uuid("party_id").notNull(),
    number: text("number").notNull(),
    paymentDate: date("payment_date", { mode: "string" }).notNull(),
    amount: money("amount"),
    unallocatedAmount: money("unallocated_amount"),
    cashAccountId: uuid("cash_account_id"),
    journalEntryId: uuid("journal_entry_id").notNull(),
    /** Tax the payer withheld from this receipt: it settles receivables but is not cash received. */
    withheldAmount: money("withheld_amount").default("0"),
    /** The payer's withholding certificate number. */
    withholdingReference: text("withholding_reference"),
    /** The account that holds the withheld tax as a claim against the tax authority. */
    withholdingAccountId: uuid("withholding_account_id"),
    createdAt: createdAt(),
  },
  (table) => [
    unique("payments_tenant_id_id_key").on(table.tenantId, table.id),
    index("payments_tenant_number_idx").on(table.tenantId, table.number),
    unique("payments_legal_entity_direction_number_key").on(
      table.tenantId,
      table.legalEntityId,
      table.direction,
      table.number,
    ),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntities.tenantId, legalEntities.id],
      name: "payments_legal_entity_fkey",
    }),
    foreignKey({
      columns: [table.tenantId, table.partyId],
      foreignColumns: [parties.tenantId, parties.id],
      name: "payments_party_fkey",
    }),
    foreignKey({
      columns: [table.tenantId, table.cashAccountId],
      foreignColumns: [accounts.tenantId, accounts.id],
      name: "payments_cash_account_fkey",
    }),
    foreignKey({
      columns: [table.tenantId, table.withholdingAccountId],
      foreignColumns: [accounts.tenantId, accounts.id],
      name: "payments_withholding_account_fkey",
    }),
    check(
      "payments_amounts_check",
      sql`${table.amount} > 0 and ${table.unallocatedAmount} >= 0 and ${table.unallocatedAmount} <= ${table.amount}`,
    ),
    check(
      "payments_withholding_check",
      sql`${table.withheldAmount} >= 0 and ${table.withheldAmount} < ${table.amount}
        and (${table.withheldAmount} = 0) = (${table.withholdingReference} is null)
        and (${table.withheldAmount} = 0) = (${table.withholdingAccountId} is null)
        and (${table.withheldAmount} = 0 or ${table.direction} = 'incoming')`,
    ),
  ],
)

export const paymentAllocations = settlementSchema.table(
  "payment_allocations",
  {
    tenantId: uuid("tenant_id").notNull(),
    paymentId: uuid("payment_id").notNull(),
    invoiceId: uuid("invoice_id").notNull(),
    amount: money("amount"),
    /** The business date the payment was allocated, so unallocated payments can be aged as of any date. */
    allocatedOn: date("allocated_on", { mode: "string" }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.paymentId, table.invoiceId] }),
    foreignKey({
      columns: [table.tenantId, table.paymentId],
      foreignColumns: [payments.tenantId, payments.id],
      name: "payment_allocations_payment_fkey",
    }),
    foreignKey({
      columns: [table.tenantId, table.invoiceId],
      foreignColumns: [invoices.tenantId, invoices.id],
      name: "payment_allocations_invoice_fkey",
    }),
    check("payment_allocations_amount_check", sql`${table.amount} > 0`),
  ],
)

/**
 * One imported bank statement file. The checksum of the file content makes a repeated import of
 * the same file return this statement instead of creating a second one (ADR-0116).
 */
export const bankStatements = settlementSchema.table(
  "bank_statements",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    legalEntityId: uuid("legal_entity_id").notNull(),
    bankAccountId: uuid("bank_account_id").notNull(),
    sourceName: text("source_name").notNull(),
    checksum: text("checksum").notNull(),
    importedBy: text("imported_by").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    unique("bank_statements_tenant_id_id_key").on(table.tenantId, table.id),
    unique("bank_statements_checksum_key").on(
      table.tenantId,
      table.legalEntityId,
      table.bankAccountId,
      table.checksum,
    ),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntities.tenantId, legalEntities.id],
      name: "bank_statements_legal_entity_fkey",
    }),
    foreignKey({
      columns: [table.tenantId, table.bankAccountId],
      foreignColumns: [accounts.tenantId, accounts.id],
      name: "bank_statements_bank_account_fkey",
    }),
    check("bank_statements_checksum_check", sql`${table.checksum} ~ '^[0-9a-f]{64}$'`),
  ],
)

/** A statement line as the bank reported it: immutable evidence. A positive amount is money in. */
export const bankStatementLines = settlementSchema.table(
  "bank_statement_lines",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    statementId: uuid("statement_id").notNull(),
    lineNumber: integer("line_number").notNull(),
    bookingDate: date("booking_date", { mode: "string" }).notNull(),
    description: text("description").notNull(),
    reference: text("reference"),
    amount: money("amount"),
    createdAt: createdAt(),
  },
  (table) => [
    unique("bank_statement_lines_tenant_id_id_key").on(table.tenantId, table.id),
    unique("bank_statement_lines_number_key").on(
      table.tenantId,
      table.statementId,
      table.lineNumber,
    ),
    foreignKey({
      columns: [table.tenantId, table.statementId],
      foreignColumns: [bankStatements.tenantId, bankStatements.id],
      name: "bank_statement_lines_statement_fkey",
    }),
    check("bank_statement_lines_amount_check", sql`${table.amount} <> 0`),
    check("bank_statement_lines_number_check", sql`${table.lineNumber} > 0`),
  ],
)

/**
 * A manual match of a statement line to the cash of a payment. A reversed match stays as history
 * and stops counting.
 */
export const bankLineMatches = settlementSchema.table(
  "bank_line_matches",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    lineId: uuid("line_id").notNull(),
    paymentId: uuid("payment_id").notNull(),
    amount: money("amount"),
    matchedBy: text("matched_by").notNull(),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedBy: text("reversed_by"),
    createdAt: createdAt(),
  },
  (table) => [
    unique("bank_line_matches_tenant_id_id_key").on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.lineId],
      foreignColumns: [bankStatementLines.tenantId, bankStatementLines.id],
      name: "bank_line_matches_line_fkey",
    }),
    foreignKey({
      columns: [table.tenantId, table.paymentId],
      foreignColumns: [payments.tenantId, payments.id],
      name: "bank_line_matches_payment_fkey",
    }),
    check("bank_line_matches_amount_check", sql`${table.amount} > 0`),
    check(
      "bank_line_matches_reversal_check",
      sql`(${table.reversedAt} is null) = (${table.reversedBy} is null)`,
    ),
  ],
)
