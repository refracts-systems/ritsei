import "./tooling/load-env.ts"
import { defineConfig } from "drizzle-kit"
import process from "node:process"

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error("Missing DATABASE_URL in Varlock schema or .env.local")
}

export default defineConfig({
  schema: "./db/schema/index.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
  migrations: {
    schema: "system",
    table: "schema_migrations",
  },
  schemaFilter: [
    "identity",
    "party",
    "auth",
    "authorization",
    "integration",
    "sales",
    "procurement",
    "inventory",
    "accounting",
    "process",
    "messaging",
    "billing",
    "settlement",
    "numbering",
    "approvals",
    "product",
    "tax",
  ],
  breakpoints: true,
  strict: true,
  verbose: true,
})
