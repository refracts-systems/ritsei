import { readdir, readFile, stat } from "node:fs/promises"

import type { ModuleManifest } from "../framework/modules/module/mod.ts"
import { validateModuleRegistry } from "../framework/modules/module/mod.ts"
import { extractModuleImports, resolveLocal } from "./architecture.ts"
import { isMain } from "./entrypoint.ts"
import { parseOwnership } from "./schema-ownership.ts"
import { collectSourceFiles, type SourceFile } from "./source-files.ts"
import { hasErrnoCode } from "./errno.ts"

const moduleRoot = "erp/modules"

/** ERP modules and extensions are installed the same way (ADR-0091). */
const moduleRoots = [moduleRoot, "extensions"] as const

type Roots = ReadonlyMap<string, string>

const isTestPath = (path: string) => /\/tests\/|\.test\.tsx?$/.test(path)

const hasModuleEntry = async (directory: string) => {
  try {
    return (await stat(`${directory}/mod.ts`)).isFile()
  } catch (cause) {
    if (hasErrnoCode(cause, "ENOENT")) return false
    throw cause
  }
}

/** Each installed module's name and the root it lives under. */
const moduleDirectories = async (): Promise<Roots> => {
  const found = new Map<string, string>()

  for (const root of moduleRoots) {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (entry.isDirectory() && (await hasModuleEntry(`${root}/${entry.name}`))) {
        found.set(entry.name, root)
      }
    }
  }

  return found
}

const sameSet = (left: Iterable<string>, right: Iterable<string>) => {
  const a = [...new Set(left)].toSorted()
  const b = [...new Set(right)].toSorted()

  return a.length === b.length && a.every((value, index) => value === b[index])
}

type Manifests = ReadonlyMap<string, ModuleManifest>

const moduleOf = (path: string | undefined) =>
  path?.match(/^(?:erp\/modules|extensions)\/([^/]+)\//)?.[1]

/** Every module directory is registered under its own name, and every manifest has a directory. */
const registrationFailures = (directories: Roots, manifests: Manifests) => [
  ...directories
    .entries()
    .filter(([name]) => !manifests.has(name))
    .map(([name, root]) => `${root}/${name} has no registered manifest`),
  ...manifests
    .keys()
    .filter((name) => !directories.has(name))
    .map((name) => `manifest ${name} has no ${moduleRoot}/${name}`),
]

const schemaFailures = (
  manifests: Manifests,
  ownership: ReadonlyMap<string, string>,
  roots: Roots,
) =>
  [...manifests.values()].flatMap(({ name, schemas }) => {
    const owned = ownership
      .entries()
      .filter(([, owner]) => owner === `${roots.get(name) ?? moduleRoot}/${name}`)
      .map(([schema]) => schema)
      .toArray()

    return sameSet(owned, schemas)
      ? []
      : [
          `${name} declares schemas [${schemas.join(", ")}] but db/ownership.toml assigns [${owned.join(", ")}]`,
        ]
  })

/** Production code may import another ERP module only when its manifest declares it. */
const importFailures = (files: ReadonlyArray<SourceFile>, manifests: Manifests) =>
  files.flatMap((file) => {
    const path = file.path.replaceAll("\\", "/")
    const source = moduleOf(path)
    const manifest = source === undefined ? undefined : manifests.get(source)

    if (manifest === undefined || isTestPath(path)) return []

    return extractModuleImports(file)
      .map(({ specifier }) => moduleOf(resolveLocal(path, specifier)))
      .filter((target) => target !== undefined && target !== source)
      .filter((target) => !manifest.dependsOn.includes(target!))
      .map((target) => `${path}: imports ${target}, which ${source} does not declare in dependsOn`)
  })

/** Declared HTTP groups are defined in the module's http.ts; codegen composes them (ADR-0094). */
const surfaceFailures = (
  manifests: Manifests,
  adapters: ReadonlyMap<string, string>,
  roots: Roots,
) =>
  [...manifests.values()].flatMap(({ name, http }) =>
    http
      .filter(
        (group) =>
          !(adapters.get(name) ?? "").includes(`HttpApiGroup.make(${JSON.stringify(group)})`),
      )
      .map(
        (group) =>
          `${name} declares HTTP group ${group}, missing from ${roots.get(name) ?? moduleRoot}/${name}/http.ts`,
      ),
  )

const httpAdapters = async (manifests: ReadonlyArray<ModuleManifest>, roots: Roots) =>
  new Map(
    await Promise.all(
      manifests.map(
        async ({ name }) =>
          [
            name,
            await readFile(`${roots.get(name) ?? moduleRoot}/${name}/http.ts`, "utf8").catch(
              () => "",
            ),
          ] as const,
      ),
    ),
  )

export type ModuleRule = { readonly id: string; readonly unenforced: boolean }

const ruleId = /[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+/

/** Rules declared in a module's RULES.md as "### `ID` Title" headings (ADR-0123). */
export const parseRules = (text: string): readonly ModuleRule[] =>
  text.split(/^(?=### )/m).flatMap((section) => {
    const id = section.match(new RegExp(`^### \`(${ruleId.source})\``))?.[1]

    return id === undefined ? [] : [{ id, unenforced: /\bunenforced\b/i.test(section) }]
  })

const citedRules = (source: string) =>
  [...source.matchAll(new RegExp(`\\[(${ruleId.source})\\]`, "g"))].map((match) => match[1]!)

/**
 * Every rule a module's RULES.md declares is named, as "[ID]", by a test (the module's own or a
 * cross-module test under `tests/`) unless the rule is marked unenforced, and every ID a test names
 * is declared by exactly one module. A match proves that a test names the rule, not that it checks
 * it.
 */
export const ruleFailures = (
  rules: ReadonlyMap<string, readonly ModuleRule[]>,
  files: ReadonlyArray<SourceFile>,
  roots: Roots = new Map(),
) => {
  const owners = new Map<string, string[]>()

  for (const [module, declared] of rules) {
    for (const { id } of declared) owners.set(id, [...(owners.get(id) ?? []), module])
  }

  const citations = files.flatMap((file) => {
    const path = file.path.replaceAll("\\", "/")

    return isTestPath(path)
      ? citedRules(file.source).map((id) => ({ path, id, module: owners.get(id)?.[0] }))
      : []
  })

  const unknown = citations
    .values()
    .filter(({ module }) => module === undefined)
    .map(({ path, id }) => `${path} names rule ${id}, which no module RULES.md declares`)
    .toArray()

  const shared = owners
    .entries()
    .filter(([, modules]) => modules.length > 1)
    .map(([id, modules]) => `rule ${id} is declared by more than one module: ${modules.join(", ")}`)
    .toArray()

  return [...new Set([...unknown, ...shared, ...declaredFailures(rules, citations, roots)])]
}

const declaredFailures = (
  rules: ReadonlyMap<string, readonly ModuleRule[]>,
  citations: ReadonlyArray<{ readonly module: string | undefined; readonly id: string }>,
  roots: Roots,
) =>
  [...rules].flatMap(([module, declared]) => {
    const where = `${roots.get(module) ?? moduleRoot}/${module}/RULES.md`

    const named = new Set(
      citations
        .values()
        .filter((c) => c.module === module)
        .map(({ id }) => id),
    )

    return declared.flatMap(({ id, unenforced }, index) => [
      ...(declared.findIndex((rule) => rule.id === id) < index
        ? [`${where} declares ${id} twice`]
        : []),
      ...(!named.has(id) && !unenforced
        ? [`${where}: no test names [${id}]; add one or mark it unenforced`]
        : []),
      ...(named.has(id) && unenforced
        ? [`${where}: ${id} is marked unenforced but a test names it`]
        : []),
    ])
  })

const moduleRules = async (directories: Roots) => {
  const rules = new Map<string, readonly ModuleRule[]>()

  for (const [name, root] of directories) {
    const text = await readFile(`${root}/${name}/RULES.md`, "utf8").catch((cause: unknown) => {
      if (hasErrnoCode(cause, "ENOENT")) return undefined
      throw cause
    })

    if (text !== undefined) rules.set(name, parseRules(text))
  }

  return rules
}

/** Checks installed ERP module manifests and rules against the repository (ADR-0094, ADR-0123). */
export const checkModules = async (
  manifests: ReadonlyArray<ModuleManifest>,
): Promise<readonly string[]> => {
  const byName: Manifests = new Map(manifests.map((manifest) => [manifest.name, manifest]))

  const [directories, ownership, files, adapters, chainTests, frontendTests] = await Promise.all([
    moduleDirectories(),
    readFile("db/ownership.toml", "utf8").then(parseOwnership),
    Promise.all(moduleRoots.map((root) => collectSourceFiles(root, [".ts", ".tsx"]))).then(
      (lists) => lists.flat(),
    ),
    moduleDirectories().then((roots) => httpAdapters(manifests, roots)),
    // Cross-module tests that may enforce a module rule; tests/architecture holds rule fixtures.
    collectSourceFiles("tests/chains", [".ts"]),
    collectSourceFiles("tests/frontend", [".ts"]),
  ])

  const failures = [
    ...validateModuleRegistry(manifests),
    ...registrationFailures(directories, byName),
    ...schemaFailures(byName, ownership, directories),
    ...importFailures(files, byName),
    ...surfaceFailures(byName, adapters, directories),
    ...ruleFailures(
      await moduleRules(directories),
      [...files, ...chainTests, ...frontendTests],
      directories,
    ),
  ]

  return [...new Set(failures)].toSorted()
}

if (isMain(import.meta.url)) {
  const { ErpModules } = await import("../erp/runtime/modules.gen.ts")
  const failures = await checkModules(ErpModules)

  if (failures.length > 0) {
    console.error(failures.join("\n"))
    process.exit(1)
  }

  console.log("module manifests valid")
}
