// Checks an extension's migration SQL stays inside its own schemas (ADR-0136).

type Scope = {
  /** Schemas the extension owns. */
  readonly owned: ReadonlySet<string>
  /** Every schema registered in db/ownership.toml, whoever owns it. */
  readonly registered: ReadonlySet<string>
}

const allowedVerbs = new Set(["CREATE", "ALTER", "DROP", "COMMENT", "INSERT", "UPDATE", "DELETE"])
const alwaysForeign = new Set(["public", "pg_catalog", "information_schema", "system"])

const name = String.raw`(?:"([^"]+)"|([a-z_][a-z0-9_]*))\s*\.\s*(?:"[^"]+"|[a-z_][a-z0-9_]*)`

const objectKinds = "TABLE|TYPE|VIEW|SEQUENCE|DOMAIN|FUNCTION"

const forbidden =
  /\bCREATE\s+EXTENSION\b|\b(?:CREATE|ALTER|DROP)\s+(?:ROLE|USER|DATABASE|PUBLICATION|SUBSCRIPTION|EVENT\s+TRIGGER)\b/i

const targets = [
  new RegExp(
    String.raw`^(?:CREATE|ALTER|DROP)\s+(?:UNIQUE\s+)?(?:MATERIALIZED\s+)?(?:${objectKinds})\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?(${name})?`,
    "i",
  ),
  new RegExp(String.raw`^CREATE\s+(?:UNIQUE\s+)?INDEX\b.*?\bON\s+(?:ONLY\s+)?(${name})?`, "i"),
  new RegExp(String.raw`^CREATE\s+(?:CONSTRAINT\s+)?TRIGGER\b.*?\bON\s+(${name})?`, "i"),
  new RegExp(String.raw`^(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(${name})?`, "i"),
] as const

/** Statements of a migration file, comments and string literals removed. */
const statementsOf = (sql: string) =>
  sql
    .split("--> statement-breakpoint")
    .flatMap((chunk) => chunk.split(/;\s*(?:\n|$)/))
    .map((statement) =>
      statement
        .replaceAll(/^\s*--.*$/gm, "")
        .replaceAll(/'(?:[^']|'')*'/g, "''")
        .replaceAll(/\s+/g, " ")
        .trim(),
    )
    .filter((statement) => statement !== "")

const schemaOf = (match: RegExpMatchArray | null) => match?.[2] ?? match?.[3]

const referencedSchemas = (statement: string) =>
  [...statement.matchAll(new RegExp(name, "gi"))].map((match) => match[1] ?? match[2]!)

const schemaStatement =
  /^(?:CREATE|ALTER|DROP)\s+SCHEMA\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?/i

const ownSchemaFailures = (statement: string, scope: Scope) => {
  const schema = schemaStatement.exec(statement)?.[1]

  return schema === undefined || scope.owned.has(schema)
    ? []
    : [`schema ${schema} is not owned by this extension`]
}

const targetFailures = (statement: string, verb: string, scope: Scope) =>
  targets.flatMap((target) => {
    const match = target.exec(statement)

    return match === null || scope.owned.has(schemaOf(match) ?? "")
      ? []
      : [`${verb} target must be qualified with a schema this extension owns`]
  })

const foreignFailures = (statement: string, scope: Scope) =>
  referencedSchemas(statement).flatMap((schema) =>
    (scope.registered.has(schema) || alwaysForeign.has(schema)) && !scope.owned.has(schema)
      ? [`references ${schema}, outside this extension's schemas (no foreign key into core)`]
      : [],
  )

const statementFailures = (statement: string, scope: Scope) => {
  const verb = statement.split(" ")[0]!.toUpperCase()

  if (!allowedVerbs.has(verb)) return [`statement kind ${verb} is not allowed in an extension`]

  if (forbidden.test(statement)) {
    return ["extensions may not create extensions, roles, or databases"]
  }

  return [
    ...ownSchemaFailures(statement, scope),
    ...targetFailures(statement, verb, scope),
    ...foreignFailures(statement, scope),
  ]
}

const tenantFailures = (statement: string, scope: Scope) => {
  const created = new RegExp(
    String.raw`^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${name}\s*\((.*)\)\s*$`,
    "i",
  ).exec(statement)

  if (created === null || !scope.owned.has(created[1] ?? created[2]!)) return []

  return /"?tenant_id"?\s/.test(created[3]!) ? [] : ["every table carries a tenant_id column"]
}

/** What an extension migration does that it may not (ADR-0136 decisions 4 to 6). */
export const extensionMigrationFailures = (path: string, sql: string, scope: Scope) =>
  statementsOf(sql).flatMap((statement) =>
    [...statementFailures(statement, scope), ...tenantFailures(statement, scope)].map(
      (failure) => `${path}: ${failure}: ${statement.slice(0, 80)}`,
    ),
  )

/** Core migrations never name a schema an extension owns. */
export const coreMigrationFailures = (
  path: string,
  sql: string,
  extensionSchemas: ReadonlySet<string>,
) =>
  statementsOf(sql).flatMap((statement) =>
    referencedSchemas(statement)
      .filter((schema) => extensionSchemas.has(schema))
      .map((schema) => `${path}: core migration references extension schema ${schema}`),
  )
