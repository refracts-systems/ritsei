import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  foreignKey,
  integer,
  pgSchema,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import { tenants } from "./auth.ts"
import { createdAt, id, updatedAt } from "./common.ts"
import { userAccounts } from "./identity.ts"

export const partySchema = pgSchema("party")
export const partyKind = partySchema.enum("party_kind", ["person", "organization"])
export const partyRole = partySchema.enum("party_role", [
  "customer",
  "supplier",
  "employee",
  "partner",
])

export const parties = partySchema.table(
  "parties",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    kind: partyKind("kind").notNull(),
    name: text("name").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("parties_tenant_id_id_key").on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "parties_tenant_id_fkey",
    }).onDelete("cascade"),
  ],
)

export const partyRepresentations = partySchema.table(
  "party_representations",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    userAccountId: uuid("user_account_id").notNull(),
    partyId: uuid("party_id").notNull(),
    kind: text("kind").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("party_representations_tenant_id_id_key").on(table.tenantId, table.id),
    unique("party_representations_tenant_user_account_party_kind_key").on(
      table.tenantId,
      table.userAccountId,
      table.partyId,
      table.kind,
    ),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: "party_representations_tenant_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.userAccountId],
      foreignColumns: [userAccounts.id],
      name: "party_representations_user_account_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.partyId],
      foreignColumns: [parties.tenantId, parties.id],
      name: "party_representations_party_fkey",
    }).onDelete("cascade"),
    check("party_representations_kind_check", sql`${table.kind} ~ '[^[:space:]]'`),
  ],
)

export const legalEntities = partySchema.table(
  "legal_entities",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    organizationPartyId: uuid("organization_party_id").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("legal_entities_tenant_id_id_key").on(table.tenantId, table.id),
    unique("legal_entities_tenant_organization_party_key").on(
      table.tenantId,
      table.organizationPartyId,
    ),
    foreignKey({
      columns: [table.tenantId, table.organizationPartyId],
      foreignColumns: [parties.tenantId, parties.id],
      name: "legal_entities_tenant_organization_party_fkey",
    }),
  ],
)

export const branches = partySchema.table(
  "branches",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    legalEntityId: uuid("legal_entity_id").notNull(),
    name: text("name").notNull(),
    timezone: text("timezone"),
    localTaxRegistration: text("local_tax_registration"),
    dedicatedJournalCode: text("dedicated_journal_code"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("branches_tenant_id_id_key").on(table.tenantId, table.id),
    unique("branches_tenant_legal_entity_name_key").on(
      table.tenantId,
      table.legalEntityId,
      table.name,
    ),
    unique("branches_tenant_legal_entity_id_key").on(table.tenantId, table.legalEntityId, table.id),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntities.tenantId, legalEntities.id],
      name: "branches_tenant_legal_entity_fkey",
    }),
  ],
)

export const partyRoles = partySchema.table(
  "party_roles",
  {
    tenantId: uuid("tenant_id").notNull(),
    partyId: uuid("party_id").notNull(),
    role: partyRole("role").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.partyId, table.role] }),
    foreignKey({
      columns: [table.tenantId, table.partyId],
      foreignColumns: [parties.tenantId, parties.id],
      name: "party_roles_tenant_party_fkey",
    }).onDelete("cascade"),
  ],
)

export const partyRelationships = partySchema.table(
  "party_relationships",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    partyId: uuid("party_id").notNull(),
    legalEntityId: uuid("legal_entity_id").notNull(),
    kind: partyRole("kind").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("party_relationships_tenant_id_id_key").on(table.tenantId, table.id),
    unique("party_relationships_tenant_party_legal_entity_kind_key").on(
      table.tenantId,
      table.partyId,
      table.legalEntityId,
      table.kind,
    ),
    foreignKey({
      columns: [table.tenantId, table.partyId],
      foreignColumns: [parties.tenantId, parties.id],
      name: "party_relationships_tenant_party_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntities.tenantId, legalEntities.id],
      name: "party_relationships_tenant_legal_entity_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.partyId, table.kind],
      foreignColumns: [partyRoles.tenantId, partyRoles.partyId, partyRoles.role],
      name: "party_relationships_tenant_party_role_fkey",
    }).onDelete("cascade"),
  ],
)

export const relatedPartyPaths = partySchema
  .view("related_party_paths", {
    tenantId: uuid("tenant_id").notNull(),
    sourcePartyId: uuid("source_party_id").notNull(),
    targetPartyId: uuid("target_party_id").notNull(),
    legalEntityId: uuid("legal_entity_id").notNull(),
    relationshipId: uuid("relationship_id").notNull(),
    relationshipKind: partyRole("relationship_kind").notNull(),
    depth: integer("depth").notNull(),
  })
  .existing()

export const partyIdentifiers = partySchema.table(
  "party_identifiers",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    partyId: uuid("party_id").notNull(),
    provider: text("provider").notNull(),
    scheme: text("scheme").notNull(),
    scope: text("scope").notNull(),
    legalEntityId: uuid("legal_entity_id"),
    value: text("value").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("party_identifiers_tenant_provider_scope_value_uq")
      .on(table.tenantId, table.provider, table.scheme, table.scope, table.value)
      .where(sql`${table.legalEntityId} is null`),
    uniqueIndex("party_identifiers_tenant_provider_entity_scope_value_uq")
      .on(
        table.tenantId,
        table.provider,
        table.legalEntityId,
        table.scheme,
        table.scope,
        table.value,
      )
      .where(sql`${table.legalEntityId} is not null`),
    foreignKey({
      columns: [table.tenantId, table.partyId],
      foreignColumns: [parties.tenantId, parties.id],
      name: "party_identifiers_tenant_party_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntities.tenantId, legalEntities.id],
      name: "party_identifiers_tenant_legal_entity_fkey",
    }).onDelete("cascade"),
    check(
      "party_identifiers_provider_check",
      sql`${table.provider} <> '' and ${table.provider} = upper(trim(${table.provider}))`,
    ),
    check(
      "party_identifiers_scheme_check",
      sql`${table.scheme} <> '' and ${table.scheme} = upper(trim(${table.scheme}))`,
    ),
    check(
      "party_identifiers_scope_check",
      sql`${table.scope} <> '' and ${table.scope} = trim(${table.scope})`,
    ),
    check(
      "party_identifiers_value_check",
      sql`${table.value} <> '' and ${table.value} = trim(${table.value})`,
    ),
  ],
)

export const addressPurpose = partySchema.enum("address_purpose", [
  "billing",
  "shipping",
  "registered",
])

/** Postal addresses of a party; at most one primary address per purpose. */
export const partyAddresses = partySchema.table(
  "party_addresses",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    partyId: uuid("party_id").notNull(),
    purpose: addressPurpose("purpose").notNull(),
    line1: text("line1").notNull(),
    line2: text("line2"),
    city: text("city").notNull(),
    region: text("region"),
    postalCode: text("postal_code"),
    countryCode: text("country_code").notNull(),
    primary: boolean("is_primary").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("party_addresses_tenant_id_id_key").on(table.tenantId, table.id),
    uniqueIndex("party_addresses_primary_purpose_key")
      .on(table.tenantId, table.partyId, table.purpose)
      .where(sql`${table.primary}`),
    foreignKey({
      columns: [table.tenantId, table.partyId],
      foreignColumns: [parties.tenantId, parties.id],
      name: "party_addresses_party_fkey",
    }).onDelete("cascade"),
    check("party_addresses_country_code_check", sql`${table.countryCode} ~ '^[A-Z]{2}$'`),
    check(
      "party_addresses_text_check",
      sql`${table.line1} = btrim(${table.line1}) and ${table.line1} ~ '[^[:space:]]' and
      ${table.city} = btrim(${table.city}) and ${table.city} ~ '[^[:space:]]'`,
    ),
  ],
)

/** Contact persons of a party. */
export const partyContacts = partySchema.table(
  "party_contacts",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    partyId: uuid("party_id").notNull(),
    name: text("name").notNull(),
    jobTitle: text("job_title"),
    email: text("email"),
    phone: text("phone"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("party_contacts_tenant_id_id_key").on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.partyId],
      foreignColumns: [parties.tenantId, parties.id],
      name: "party_contacts_party_fkey",
    }).onDelete("cascade"),
    check(
      "party_contacts_name_check",
      sql`${table.name} = btrim(${table.name}) and ${table.name} ~ '[^[:space:]]'`,
    ),
    check(
      "party_contacts_email_check",
      sql`${table.email} is null or ${table.email} = lower(btrim(${table.email}))`,
    ),
  ],
)

/** Bank accounts a party pays from or is paid into. */
export const partyBankAccounts = partySchema.table(
  "party_bank_accounts",
  {
    id: id(),
    tenantId: uuid("tenant_id").notNull(),
    partyId: uuid("party_id").notNull(),
    bankName: text("bank_name").notNull(),
    accountNumber: text("account_number").notNull(),
    accountHolder: text("account_holder").notNull(),
    currency: text("currency").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("party_bank_accounts_tenant_id_id_key").on(table.tenantId, table.id),
    unique("party_bank_accounts_party_bank_number_key").on(
      table.tenantId,
      table.partyId,
      table.bankName,
      table.accountNumber,
    ),
    foreignKey({
      columns: [table.tenantId, table.partyId],
      foreignColumns: [parties.tenantId, parties.id],
      name: "party_bank_accounts_party_fkey",
    }).onDelete("cascade"),
    check("party_bank_accounts_currency_check", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check(
      "party_bank_accounts_number_check",
      sql`${table.accountNumber} ~ '^[A-Za-z0-9 -]+$' and ${table.accountNumber} = btrim(${table.accountNumber})`,
    ),
  ],
)
