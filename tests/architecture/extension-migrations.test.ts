import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import { orderExtensions } from "../../erp/runtime/migrator/extensions.ts"
import {
  coreMigrationFailures,
  extensionMigrationFailures,
} from "../../tooling/extension-migrations.ts"

const scope = {
  owned: new Set(["helpdesk"]),
  registered: new Set(["helpdesk", "auth", "party", "sales"]),
}

const failuresOf = (sql: string) => extensionMigrationFailures("m.sql", sql, scope)

// ADR-0136: an extension writes only to its own schemas and keeps no foreign key into core.
it.effect("accepts a migration that stays in the extension's own schema", () =>
  Effect.sync(() => {
    const sql = `CREATE SCHEMA "helpdesk";
--> statement-breakpoint
CREATE TABLE "helpdesk"."tickets" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7(),
  "tenant_id" uuid NOT NULL,
  "title" text NOT NULL,
  CONSTRAINT "tickets_title_check" CHECK ("title" ~ '[^[:space:]]')
);
--> statement-breakpoint
CREATE INDEX "tickets_idx" ON "helpdesk"."tickets" ("tenant_id");`

    assert.deepStrictEqual(failuresOf(sql), [])
  }),
)

it.effect("refuses each way an extension can reach into core", () =>
  Effect.sync(() => {
    const refused = [
      `ALTER TABLE "party"."legal_entities" ADD COLUMN "x" text;`,
      `CREATE TRIGGER t BEFORE INSERT ON "sales"."orders" FOR EACH ROW EXECUTE FUNCTION f();`,
      `CREATE TABLE "helpdesk"."a" ("tenant_id" uuid, CONSTRAINT "f" FOREIGN KEY ("tenant_id") REFERENCES "auth"."tenants"("id"));`,
      `CREATE TABLE "other"."a" ("tenant_id" uuid);`,
      `CREATE TABLE "a" ("tenant_id" uuid);`,
      `CREATE SCHEMA "other";`,
      `CREATE EXTENSION ltree;`,
      `GRANT SELECT ON "helpdesk"."tickets" TO someone;`,
      `CREATE TABLE "helpdesk"."no_tenant" ("id" uuid);`,
    ]

    for (const sql of refused) {
      assert.isAbove(failuresOf(sql).length, 0, sql)
    }
  }),
)

it.effect("keeps the core chain from naming an extension schema", () =>
  Effect.sync(() => {
    const extensions = new Set(["helpdesk"])

    assert.lengthOf(
      coreMigrationFailures("c.sql", `ALTER TABLE "helpdesk"."tickets" ADD x int;`, extensions),
      1,
    )
    assert.lengthOf(
      coreMigrationFailures("c.sql", `ALTER TABLE "party"."x" ADD y int;`, extensions),
      0,
    )
  }),
)

it.effect("runs extensions after the extensions they depend on and rejects a cycle", () =>
  Effect.sync(() => {
    const order = orderExtensions([
      { name: "b", dependsOn: ["a"] },
      { name: "a", dependsOn: ["situations"] },
      { name: "c", dependsOn: [] },
    ])

    assert.deepStrictEqual(order, ["a", "b", "c"])

    assert.throws(
      () =>
        orderExtensions([
          { name: "a", dependsOn: ["b"] },
          { name: "b", dependsOn: ["a"] },
        ]),
      /cycle/,
    )
  }),
)
