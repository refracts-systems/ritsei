import { pgSchema, primaryKey, text } from "drizzle-orm/pg-core"

export const domainModelSchema = pgSchema("domain_model")

/**
 * The Effect Cluster host's key-value storage (ADR-0124). The host reads and writes it with its own
 * SQL, so this definition exists for migrations and ownership only; no module imports it. The host
 * also expects `COLLATE "C"` on both key columns, which Drizzle cannot express, so the migration
 * adds it by hand.
 */
export const alchemyDomainObjects = domainModelSchema.table(
  "alchemy_domain_objects",
  {
    object: text("object").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
  },
  (table) => [
    primaryKey({ name: "alchemy_domain_objects_pkey", columns: [table.object, table.key] }),
  ],
)
