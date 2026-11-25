import { stat } from "node:fs/promises"

import * as Effect from "effect/Effect"
import type { Sql } from "postgres"

import { runMigrations } from "../../../framework/platform/mod.ts"
import { ErpModules } from "../modules.gen.ts"

type Extension = { readonly name: string; readonly dependsOn: ReadonlyArray<string> }

/** Installed extensions with a migration chain, each after the extensions it depends on. */
export const orderExtensions = (modules: ReadonlyArray<Extension>) => {
  const byName = new Map(modules.map((module) => [module.name, module]))
  const ordered: string[] = []
  const visiting = new Set<string>()

  const visit = (name: string) => {
    if (ordered.includes(name) || !byName.has(name)) return

    if (visiting.has(name)) throw new Error(`extension dependency cycle at ${name}`)

    visiting.add(name)

    for (const dependency of byName.get(name)!.dependsOn.toSorted()) visit(dependency)

    visiting.delete(name)
    ordered.push(name)
  }

  for (const name of [...byName.keys()].toSorted()) visit(name)

  return ordered
}

const journalOf = (name: string) => `extension_migrations_${name.replaceAll("-", "_")}`

const hasChain = (directory: string) =>
  stat(directory).then(
    (info) => info.isDirectory(),
    () => false,
  )

/** Runs each installed extension's own chain, after the core chain (ADR-0136). */
export const runExtensionMigrations = (client: Sql) =>
  Effect.gen(function* () {
    const extensions = ErpModules.filter((module) => module.layer === "extensions")

    for (const name of orderExtensions(extensions)) {
      const directory = `extensions/${name}/db/migrations`

      if (yield* Effect.promise(() => hasChain(directory))) {
        yield* runMigrations(client, directory, journalOf(name))
      }
    }
  })

export const runAllMigrations = (client: Sql) =>
  runMigrations(client).pipe(Effect.andThen(runExtensionMigrations(client)))
