import { mkdir, stat, writeFile } from "node:fs/promises"

import { generate } from "./codegen.ts"
import { newEntityModule } from "./entity.ts"
import { isMain } from "./entrypoint.ts"

const moduleName = /^[a-z][a-z0-9_]*$/

export type GeneratedFile = { readonly path: string; readonly content: string }

const pascalCase = (name: string) =>
  name
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")

export const isValidModuleName = (name: string) => moduleName.test(name)

/**
 * Scaffolds module structure only (ADR-0094, ADR-0046): no capabilities, tables, business
 * transitions, cross-module consequences, or grants. Those are added explicitly afterwards.
 */
export const renderModule = (name: string): readonly GeneratedFile[] => {
  if (!isValidModuleName(name)) throw new Error(`module name must match ${moduleName}`)
  const type = pascalCase(name)
  const root = `erp/modules/${name}`
  return [
    {
      path: `${root}/manifest.ts`,
      content: `import { defineModule } from "../../../framework/modules/module/mod.ts"

export const ${type}Module = defineModule({
  name: "${name}",
  layer: "erp",
  dependsOn: [],
  schemas: [],
  capabilities: {},
  actions: [],
  events: [],
  consumes: [],
  http: [],
  pages: [],
})
`,
    },
    {
      path: `${root}/mod.ts`,
      content: `export { ${type}Service } from "./src/contract.ts"
export type { ${type}Service as ${type}ServiceShape } from "./src/contract.ts"
export { ${type}Live, make${type}Service } from "./src/layers.ts"
export { ${type}Module } from "./manifest.ts"
`,
    },
    {
      path: `${root}/src/contract.ts`,
      content: `import * as Context from "effect/Context"

/** Public operations of the ${name} module. Add each one with its schema, errors, and capability. */
export type ${type}Service = Readonly<Record<never, never>>

export const ${type}Service = Context.Service<${type}Service>("RITSEI/${type}Service")
`,
    },
    {
      path: `${root}/src/layers.ts`,
      content: `import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { ${type}Service } from "./contract.ts"

export const make${type}Service = Effect.sync((): ${type}Service => ({}))
export const ${type}Live = Layer.effect(${type}Service, make${type}Service)
`,
    },
    {
      path: `${root}/tests/${name}.test.ts`,
      content: `import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import { validateModuleRegistry } from "../../../../framework/modules/module/mod.ts"
import { ${type}Live, ${type}Module, ${type}Service } from "../mod.ts"

describe("${name} module", () => {
  it("declares a valid manifest", () => {
    assert.strictEqual(${type}Module.name, "${name}")
    assert.deepStrictEqual(validateModuleRegistry([${type}Module]), [])
  })

  it.effect("provides its service", () =>
    Effect.gen(function* () {
      assert.isDefined(yield* ${type}Service)
    }).pipe(Effect.provide(${type}Live)),
  )
})
`,
    },
  ]
}

const exists = async (path: string) => {
  try {
    await stat(path)
    return true
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return false
    throw cause
  }
}

export const newModule = async (name: string): Promise<readonly string[]> => {
  if (!isValidModuleName(name)) throw new Error(`module name must match ${moduleName}`)
  if (await exists(`erp/modules/${name}`)) throw new Error(`erp/modules/${name} already exists`)
  const files = renderModule(name)
  for (const file of files) {
    await mkdir(file.path.slice(0, file.path.lastIndexOf("/")), { recursive: true })
    await writeFile(file.path, file.content)
  }
  return [...files.map(({ path }) => path), ...(await generate({ check: false }))]
}

const usage = [
  "usage: pnpm run ritsei new module <name> [--entity <entity>]",
  "       pnpm run ritsei gen [--check]",
].join("\n")

const runGen = async (check: boolean) => {
  const stale = await generate({ check })
  if (check && stale.length > 0) {
    throw new Error(`stale generated files: ${stale.join(", ")}; run pnpm run ritsei gen`)
  }
  for (const path of stale) console.log(`generated ${path}`)
}

/** Parses `new module <name> [--entity <entity>]`. */
const parseNew = (args: readonly string[]) => {
  const [, kind, name, flag, entity, ...rest] = args
  const valid =
    kind === "module" &&
    name !== undefined &&
    rest.length === 0 &&
    (flag === undefined || (flag === "--entity" && entity !== undefined))
  if (!valid) throw new Error(usage)
  if (entity !== undefined && !isValidModuleName(entity)) {
    throw new Error(`entity name must match ${moduleName}`)
  }
  return { name, entity }
}

const runNew = async (args: readonly string[]) => {
  const { name, entity } = parseNew(args)
  const created = entity === undefined ? await newModule(name) : await newEntityModule(name, entity)
  for (const path of created) console.log(`wrote ${path}`)
  console.log(
    entity === undefined
      ? "Next: declare dependencies, schemas, capabilities, and routes in manifest.ts."
      : "Next: review the generated migration SQL, then grant the new capabilities to try the page.",
  )
}

const run = (args: readonly string[]) => {
  if (args[0] === "gen") return runGen(args[1] === "--check")
  if (args[0] === "new") return runNew(args)
  throw new Error(usage)
}

if (isMain(import.meta.url)) {
  try {
    await run(process.argv.slice(2))
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : String(cause))
    process.exit(1)
  }
}
