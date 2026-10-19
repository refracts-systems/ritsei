// `ritsei new module <name> --entity <entity>` (ADR-0094): writes an entity module, registers it in
// the hand-written composition files, regenerates the module composition, and generates its migration.
import { execFileSync } from "node:child_process"
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

import { format, generate } from "./codegen.ts"
import {
  addCapabilities,
  addOwnership,
  addSchemaExports,
  addSchemaFilter,
  addServiceLayer,
} from "./entity-edits.ts"
import { entityNames, type EntityNames, renderEntityModule } from "./entity-templates.ts"

const migrations = "db/migrations"

const exists = (path: string) =>
  stat(path).then(
    () => true,
    (cause: NodeJS.ErrnoException) => {
      if (cause.code === "ENOENT") return false
      throw cause
    },
  )

type Edit = { readonly path: string; readonly apply: (source: string) => string }

const edits = (n: EntityNames): readonly Edit[] => [
  {
    path: "framework/modules/authorization/src/capabilities.ts",
    apply: (source) => addCapabilities("capabilities.ts", source, n),
  },
  { path: "drizzle.config.ts", apply: (source) => addSchemaFilter("drizzle.config.ts", source, n) },
  { path: "db/schema/index.ts", apply: (source) => addSchemaExports("index.ts", source, n) },
  { path: "erp/runtime/layers.ts", apply: (source) => addServiceLayer("layers.ts", source, n) },
  { path: "db/ownership.toml", apply: (source) => addOwnership(source, n) },
]

// drizzle-kit does not export its package.json, so resolve its declared bin from the workspace.
const drizzleKit = () => resolve("node_modules/drizzle-kit/bin.cjs")

/** Runs the pinned Drizzle Kit generator, then stamps the headers the ownership check requires. */
const generateMigration = async (n: EntityNames) => {
  const before = new Set(await readdir(migrations))
  execFileSync(
    process.execPath,
    [drizzleKit(), "generate", "--config=drizzle.config.ts", `--name=create_${n.module}`],
    {
      // Generation compares schema snapshots and never connects; the URL only satisfies the config.
      env: {
        ...process.env,
        DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://localhost:5432/ritsei",
      },
      stdio: "inherit",
    },
  )
  const created = (await readdir(migrations)).filter((entry) => !before.has(entry))
  if (created.length !== 1) throw new Error(`expected one new migration, found ${created.length}`)
  const path = `${migrations}/${created[0]}/migration.sql`
  const today = new Date().toISOString().slice(0, 10)
  const header = [
    `-- owner: ${n.module}`,
    `-- reviewed: ${today}`,
    "-- generated-by: drizzle-kit 1.0.0-rc.4",
    `-- rationale: create the ${n.module} module's ${n.table} table (ritsei new module --entity)`,
    "",
  ].join("\n")
  await writeFile(path, `${header}${await readFile(path, "utf8")}`)
  return path
}

export const newEntityModule = async (module: string, entity: string) => {
  const n = entityNames(module, entity)
  const files = renderEntityModule(n)
  for (const { path } of files) {
    if (await exists(path)) throw new Error(`${path} already exists`)
  }
  for (const file of files) {
    await mkdir(file.path.slice(0, file.path.lastIndexOf("/")), { recursive: true })
    await writeFile(file.path, format(file.path, file.content))
  }
  for (const { path, apply } of edits(n)) {
    const edited = apply(await readFile(path, "utf8"))
    await writeFile(path, path.endsWith(".ts") ? format(path, edited) : edited)
  }
  const generated = await generate({ check: false })
  const migration = await generateMigration(n)
  return [
    ...files.map(({ path }) => path),
    ...edits(n).map(({ path }) => path),
    ...generated,
    migration,
  ]
}
