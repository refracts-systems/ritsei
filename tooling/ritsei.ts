import { mkdir, readFile, stat, writeFile } from "node:fs/promises"

import { isMain } from "./entrypoint.ts"

const registryFile = "erp/runtime/modules.ts"
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

/** Adds the module's manifest import and list entry to the installed-module registry. */
export const registerModule = (registry: string, name: string): string => {
  const type = pascalCase(name)
  const importLine = `import { ${type}Module } from "../modules/${name}/mod.ts"`
  if (registry.includes(importLine)) throw new Error(`${name} is already registered`)
  const lines = registry.split("\n")
  const moduleImports = lines.flatMap((line, index) =>
    line.startsWith("import { ") && line.includes('from "../modules/') ? [index] : [],
  )
  const insertAt = moduleImports.find((index) => lines[index]! > importLine)
  lines.splice(insertAt ?? (moduleImports.at(-1) ?? 0) + 1, 0, importLine)
  const close = lines.lastIndexOf("]")
  if (close === -1) throw new Error(`${registryFile} has no module list`)
  lines.splice(close, 0, `  ${type}Module,`)
  return lines.join("\n")
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
  const registry = registerModule(await readFile(registryFile, "utf8"), name)
  const files = renderModule(name)
  for (const file of files) {
    await mkdir(file.path.slice(0, file.path.lastIndexOf("/")), { recursive: true })
    await writeFile(file.path, file.content)
  }
  await writeFile(registryFile, registry)
  return [...files.map(({ path }) => path), registryFile]
}

const usage = "usage: pnpm run ritsei new module <name>"

if (isMain(import.meta.url)) {
  const [command, kind, name] = process.argv.slice(2)
  if (command !== "new" || kind !== "module" || name === undefined) {
    console.error(usage)
    process.exit(1)
  }
  try {
    for (const path of await newModule(name)) console.log(`created ${path}`)
    console.log("Next: declare dependencies, schemas, capabilities, and routes in manifest.ts.")
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : String(cause))
    process.exit(1)
  }
}
