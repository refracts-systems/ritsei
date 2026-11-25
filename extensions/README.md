# extensions

Modules from other developers and customers live here, one directory per module, with the same
shape as an `erp/modules/<name>` module. Extensions import only the public entry points of
`framework/` and `erp/` modules ([ADR-0091](../docs/decisions/0091-adopt-framework-and-flagship-erp.md)).

An extension owns its database objects in its own chain
([ADR-0136](../docs/decisions/0136-adopt-per-extension-migration-chains.md)):

- Schema in `<name>/db/schema.ts`, migrations in `<name>/db/migrations/`, configuration in
  `<name>/drizzle.config.ts`. Generate with
  `pnpm exec varlock run -- drizzle-kit generate --config=extensions/<name>/drizzle.config.ts --name <migration>`.
- Its journal is `system.extension_migrations_<name>`; the runner applies the core chain first, then
  each installed extension's chain.
- It writes only to the schemas `db/ownership.toml` assigns to it, keeps no foreign key into core,
  and gives every table a `tenant_id`. `pnpm run boundary:lint` checks the SQL.
