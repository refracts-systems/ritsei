import "../../tooling/load-env.ts"
import { defineConfig } from "drizzle-kit"
import process from "node:process"

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error("Missing DATABASE_URL in Varlock schema or .env.local")
}

// The extension's own migration chain and journal (ADR-0136); the core chain never sees it.
export default defineConfig({
  schema: "./extensions/helpdesk/db/schema.ts",
  out: "./extensions/helpdesk/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: databaseUrl },
  migrations: { schema: "system", table: "extension_migrations_helpdesk" },
  schemaFilter: ["helpdesk"],
  breakpoints: true,
  strict: true,
  verbose: true,
})
