// Edits to hand-written composition files for a generated entity module (ADR-0094). Each edit finds
// its insertion point with the TypeScript AST and applies it with magic-string at that exact offset,
// leaving every other byte unchanged; oxfmt then normalizes the inserted lines.
import MagicString from "magic-string"
import ts from "typescript"

import type { EntityNames } from "./entity-templates.ts"

const parse = (path: string, source: string) =>
  ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)

const unwrap = (node: ts.Expression): ts.Expression =>
  ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)
    ? unwrap(node.expression)
    : node

const variable = (file: ts.SourceFile, name: string) => {
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue
    const declaration = statement.declarationList.declarations.find(
      (candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === name,
    )
    if (declaration?.initializer !== undefined)
      return { statement, initializer: declaration.initializer }
  }
  throw new Error(`${file.fileName} has no top-level const ${name}`)
}

/** The array literal a const holds directly, or passes as the first argument of a call. */
const arrayOf = (file: ts.SourceFile, name: string) => {
  const initializer = unwrap(variable(file, name).initializer)
  const array = ts.isCallExpression(initializer) ? initializer.arguments[0] : initializer
  if (array === undefined || !ts.isArrayLiteralExpression(array)) {
    throw new Error(`${file.fileName}: ${name} is not an array literal`)
  }
  return array
}

/** Appends items after the last element of an array or argument list. */
const appendItems = (
  edit: MagicString,
  elements: ts.NodeArray<ts.Node>,
  fallback: number,
  items: readonly string[],
) => {
  const last = elements.at(-1)
  const text = items.map((item) => `\n${item}`).join(",")
  edit.appendLeft(last?.end ?? fallback, last === undefined ? text : `,${text}`)
}

const appendToArrays = (
  path: string,
  source: string,
  entries: ReadonlyArray<readonly [name: string, items: readonly string[]]>,
) => {
  const file = parse(path, source)
  const edit = new MagicString(source)
  for (const [name, items] of entries) {
    const array = arrayOf(file, name)
    appendItems(edit, array.elements, array.elements.pos, items)
  }
  return edit.toString()
}

/** Registers the module's capabilities in the closed authorization catalog. */
export const addCapabilities = (path: string, source: string, n: EntityNames) => {
  const ids = ["read", "create"].map((verb) => `${n.module}.${n.entity}.${verb}`)
  return appendToArrays(path, source, [
    ["CapabilityIds", ids.map((id) => JSON.stringify(id))],
    ["CapabilityOwner", [JSON.stringify(n.module)]],
    [
      "CapabilityDefinitions",
      ids.map((id) => {
        const verb = id.slice(id.lastIndexOf(".") + 1)
        return `definition(${JSON.stringify(id)}, "${n.module}", "${n.entity}", "${verb}")`
      }),
    ],
  ])
}

/** Adds the module's PostgreSQL schema to Drizzle Kit's schema filter. */
export const addSchemaFilter = (path: string, source: string, n: EntityNames) => {
  const file = parse(path, source)
  let array: ts.ArrayLiteralExpression | undefined
  const visit = (node: ts.Node) => {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "schemaFilter" &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      array = node.initializer
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  if (array === undefined) throw new Error(`${path} has no schemaFilter array`)
  const edit = new MagicString(source)
  appendItems(edit, array.elements, array.elements.pos, [JSON.stringify(n.module)])
  return edit.toString()
}

/** Exports the module's tables from the Drizzle Kit entry point, in file order. */
export const addSchemaExports = (path: string, source: string, n: EntityNames) => {
  const file = parse(path, source)
  const target = `./${n.module}.ts`
  const exports = file.statements.filter(ts.isExportDeclaration)
  const next = exports.find(
    (statement) =>
      statement.moduleSpecifier !== undefined &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text > target,
  )
  const line = `export { ${n.moduleCamel}Schema, ${n.tableCamel} } from "${target}"\n`
  const edit = new MagicString(source)
  if (next === undefined) edit.append(line)
  else edit.prependLeft(next.getStart(file), line)
  return edit.toString()
}

/** Composes the module's service layer into the runtime's ApplicationLive. */
export const addServiceLayer = (path: string, source: string, n: EntityNames) => {
  const file = parse(path, source)
  const edit = new MagicString(source)
  const imports = file.statements.filter(ts.isImportDeclaration)
  edit.appendLeft(
    imports.at(-1)!.end,
    `\nimport { ${n.Module}Live } from "../modules/${n.module}/mod.ts"`,
  )
  const serviceLayers = variable(file, "serviceLayers").initializer
  if (!ts.isArrowFunction(serviceLayers) || !ts.isBlock(serviceLayers.body)) {
    throw new Error(`${path}: serviceLayers is not a function with a body`)
  }
  const application = serviceLayers.body.statements.find(
    (statement): statement is ts.VariableStatement =>
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some(
        (declaration) =>
          ts.isIdentifier(declaration.name) && declaration.name.text === "ApplicationLive",
      ),
  )
  const call = application?.declarationList.declarations[0]?.initializer
  if (application === undefined || call === undefined || !ts.isCallExpression(call)) {
    throw new Error(`${path}: ApplicationLive is not a Layer.mergeAll call`)
  }
  edit.prependLeft(
    application.getStart(file),
    `const ${n.Module}ServiceLive = ${n.Module}Live.pipe(Layer.provide(BusinessRequirements))\n\n  `,
  )
  appendItems(edit, call.arguments, call.arguments.pos, [`${n.Module}ServiceLive`])
  return edit.toString()
}

/** Assigns the module as owner of its PostgreSQL schema. */
export const addOwnership = (source: string, n: EntityNames) => {
  const lines = source.split("\n")
  const section = lines.indexOf("[schemas]")
  if (section === -1) throw new Error("db/ownership.toml has no [schemas] section")
  let last = section
  while (last + 1 < lines.length && /^[a-z_]+\s*=/.test(lines[last + 1]!)) last += 1
  const offset = lines.slice(0, last + 1).join("\n").length
  const edit = new MagicString(source)
  edit.appendLeft(offset, `\n${n.module} = "erp/modules/${n.module}"`)
  return edit.toString()
}
