import { sql } from "drizzle-orm"
import {
  check,
  date,
  foreignKey,
  integer,
  pgSchema,
  primaryKey,
  text,
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
    createdAt: createdAt(),
  },
  (table) => [
    unique("payments_tenant_id_id_key").on(table.tenantId, table.id),
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
    check(
      "payments_amounts_check",
      sql`${table.amount} > 0 and ${table.unallocatedAmount} >= 0 and ${table.unallocatedAmount} <= ${table.amount}`,
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
