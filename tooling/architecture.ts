import { readdir, stat } from "node:fs/promises"
import ts from "typescript"

import { isMain } from "./entrypoint.ts"
import { collectSourceFiles, type SourceFile } from "./source-files.ts"

const sourceRoots = ["apps", "framework", "erp", "extensions", "tests", "tooling"] as const

// Module packages live in these roots (ADR-0091): framework modules, the flagship ERP, extensions.
const packageRoots = ["framework/modules", "erp/modules", "extensions"] as const
const packagePath = /^((?:framework\/modules|erp\/modules|extensions)\/[^/]+)\/(.+)$/

const normalizePath = (path: string) => path.replaceAll("\\", "/")

export type ModuleImport = {
  readonly specifier: string
  readonly typeOnly: boolean
}

const namedBindingsAreTypeOnly = (bindings: ts.NamedImportBindings | undefined) =>
  bindings !== undefined &&
  ts.isNamedImports(bindings) &&
  bindings.elements.length > 0 &&
  bindings.elements.every((element) => element.isTypeOnly)

const namedExportsAreTypeOnly = (clause: ts.NamedExports | undefined) =>
  clause !== undefined &&
  clause.elements.length > 0 &&
  clause.elements.every((element) => element.isTypeOnly)

export const extractModuleImports = (file: SourceFile): readonly ModuleImport[] => {
  const imports: ModuleImport[] = []
  const source = ts.createSourceFile(file.path, file.source, ts.ScriptTarget.Latest, true)
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      imports.push({
        specifier: node.moduleSpecifier.text,
        typeOnly:
          node.importClause?.isTypeOnly === true ||
          namedBindingsAreTypeOnly(node.importClause?.namedBindings),
      })
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      imports.push({
        specifier: node.moduleSpecifier.text,
        typeOnly:
          node.isTypeOnly ||
          (node.exportClause !== undefined &&
            ts.isNamedExports(node.exportClause) &&
            namedExportsAreTypeOnly(node.exportClause)),
      })
    } else if (ts.isImportTypeNode(node)) {
      if (ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
        imports.push({ specifier: node.argument.literal.text, typeOnly: true })
      }
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      imports.push({ specifier: node.arguments[0].text, typeOnly: false })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return imports
}

export const extractModuleSpecifiers = (file: SourceFile | string): readonly string[] => {
  const imports =
    typeof file === "string"
      ? extractModuleImports({ path: "module.ts", source: file })
      : extractModuleImports(file)
  return [...new Set(imports.map(({ specifier }) => specifier))]
}

export const resolveLocal = (file: string, specifier: string): string | undefined => {
  if (specifier.startsWith("@ritsei/")) {
    const [name, ...path] = specifier.slice("@ritsei/".length).split("/")
    return name === undefined || name === ""
      ? undefined
      : `framework/modules/${name}/${path.length > 0 ? path.join("/") : "mod.ts"}`
  }
  if (specifier.startsWith("@/") || specifier.startsWith("~/")) {
    return `apps/web/src/${specifier.slice(2)}`
  }
  if (!specifier.startsWith(".")) return undefined
  return decodeURIComponent(new URL(specifier, `file:///${normalizePath(file)}`).pathname.slice(1))
}

const packageTarget = (file: string, specifier: string) => {
  const resolved = resolveLocal(file, specifier)
  if (resolved === undefined) return undefined
  const target = normalizePath(resolved).match(packagePath)
  return target === null ? undefined : { name: target[1]!, path: target[2]! }
}

const containingPackage = (path: string) => normalizePath(path).match(packagePath)?.[1]

const isPublicEntry = (path: string) => path === "mod.ts" || path === "mod.tsx"

// A module's HTTP adapter (ADR-0094) is a second entry point reserved for the composition root.
const entryFailure = (path: string, target: { readonly name: string; readonly path: string }) => {
  if (target.path !== "http.ts") return `must use ${target.name}/mod.ts`
  return /^(?:erp\/runtime|tests|tooling)\//.test(path)
    ? undefined
    : `only the composition root may import ${target.name}/http.ts`
}

const importFailure = (path: string, specifier: string, packages: ReadonlySet<string>) => {
  const target = packageTarget(path, specifier)
  if (target === undefined) return undefined
  if (!packages.has(target.name)) return `${path}: import references unknown package ${target.name}`
  if (containingPackage(path) === target.name || isPublicEntry(target.path)) return undefined
  const failure = entryFailure(path, target)
  return failure === undefined
    ? undefined
    : `${path}: cross-package import ${JSON.stringify(specifier)} ${failure}`
}

export const analyzePublicPackageImports = (
  files: readonly SourceFile[],
  packageNames: readonly string[],
): readonly string[] => {
  const packages = new Set(packageNames)
  const failures = files.flatMap((file) => {
    const path = normalizePath(file.path)
    return extractModuleImports(file).flatMap(({ specifier }) => {
      const failure = importFailure(path, specifier, packages)
      return failure === undefined ? [] : [failure]
    })
  })
  return [...new Set(failures)].toSorted()
}

const layerOf = (path: string) =>
  path.startsWith("framework/")
    ? "framework"
    : path.startsWith("erp/")
      ? "erp"
      : path.startsWith("extensions/")
        ? "extensions"
        : undefined

const forbiddenLayers: Readonly<Record<string, readonly string[]>> = {
  framework: ["erp", "extensions"],
  erp: ["extensions"],
}

export const analyzeLayerImports = (files: readonly SourceFile[]): readonly string[] => {
  const failures: string[] = []
  for (const file of files) {
    const path = normalizePath(file.path)
    const forbidden = forbiddenLayers[layerOf(path) ?? ""] ?? []
    for (const { specifier } of extractModuleImports(file)) {
      const target = resolveLocal(path, specifier)
      const targetLayer = target === undefined ? undefined : layerOf(normalizePath(target))
      if (targetLayer !== undefined && forbidden.includes(targetLayer)) {
        failures.push(`${path}: ${layerOf(path)} must not import ${targetLayer}: ${specifier}`)
      }
    }
  }
  return [...new Set(failures)].toSorted()
}

const rendererSpecifier =
  /^(?:@kobalte\/|@pandacss\/|@dnd-kit\/|@vgpu\/|vgpu(?:\/|$)|typegpu(?:\/|$)|three(?:\/|$)|pixi\.js(?:\/|$)|echarts(?:\/|$)|chart\.js(?:\/|$)|styled-system(?:\/|$))/
const uiApplicationPath = /^apps\/web\/src\/(?:features|app|routes|domains)\//
const uiSharedApplicationPath = /^apps\/web\/src\/shared\/(?:api|contracts\/generated)\//
const forbiddenUiBarrelPath = /^apps\/web\/src\/ui\/(?:index|recipes\/index)\.tsx?$/

const isFrontendSource = (path: string) => {
  const normalized = normalizePath(path)
  return (
    normalized.startsWith("apps/web/src/") &&
    !normalized.startsWith("apps/web/src/experiments/solid-effect/") &&
    !/(?:^|\/)(?:__tests__|__fixtures__)\//.test(normalized) &&
    !/\.config\.[cm]?[jt]sx?$/.test(normalized) &&
    !/\.(?:test|spec)\.[jt]sx?$/.test(normalized)
  )
}

const analyzeFrontendSource = (file: SourceFile): readonly string[] => {
  const path = normalizePath(file.path)
  const inUi = path.startsWith("apps/web/src/ui/")
  return extractModuleImports(file).flatMap(({ specifier, typeOnly }) => {
    const target = resolveLocal(path, specifier)
    if (target && forbiddenUiBarrelPath.test(target)) {
      return [`${path}: import a specific RITSEI UI module instead of a UI barrel: ${target}`]
    }
    if (
      !inUi &&
      (rendererSpecifier.test(specifier) ||
        target?.startsWith("apps/web/src/ui/generated/") ||
        target?.startsWith("vendor/"))
    ) {
      return [`${path}: renderer and styling dependencies must stay under apps/web/src/ui`]
    }
    if (
      inUi &&
      target &&
      (uiApplicationPath.test(target) ||
        uiSharedApplicationPath.test(target) ||
        /^(?:framework|erp|extensions)\//.test(target))
    ) {
      return [`${path}: shared UI cannot import application or domain-specific modules: ${target}`]
    }
    if (
      target &&
      /^(?:framework\/modules|erp\/modules|extensions)\/[^/]+\/(?!mod\.tsx?$)/.test(target)
    ) {
      return [`${path}: frontend imports must use the public module entry point: ${target}`]
    }
    if (target && /^(?:framework\/platform|erp\/runtime|db|tooling)\//.test(target)) {
      return [`${path}: frontend cannot import backend implementation: ${target}`]
    }
    if (
      !typeOnly &&
      target &&
      /^(?:framework\/(?:modules|foundation)|erp\/modules|extensions)\//.test(target)
    ) {
      return [`${path}: production frontend cannot runtime import backend ${target}`]
    }
    return []
  })
}

export const analyzeFrontend = (file: SourceFile): readonly string[] =>
  isFrontendSource(file.path) ? analyzeFrontendSource(file) : []

const providerSpecifiers = [
  /^@ai-sdk(?:\/|$)/,
  /^@anthropic-ai(?:\/|$)/,
  /^@google\/generative-ai(?:\/|$)/,
  /^@mistralai(?:\/|$)/,
  /^@cohere-ai(?:\/|$)/,
  /^@langchain(?:\/|$)/,
  /^langchain(?:\/|$)/,
  /^openai(?:\/|$)/,
  /^anthropic(?:\/|$)/,
  /^ollama(?:\/|$)/,
  /^groq-sdk(?:\/|$)/,
  /^effect\/ai(?:\/|$)/,
] as const
const privateSpecifier =
  /(?:^|\/)(?:db\/schema|migrations?|repositories?|repository|tables?|table|postgres)(?:\/|\.|$)/i
const privatePackageSource = /^@ritsei\/[^/]+\/src\//
const databaseSpecifier = /^(?:drizzle-orm|postgres|@effect\/sql-pg)(?:\/|$)/
const directMutationObject = new Set(["db", "database", "tx", "transaction", "store", "repository"])
const directMutationMethod = new Set([
  "insert",
  "update",
  "delete",
  "execute",
  "query",
  "save",
  "write",
  "create",
])

const isProviderImport = (specifier: string) =>
  providerSpecifiers.some((pattern) => pattern.test(specifier))
const isPersistenceBoundary = (path: string) =>
  path === "framework/modules/integrations/src/reliability-store.ts" ||
  path === "framework/modules/integrations/src/governance-store.ts"
const isAiSurface = (path: string) =>
  path.startsWith("framework/modules/integrations/") ||
  /(?:^|\/)(?:ai|agent|agents|recommendation|recommendations)(?:\/|[-_.]|$)/i.test(path)

const isPrivateSpecifier = (specifier: string) =>
  privateSpecifier.test(specifier) ||
  privatePackageSource.test(specifier) ||
  databaseSpecifier.test(specifier)

const hasDirectMutation = (source: string, path: string) => {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)
  let found = false
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      directMutationObject.has(node.expression.expression.text) &&
      directMutationMethod.has(node.expression.name.text)
    )
      found = true
    if (!found) ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}

export const analyzeAiBoundary = (files: readonly SourceFile[]): readonly string[] => {
  const failures: string[] = []
  for (const file of files) {
    const path = normalizePath(file.path)
    const specifiers = extractModuleSpecifiers(file)
    const providerImports = specifiers.filter(isProviderImport)
    const approved = path.startsWith("framework/modules/integrations/")

    if (isPersistenceBoundary(path)) {
      failures.push(
        ...providerImports.map(
          (specifier) =>
            `${path}: persistence adapter cannot import provider SDK ${JSON.stringify(specifier)}`,
        ),
      )
      continue
    }

    const aiSurface = isAiSurface(path) || providerImports.length > 0
    if (!approved && providerImports.length > 0) {
      failures.push(
        ...providerImports.map(
          (specifier) =>
            `${path}: model/provider import ${JSON.stringify(
              specifier,
            )} must stay under framework/modules/integrations/`,
        ),
      )
    }
    if (!aiSurface) continue

    failures.push(
      ...specifiers
        .filter(isPrivateSpecifier)
        .map(
          (specifier) =>
            `${path}: AI/provider code cannot import private persistence ${JSON.stringify(specifier)}`,
        ),
    )
    if (hasDirectMutation(file.source, path)) {
      failures.push(`${path}: AI/provider code cannot issue direct business-fact mutations`)
    }
  }
  return [...new Set(failures)].toSorted()
}

export const checkArchitecture = async (): Promise<readonly string[]> => {
  const files = (
    await Promise.all(sourceRoots.map((root) => collectSourceFiles(root, [".ts", ".tsx"])))
  ).flat()
  const packageNames: string[] = []
  for (const root of packageRoots) {
    const entries = await readdir(root, { withFileTypes: true }).catch((cause: unknown) => {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return []
      throw cause
    })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      try {
        if ((await stat(`${root}/${entry.name}/mod.ts`)).isFile())
          packageNames.push(`${root}/${entry.name}`)
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause
      }
    }
  }

  return [
    ...analyzePublicPackageImports(files, packageNames),
    ...analyzeLayerImports(files),
    ...files.filter(({ path }) => isFrontendSource(path)).flatMap(analyzeFrontend),
    ...analyzeAiBoundary(files),
  ].toSorted()
}

if (isMain(import.meta.url)) {
  const failures = await checkArchitecture()
  if (failures.length > 0) {
    console.error(failures.join("\n"))
    process.exit(1)
  }
  console.log("architecture boundaries valid")
}
