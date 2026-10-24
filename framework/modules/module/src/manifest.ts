import type { ActionCatalogEntry, EventCatalogEntry } from "./catalog.ts"

/**
 * A module's declared footprint (ADR-0094). It references the module's own capability object and
 * released action and event catalogs instead of restating them; the registry and the architecture
 * test check it against the repository.
 */
export interface ModuleManifest {
  readonly name: string
  readonly layer: "erp" | "extensions"
  /** Other `erp/` or `extensions/` modules whose public entry points this module imports. */
  readonly dependsOn: ReadonlyArray<string>
  /** PostgreSQL schemas this module owns, matching `db/ownership.toml`. */
  readonly schemas: ReadonlyArray<string>
  readonly capabilities: Readonly<Record<string, string>>
  /** Released actions and events: the module's public, versioned contracts. */
  readonly actions: ReadonlyArray<ActionCatalogEntry>
  readonly events: ReadonlyArray<EventCatalogEntry>
  /** Ids of events released by a dependency that this module consumes. */
  readonly consumes: ReadonlyArray<string>
  /** HttpApi group names that expose this module. */
  readonly http: ReadonlyArray<string>
  /** Web route paths that render this module's workspace. */
  readonly pages: ReadonlyArray<string>
}

export const defineModule = <const Manifest extends ModuleManifest>(manifest: Manifest): Manifest =>
  manifest

const modulePrefix = (name: string) => `${name}.`

const findCycle = (modules: ReadonlyMap<string, ModuleManifest>): readonly string[] | undefined => {
  const state = new Map<string, "visiting" | "done">()

  const visit = (name: string, path: readonly string[]): readonly string[] | undefined => {
    if (state.get(name) === "done") return undefined

    if (state.get(name) === "visiting") return [...path.slice(path.indexOf(name)), name]
    state.set(name, "visiting")

    for (const dependency of modules.get(name)?.dependsOn ?? []) {
      if (!modules.has(dependency)) continue
      const cycle = visit(dependency, [...path, name])

      if (cycle !== undefined) return cycle
    }

    state.set(name, "done")

    return undefined
  }

  for (const name of modules.keys()) {
    const cycle = visit(name, [])

    if (cycle !== undefined) return cycle
  }

  return undefined
}

type Modules = ReadonlyMap<string, ModuleManifest>

const nameFailures = (manifests: ReadonlyArray<ModuleManifest>) => {
  const seen = new Set<string>()

  return manifests.flatMap(({ name }) => {
    const failures = /^[a-z][a-z0-9_]*$/.test(name)
      ? []
      : [`module name ${JSON.stringify(name)} must match [a-z][a-z0-9_]*`]

    if (seen.has(name)) failures.push(`module ${name} is registered twice`)
    seen.add(name)

    return failures
  })
}

const dependencyFailures = ({ name, dependsOn }: ModuleManifest, modules: Modules) =>
  dependsOn.flatMap((dependency) =>
    dependency === name
      ? [`${name} depends on itself`]
      : modules.has(dependency)
        ? []
        : [`${name} depends on unknown module ${dependency}`],
  )

const namespaceFailures = ({ name, capabilities, actions, events }: ModuleManifest) => {
  const prefix = modulePrefix(name)
  const declared = new Set(Object.values(capabilities))

  return [
    ...declared
      .values()
      .filter((capability) => !capability.startsWith(prefix))
      .map((capability) => `${name} capability ${capability} must start with ${prefix}`),
    ...[...actions, ...events]
      .values()
      .filter((entry) => entry.owningDomain !== name || !entry.id.startsWith(prefix))
      .map((entry) => `${name} releases ${entry.id} owned by ${entry.owningDomain}`),
    ...actions
      .filter((action) => !declared.has(action.requiredCapability))
      .map(
        (action) =>
          `${name} action ${action.id} requires undeclared capability ${action.requiredCapability}`,
      ),
  ]
}

const consumptionFailures = ({ name, dependsOn, consumes }: ModuleManifest, modules: Modules) =>
  consumes
    .filter(
      (eventId) =>
        !dependsOn.some((dependency) =>
          modules.get(dependency)?.events.some((event) => event.id === eventId),
        ),
    )
    .map((eventId) => `${name} consumes ${eventId}, which no declared dependency releases`)

const claimKinds = {
  schema: (manifest: ModuleManifest) => manifest.schemas,
  capability: (manifest: ModuleManifest) => Object.values(manifest.capabilities),
  http: (manifest: ModuleManifest) => manifest.http,
  page: (manifest: ModuleManifest) => manifest.pages,
} as const

/** Schemas, capabilities, HTTP groups, and pages each have exactly one owning module. */
const ownershipFailures = (manifests: ReadonlyArray<ModuleManifest>) =>
  Object.entries(claimKinds).flatMap(([kind, values]) => {
    const owners = new Map<string, string>()

    return manifests.flatMap((manifest) =>
      values(manifest).flatMap((value) => {
        const existing = owners.get(value)
        owners.set(value, manifest.name)

        return existing !== undefined && existing !== manifest.name
          ? [`${kind} ${value} is declared by both ${existing} and ${manifest.name}`]
          : []
      }),
    )
  })

/** Returns every rule violation in an installed module set; an empty list means it is valid. */
export const validateModuleRegistry = (
  manifests: ReadonlyArray<ModuleManifest>,
): readonly string[] => {
  const modules: Modules = new Map(manifests.map((manifest) => [manifest.name, manifest]))
  const cycle = findCycle(modules)

  return [
    ...nameFailures(manifests),
    ...manifests.flatMap((manifest) => [
      ...dependencyFailures(manifest, modules),
      ...namespaceFailures(manifest),
      ...consumptionFailures(manifest, modules),
    ]),
    ...ownershipFailures(manifests),
    ...(cycle === undefined ? [] : [`module dependency cycle: ${cycle.join(" -> ")}`]),
  ]
}
