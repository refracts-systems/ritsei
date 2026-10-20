import { readdir, readFile, stat } from "node:fs/promises"

import type { ModuleManifest } from "../framework/modules/module/mod.ts"
import { validateModuleRegistry } from "../framework/modules/module/mod.ts"
import { extractModuleImports, resolveLocal } from "./architecture.ts"
import { isMain } from "./entrypoint.ts"
import { parseOwnership } from "./schema-ownership.ts"
import { collectSourceFiles, type SourceFile } from "./source-files.ts"
import { hasErrnoCode } from "./errno.ts"

const moduleRoot = "erp/modules"

const isTestPath = (path: string) => /\/tests\/|\.test\.tsx?$/.test(path)

const moduleDirectories = async () => {
  const names: string[] = []
  for (const entry of await readdir(moduleRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    try {
      if ((await stat(`${moduleRoot}/${entry.name}/mod.ts`)).isFile()) names.push(entry.name)
    } catch (cause) {
      if (!hasErrnoCode(cause, "ENOENT")) throw cause
    }
  }
  return names
}

const sameSet = (left: Iterable<string>, right: Iterable<string>) => {
  const a = [...new Set(left)].toSorted()
  const b = [...new Set(right)].toSorted()
  return a.length === b.length && a.every((value, index) => value === b[index])
}

type Manifests = ReadonlyMap<string, ModuleManifest>

const moduleOf = (path: string | undefined) => path?.match(/^erp\/modules\/([^/]+)\//)?.[1]

/** Every module directory is registered under its own name, and every manifest has a directory. */
const registrationFailures = (directories: readonly string[], manifests: Manifests) => [
  ...directories
    .values()
    .filter((name) => !manifests.has(name))
    .map((name) => `${moduleRoot}/${name} has no registered manifest`),
  ...manifests
    .keys()
    .filter((name) => !directories.includes(name))
    .map((name) => `manifest ${name} has no ${moduleRoot}/${name}`),
]

const schemaFailures = (manifests: Manifests, ownership: ReadonlyMap<string, string>) =>
  [...manifests.values()].flatMap(({ name, schemas }) => {
    const owned = ownership
      .entries()
      .filter(([, owner]) => owner === `${moduleRoot}/${name}`)
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
const surfaceFailures = (manifests: Manifests, adapters: ReadonlyMap<string, string>) =>
  [...manifests.values()].flatMap(({ name, http }) =>
    http
      .filter(
        (group) =>
          !(adapters.get(name) ?? "").includes(`HttpApiGroup.make(${JSON.stringify(group)})`),
      )
      .map(
        (group) =>
          `${name} declares HTTP group ${group}, missing from ${moduleRoot}/${name}/http.ts`,
      ),
  )

const httpAdapters = async (manifests: ReadonlyArray<ModuleManifest>) =>
  new Map(
    await Promise.all(
      manifests.map(
        async ({ name }) =>
          [name, await readFile(`${moduleRoot}/${name}/http.ts`, "utf8").catch(() => "")] as const,
      ),
    ),
  )

/** Checks installed ERP module manifests against the repository (ADR-0094). */
export const checkModules = async (
  manifests: ReadonlyArray<ModuleManifest>,
): Promise<readonly string[]> => {
  const byName: Manifests = new Map(manifests.map((manifest) => [manifest.name, manifest]))
  const [directories, ownership, files, adapters] = await Promise.all([
    moduleDirectories(),
    readFile("db/ownership.toml", "utf8").then(parseOwnership),
    collectSourceFiles(moduleRoot, [".ts", ".tsx"]),
    httpAdapters(manifests),
  ])
  const failures = [
    ...validateModuleRegistry(manifests),
    ...registrationFailures(directories, byName),
    ...schemaFailures(byName, ownership),
    ...importFailures(files, byName),
    ...surfaceFailures(byName, adapters),
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
