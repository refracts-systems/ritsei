import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import type { Principal } from "../../../../framework/modules/auth/mod.ts"
import { PartyKind, PartyRole, type PartyService } from "../../party/mod.ts"
import { MaxImportRows, type ImportRowError } from "./contract.ts"
import { parseCsv, sha256Hex } from "./csv.ts"
import { ImportFileInvalid } from "./errors.ts"

/** The only mapping revision so far: fixed headers, named by the code that reads them. */
export const PartyMappingRevision = "party-csv-v1"

const requiredColumns = ["source_id", "kind", "name"] as const
const MaxSourceIdLength = 200

/** What a valid row hands the owner command: the Party's kind and name, and an optional role. */
export const PartyRowFields = Schema.Struct({
  kind: PartyKind,
  name: Schema.String,
  role: Schema.NullOr(PartyRole),
})

export type PartyRowFields = Schema.Schema.Type<typeof PartyRowFields>

export interface StagedRowDraft {
  readonly rowNumber: number
  /** Empty for an invalid row, which is identified by row number in error reports. */
  readonly sourceId: string
  readonly contentHash: string
  /** Empty for an invalid row: unvalidated source values are never stored. */
  readonly fields: PartyRowFields | Readonly<Record<string, never>>
  readonly errors: ReadonlyArray<ImportRowError>
}

const rowError = (
  field: string | null,
  code: ImportRowError["code"],
  message: string,
): ImportRowError => ({ field, code, message })

const isKind = Schema.is(PartyKind)
const isRole = Schema.is(PartyRole)

const readRow = (cells: ReadonlyArray<string>, columns: ReadonlyMap<string, number>) => {
  const cell = (name: string) => {
    const position = columns.get(name)

    return position === undefined ? "" : (cells[position] ?? "").trim()
  }

  const sourceId = cell("source_id")
  const kind = cell("kind").toLowerCase()
  const name = cell("name")
  const role = cell("role").toLowerCase()
  const errors: Array<ImportRowError> = []

  if (sourceId === "") {
    errors.push(rowError("source_id", "source_id_missing", "The stable source id is required."))
  } else if (sourceId.length > MaxSourceIdLength) {
    errors.push(
      rowError(
        "source_id",
        "source_id_too_long",
        `The source id is longer than ${MaxSourceIdLength}.`,
      ),
    )
  }

  if (!isKind(kind)) {
    errors.push(rowError("kind", "kind_invalid", "The kind must be person or organization."))
  }

  if (name === "") errors.push(rowError("name", "name_blank", "The name is required."))

  if (role !== "" && !isRole(role)) {
    errors.push(
      rowError(
        "role",
        "role_invalid",
        "The role must be customer, supplier, employee, or partner.",
      ),
    )
  }

  return { sourceId, kind, name, role, errors }
}

interface ParsedRow extends ReturnType<typeof readRow> {
  readonly cells: ReadonlyArray<string>
  readonly malformed: boolean
}

const draftRow = Effect.fn("Onboarding.draftPartyRow")(function* (
  row: ParsedRow,
  rowNumber: number,
  duplicated: ReadonlySet<string>,
) {
  const errors = row.malformed
    ? [
        rowError(
          null,
          "row_malformed",
          "The row has a different number of columns than the header.",
        ),
      ]
    : [...row.errors]

  if (duplicated.has(row.sourceId)) {
    errors.push(
      rowError(
        "source_id",
        "source_id_duplicate",
        "The source id appears more than once in the file.",
      ),
    )
  }

  const fields: PartyRowFields | undefined =
    errors.length === 0 && isKind(row.kind)
      ? { kind: row.kind, name: row.name, role: isRole(row.role) ? row.role : null }
      : undefined

  return {
    rowNumber,
    sourceId: fields === undefined ? "" : row.sourceId,
    contentHash: yield* sha256Hex(JSON.stringify(fields ?? row.cells)),
    fields: fields ?? {},
    errors,
  } satisfies StagedRowDraft
})

/** The source ids that appear on more than one row. */
const duplicatedSourceIds = (rows: ReadonlyArray<ParsedRow>) => {
  const seen = new Set<string>()
  const duplicated = new Set<string>()

  for (const { sourceId } of rows) {
    if (sourceId !== "") (seen.has(sourceId) ? duplicated : seen).add(sourceId)
  }

  return duplicated
}

/**
 * Reads a party export (mapping revision `party-csv-v1`): the headers `source_id`, `kind`, and
 * `name`, and an optional `role`; other columns are ignored and never stored. File-level damage
 * fails the whole file; a bad record becomes a per-record error on its row.
 */
export const readPartyFile = Effect.fn("Onboarding.readPartyFile")(function* (
  tenantId: string,
  csv: string,
) {
  const invalid = (reason: ImportFileInvalid["reason"], column: string | null = null) =>
    new ImportFileInvalid({ tenantId, reason, column })

  const records = parseCsv(csv)

  if (records === undefined) return yield* Effect.fail(invalid("malformed_csv"))
  const [header, ...rows] = records

  if (header === undefined || rows.length === 0) return yield* Effect.fail(invalid("empty"))

  if (rows.length > MaxImportRows) return yield* Effect.fail(invalid("too_many_rows"))

  const columns = new Map(header.map((name, position) => [name.trim().toLowerCase(), position]))
  const missing = requiredColumns.find((name) => !columns.has(name))

  if (missing !== undefined) return yield* Effect.fail(invalid("missing_column", missing))

  const parsed: ReadonlyArray<ParsedRow> = rows.map((cells) => ({
    cells,
    ...readRow(cells, columns),
    malformed: cells.length !== header.length,
  }))

  const duplicated = duplicatedSourceIds(parsed)

  return yield* Effect.forEach(parsed, (row, position) => draftRow(row, position + 1, duplicated))
})

/** Creates the Party through its owner commands: `create`, then `assignRole` when a role is mapped. */
export const applyPartyRow = Effect.fn("Onboarding.applyPartyRow")(function* (
  party: PartyService,
  principal: Schema.Codec.Encoded<typeof Principal>,
  tenantId: string,
  fields: PartyRowFields,
) {
  const created = yield* party.create({ principal, tenantId, kind: fields.kind, name: fields.name })

  if (fields.role !== null) {
    yield* party.assignRole({ principal, tenantId, partyId: created.id, role: fields.role })
  }

  return created.id
})
