import { sql } from "drizzle-orm"
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  numeric,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core"

import { tenants } from "./auth.ts"
import { createdAt, id, money, updatedAt } from "./common.ts"
import { legalEntities, partyRelationships } from "./party.ts"
import { products } from "./product.ts"
import { taxCodes } from "./tax.ts"

export const salesSchema = pgSchema("sales")
export const quotationStatus = salesSchema.enum("quotation_status", [
  "draft",
  "sent",
  "accepted",
  "rejected",
  "expired",
])
export const orderStatus = salesSchema.enum("order_status", ["draft", "confirmed", "cancelled"])

export const customers = salesSchema.table(
  "customers",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    // Customer role of a party in a legal entity (ADR-0099); null on customers created before it.
    partyId: uuid("party_id"),
    partyRelationshipId: uuid("party_relationship_id"),
    legalEntityId: uuid("legal_entity_id"),
    priceListId: uuid("price_list_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("customers_tenant_id_id_key").on(table.tenantId, table.id),
    unique("customers_tenant_party_relationship_key").on(table.tenantId, table.partyRelationshipId),
    foreignKey({
      columns: [table.tenantId, table.partyRelationshipId],
      foreignColumns: [partyRelationships.tenantId, partyRelationships.id],
      name: "customers_party_relationship_fkey",
    }),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntities.tenantId, legalEntities.id],
      name: "customers_legal_entity_fkey",
    }),
    check(
      "customers_party_role_check",
      sql`(${table.partyId} is null and ${table.partyRelationshipId} is null and ${table.legalEntityId} is null) or
      (${table.partyId} is not null and ${table.partyRelationshipId} is not null and ${table.legalEntityId} is not null)`,
    ),
    unique("customers_tenant_email_key").on(table.tenantId, table.email),
    check(
      "customers_email_normalization_check",
      sql`${table.email} = lower(btrim(${table.email})) and ${table.email} ~ '[^[:space:]]'`,
    ),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "customers_tenant_id_fkey",
    }).onDelete("cascade"),
  ],
)

export const quotations = salesSchema.table(
  "quotations",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    customerId: uuid("customer_id").notNull(),
    status: quotationStatus("status").notNull().default("draft"),
    total: money("total"),
    legalEntityId: uuid("legal_entity_id"),
    validUntil: date("valid_until", { mode: "string" }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("quotations_tenant_id_id_key").on(table.tenantId, table.id),
    unique("quotations_tenant_id_id_customer_id_key").on(
      table.tenantId,
      table.id,
      table.customerId,
    ),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "quotations_tenant_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.customerId],
      foreignColumns: [customers.tenantId, customers.id],
      name: "quotations_tenant_customer_fkey",
    }),
    check("quotations_total_check", sql`${table.total} >= 0`),
  ],
)

export const orders = salesSchema.table(
  "orders",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    customerId: uuid("customer_id").notNull(),
    quotationId: uuid("quotation_id"),
    status: orderStatus("status").notNull().default("draft"),
    confirmationIdempotencyKey: text("confirmation_idempotency_key"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    total: money("total"),
    legalEntityId: uuid("legal_entity_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("orders_tenant_id_id_key").on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntities.tenantId, legalEntities.id],
      name: "orders_legal_entity_fkey",
    }),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "orders_tenant_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.customerId],
      foreignColumns: [customers.tenantId, customers.id],
      name: "orders_tenant_customer_fkey",
    }),
    foreignKey({
      columns: [table.tenantId, table.quotationId],
      foreignColumns: [quotations.tenantId, quotations.id],
      name: "orders_tenant_quotation_fkey",
    }),
    foreignKey({
      columns: [table.tenantId, table.quotationId, table.customerId],
      foreignColumns: [quotations.tenantId, quotations.id, quotations.customerId],
      name: "orders_tenant_quotation_customer_fkey",
    }),
    unique("orders_tenant_confirmation_idempotency_key").on(
      table.tenantId,
      table.confirmationIdempotencyKey,
    ),
    check("orders_total_check", sql`${table.total} >= 0`),
    check(
      "orders_confirmation_state_check",
      sql`(${table.status} = 'draft' and ${table.confirmedAt} is null) or
      (${table.status} = 'confirmed' and ${table.confirmedAt} is not null) or
      (${table.status} = 'cancelled')`,
    ),
    check(
      "orders_confirmation_metadata_check",
      sql`(${table.status} = 'draft' and ${table.confirmationIdempotencyKey} is null) or
      (${table.status} in ('confirmed', 'cancelled') and
        ${table.confirmationIdempotencyKey} is not null and
        ${table.confirmationIdempotencyKey} ~ '[^[:space:]]' and
        ${table.confirmedAt} is not null)`,
    ),
  ],
)

export const orderLines = salesSchema.table(
  "order_lines",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    orderId: uuid("order_id").notNull(),
    itemId: uuid("item_id").notNull(),
    quantity: bigint("quantity", { mode: "string" }).notNull(),
    unitPrice: money("unit_price").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    unique("order_lines_tenant_id_id_key").on(table.tenantId, table.id),
    unique("order_lines_tenant_order_id_key").on(table.tenantId, table.orderId, table.id),
    index("order_lines_tenant_order_idx").on(table.tenantId, table.orderId),
    foreignKey({
      columns: [table.tenantId, table.orderId],
      foreignColumns: [orders.tenantId, orders.id],
      name: "order_lines_tenant_order_fkey",
    }).onDelete("cascade"),
    check("order_lines_quantity_check", sql`${table.quantity} > 0`),
    check("order_lines_unit_price_check", sql`${table.unitPrice} >= 0`),
  ],
)

export const priceLists = salesSchema.table(
  "price_lists",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    name: text("name").notNull(),
    currency: text("currency").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("price_lists_tenant_id_id_key").on(table.tenantId, table.id),
    unique("price_lists_tenant_name_key").on(table.tenantId, table.name),
    check("price_lists_currency_check", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check(
      "price_lists_name_check",
      sql`${table.name} = btrim(${table.name}) and ${table.name} ~ '[^[:space:]]'`,
    ),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "price_lists_tenant_id_fkey",
    }).onDelete("cascade"),
  ],
)

export const priceListItems = salesSchema.table(
  "price_list_items",
  {
    tenantId: uuid("tenant_id").notNull(),
    priceListId: uuid("price_list_id").notNull(),
    productId: uuid("product_id").notNull(),
    unitPrice: money("unit_price"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.priceListId, table.productId] }),
    foreignKey({
      columns: [table.tenantId, table.priceListId],
      foreignColumns: [priceLists.tenantId, priceLists.id],
      name: "price_list_items_price_list_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
      name: "price_list_items_product_fkey",
    }),
    check("price_list_items_unit_price_check", sql`${table.unitPrice} >= 0`),
  ],
)

/** Priced lines of a quotation; the quotation total is their sum. */
export const quotationLines = salesSchema.table(
  "quotation_lines",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    quotationId: uuid("quotation_id").notNull(),
    productId: uuid("product_id").notNull(),
    quantity: bigint("quantity", { mode: "string" }).notNull(),
    listPrice: money("list_price"),
    discountPercent: numeric("discount_percent", { precision: 5, scale: 2 }).notNull().default("0"),
    unitPrice: money("unit_price"),
    taxCodeId: uuid("tax_code_id"),
    createdAt: createdAt(),
  },
  (table) => [
    index("quotation_lines_tenant_quotation_idx").on(table.tenantId, table.quotationId),
    foreignKey({
      columns: [table.tenantId, table.quotationId],
      foreignColumns: [quotations.tenantId, quotations.id],
      name: "quotation_lines_quotation_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
      name: "quotation_lines_product_fkey",
    }),
    foreignKey({
      columns: [table.tenantId, table.taxCodeId],
      foreignColumns: [taxCodes.tenantId, taxCodes.id],
      name: "quotation_lines_tax_code_fkey",
    }),
    check("quotation_lines_quantity_check", sql`${table.quantity} > 0`),
    check(
      "quotation_lines_price_check",
      sql`${table.listPrice} >= 0 and ${table.unitPrice} >= 0 and ${table.discountPercent} between 0 and 100`,
    ),
  ],
)

/** Pricing and tax terms of an order line, fixed when the line is created. */
export const orderLineTerms = salesSchema.table(
  "order_line_terms",
  {
    tenantId: uuid("tenant_id").notNull(),
    orderLineId: uuid("order_line_id").notNull(),
    listPrice: money("list_price"),
    discountPercent: numeric("discount_percent", { precision: 5, scale: 2 }).notNull().default("0"),
    taxCodeId: uuid("tax_code_id"),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.orderLineId] }),
    foreignKey({
      columns: [table.tenantId, table.orderLineId],
      foreignColumns: [orderLines.tenantId, orderLines.id],
      name: "order_line_terms_order_line_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.taxCodeId],
      foreignColumns: [taxCodes.tenantId, taxCodes.id],
      name: "order_line_terms_tax_code_fkey",
    }),
    check(
      "order_line_terms_price_check",
      sql`${table.listPrice} >= 0 and ${table.discountPercent} between 0 and 100`,
    ),
  ],
)

/** Delivery evidence for a confirmed order; Inventory records the stock movement (ADR-0101). */
export const deliveries = salesSchema.table(
  "deliveries",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    orderId: uuid("order_id").notNull(),
    legalEntityId: uuid("legal_entity_id").notNull(),
    warehouseId: uuid("warehouse_id").notNull(),
    number: text("number").notNull(),
    deliveryDate: date("delivery_date", { mode: "string" }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    unique("deliveries_tenant_id_id_key").on(table.tenantId, table.id),
    unique("deliveries_tenant_order_id_key").on(table.tenantId, table.orderId, table.id),
    unique("deliveries_legal_entity_number_key").on(
      table.tenantId,
      table.legalEntityId,
      table.number,
    ),
    foreignKey({
      columns: [table.tenantId, table.orderId],
      foreignColumns: [orders.tenantId, orders.id],
      name: "deliveries_order_fkey",
    }),
  ],
)

export const deliveryLines = salesSchema.table(
  "delivery_lines",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    deliveryId: uuid("delivery_id").notNull(),
    orderId: uuid("order_id").notNull(),
    orderLineId: uuid("order_line_id").notNull(),
    quantity: bigint("quantity", { mode: "string" }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    unique("delivery_lines_delivery_order_line_key").on(
      table.tenantId,
      table.deliveryId,
      table.orderLineId,
    ),
    index("delivery_lines_order_line_idx").on(table.tenantId, table.orderLineId),
    foreignKey({
      columns: [table.tenantId, table.orderId, table.deliveryId],
      foreignColumns: [deliveries.tenantId, deliveries.orderId, deliveries.id],
      name: "delivery_lines_delivery_fkey",
    }),
    foreignKey({
      columns: [table.tenantId, table.orderId, table.orderLineId],
      foreignColumns: [orderLines.tenantId, orderLines.orderId, orderLines.id],
      name: "delivery_lines_order_line_fkey",
    }),
    check("delivery_lines_quantity_check", sql`${table.quantity} > 0`),
  ],
)
