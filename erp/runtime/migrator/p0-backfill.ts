import "../../../tooling/load-env.ts"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Predicate from "effect/Predicate"
import * as Exit from "effect/Exit"
import { createReadStream } from "node:fs"
import postgres, { type Sql } from "postgres"

import { isMain } from "../../../tooling/entrypoint.ts"

const Uuid = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
)

const NonBlankString = Schema.String.check(Schema.isPattern(/\S/))

const WarehouseScope = Schema.Struct({
  tenantId: Uuid,
  warehouseId: Uuid,
  legalEntityId: Uuid,
  primaryBranchId: Schema.optionalKey(Schema.NullOr(Uuid)),
})

const StockTransferScope = Schema.Struct({
  tenantId: Uuid,
  transferId: Uuid,
  legalEntityId: Uuid,
})

const IdentifierScope = Schema.Struct({
  tenantId: Uuid,
  identifierId: Uuid,
  provider: NonBlankString,
  legalEntityId: Schema.optionalKey(Schema.NullOr(Uuid)),
})

const MAX_MAPPING_ROWS = 100_000
export const MAX_P0_BACKFILL_BYTES = 64 * 1024 * 1024

export const P0BackfillInput = Schema.Struct({
  warehouseScopes: Schema.Array(WarehouseScope).check(Schema.isMaxLength(MAX_MAPPING_ROWS)),
  stockTransferScopes: Schema.Array(StockTransferScope).check(Schema.isMaxLength(MAX_MAPPING_ROWS)),
  identifierScopes: Schema.Array(IdentifierScope).check(Schema.isMaxLength(MAX_MAPPING_ROWS)),
})

type P0Backfill = Schema.Schema.Type<typeof P0BackfillInput>

type Row = { readonly tenant_id: string; readonly id: string }

export class P0BackfillFailure extends Error {
  readonly _tag = "P0BackfillFailure"

  constructor(readonly detail: string) {
    super(detail)
  }
}

const key = (tenantId: string, id: string) => `${tenantId}:${id}`

const duplicateKeys = (values: readonly { tenantId: string; id: string }[]) => {
  const seen = new Set<string>()
  const duplicates = new Set<string>()

  for (const value of values) {
    const valueKey = key(value.tenantId, value.id)

    if (seen.has(valueKey)) duplicates.add(valueKey)
    else seen.add(valueKey)
  }

  return [...duplicates]
}

const assertExactCoverage = (
  resource: string,
  actualRows: readonly Row[],
  mappings: readonly { tenantId: string; id: string }[],
) => {
  const actual = new Set(actualRows.map((row) => key(String(row.tenant_id), String(row.id))))
  const provided = new Set(mappings.map((row) => key(row.tenantId, row.id)))
  const missing = [...actual].filter((value) => !provided.has(value))
  const unknown = [...provided].filter((value) => !actual.has(value))
  const duplicates = duplicateKeys(mappings)

  if (missing.length > 0 || unknown.length > 0 || duplicates.length > 0) {
    throw new P0BackfillFailure(
      `${resource} mapping must cover each row exactly once; missing=${missing.join(",")}; ` +
        `unknown=${unknown.join(",")}; duplicates=${duplicates.join(",")}`,
    )
  }
}

const normalize = (input: P0Backfill): P0Backfill => ({
  warehouseScopes: input.warehouseScopes.map((row) => ({
    ...row,
    primaryBranchId: row.primaryBranchId ?? null,
  })),
  stockTransferScopes: input.stockTransferScopes,
  identifierScopes: input.identifierScopes.map((row) => ({
    ...row,
    provider: row.provider.trim().toUpperCase(),
    legalEntityId: row.legalEntityId ?? null,
  })),
})

const failureMessage = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

/** Decodes a mapping file as parsed JSON; nothing about its shape is assumed. */
export const decodeP0BackfillInput = (input: Schema.Json, context = "input") =>
  Schema.decodeUnknownEffect(P0BackfillInput)(input).pipe(
    Effect.map(normalize),
    Effect.mapError(
      (cause) =>
        new P0BackfillFailure(`${context}: invalid P0 backfill mapping: ${failureMessage(cause)}`),
    ),
  )

export const decodeP0BackfillJson = (text: string, path: string) => {
  if (new TextEncoder().encode(text).byteLength > MAX_P0_BACKFILL_BYTES) {
    return Effect.fail(
      new P0BackfillFailure(`${path}: mapping file exceeds ${MAX_P0_BACKFILL_BYTES} bytes`),
    )
  }

  return Effect.try({
    try: () => JSON.parse(text),
    catch: (cause) => new P0BackfillFailure(`${path}: malformed JSON: ${failureMessage(cause)}`),
  }).pipe(Effect.flatMap((input) => decodeP0BackfillInput(input, path)))
}

export const applyP0Backfill = (client: Sql, input: Schema.Json) =>
  Effect.gen(function* () {
    const decoded = yield* decodeP0BackfillInput(input)
    yield* Effect.tryPromise({
      try: () =>
        client.begin(async (tx) => {
          const warehouses = await tx.unsafe<Row[]>(
            `select tenant_id, id from inventory.warehouses order by tenant_id, id`,
          )

          const transfers = await tx.unsafe<Row[]>(
            `select tenant_id, id from inventory.stock_transfers order by tenant_id, id`,
          )

          const identifiers = await tx.unsafe<Row[]>(
            `select tenant_id, id from party.party_identifiers order by tenant_id, id`,
          )

          assertExactCoverage(
            "warehouse",
            warehouses,
            decoded.warehouseScopes.map((row) => ({
              tenantId: row.tenantId,
              id: row.warehouseId,
            })),
          )
          assertExactCoverage(
            "stock transfer",
            transfers,
            decoded.stockTransferScopes.map((row) => ({
              tenantId: row.tenantId,
              id: row.transferId,
            })),
          )
          assertExactCoverage(
            "identifier",
            identifiers,
            decoded.identifierScopes.map((row) => ({
              tenantId: row.tenantId,
              id: row.identifierId,
            })),
          )

          for (const row of decoded.warehouseScopes) {
            await tx.unsafe(
              `update inventory.warehouses
               set legal_entity_id = $1, primary_branch_id = $2, updated_at = now()
               where tenant_id = $3 and id = $4`,
              [row.legalEntityId, row.primaryBranchId ?? null, row.tenantId, row.warehouseId],
            )
          }

          for (const row of decoded.stockTransferScopes) {
            await tx.unsafe(
              `update inventory.stock_transfers
               set legal_entity_id = $1, updated_at = now()
               where tenant_id = $2 and id = $3`,
              [row.legalEntityId, row.tenantId, row.transferId],
            )
          }

          for (const row of decoded.identifierScopes) {
            await tx.unsafe(
              `update party.party_identifiers
               set provider = $1, legal_entity_id = $2, updated_at = now()
               where tenant_id = $3 and id = $4`,
              [row.provider, row.legalEntityId ?? null, row.tenantId, row.identifierId],
            )
          }
        }),
      catch: (cause) =>
        cause instanceof P0BackfillFailure ? cause : new P0BackfillFailure(failureMessage(cause)),
    })
  })

const readBoundedTextFile = (path: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const decoder = new TextDecoder("utf-8", { fatal: true })
    const stream = createReadStream(path, { highWaterMark: 64 * 1024 })
    let total = 0
    let text = ""

    const decode = (chunk: Buffer | undefined, streaming: boolean) => {
      try {
        return decoder.decode(chunk, { stream: streaming })
      } catch {
        return undefined
      }
    }

    stream.on("error", (cause) =>
      reject(
        cause instanceof P0BackfillFailure
          ? cause
          : new P0BackfillFailure(`${path}: unable to read mapping file: ${failureMessage(cause)}`),
      ),
    )
    stream.on("data", (data: Buffer | string) => {
      if (Predicate.isString(data)) {
        stream.destroy()
        reject(new P0BackfillFailure(`${path}: mapping file is not valid UTF-8`))

        return
      }

      total += data.byteLength

      if (total > MAX_P0_BACKFILL_BYTES) {
        stream.destroy()
        reject(
          new P0BackfillFailure(`${path}: mapping file exceeds ${MAX_P0_BACKFILL_BYTES} bytes`),
        )

        return
      }

      const decoded = decode(data, true)

      if (decoded === undefined) {
        stream.destroy()
        reject(new P0BackfillFailure(`${path}: mapping file is not valid UTF-8`))

        return
      }

      text += decoded
    })
    stream.on("end", () => {
      const tail = decode(undefined, false)

      if (tail === undefined) {
        reject(new P0BackfillFailure(`${path}: mapping file is not valid UTF-8`))

        return
      }

      resolve(text + tail)
    })
  })

export const readP0BackfillFile = (path: string) =>
  Effect.tryPromise({
    try: () => readBoundedTextFile(path),
    catch: (cause) =>
      cause instanceof P0BackfillFailure
        ? cause
        : new P0BackfillFailure(`${path}: unable to read mapping file: ${failureMessage(cause)}`),
  }).pipe(Effect.flatMap((text) => decodeP0BackfillJson(text, path)))

if (isMain(import.meta.url)) {
  const databaseUrl = process.env["DATABASE_URL"]
  const inputPath = process.argv[2] ?? process.env["P0_BACKFILL_FILE"]

  if (databaseUrl === undefined || databaseUrl.trim() === "") {
    console.error("DATABASE_URL is required; Varlock loads .env.local automatically")
    process.exit(1)
  }

  if (inputPath === undefined || inputPath.trim() === "") {
    console.error("Usage: pnpm p0:backfill -- <mapping.json>")
    process.exit(1)
  }

  const client = postgres(databaseUrl)

  const result = await Effect.runPromiseExit(
    readP0BackfillFile(inputPath).pipe(
      Effect.flatMap((input) => applyP0Backfill(client, input)),
      Effect.ensuring(Effect.promise(() => client.end())),
    ),
  )

  if (Exit.isFailure(result)) {
    console.error(result.cause)
    process.exit(1)
  }

  console.log("P0 backfill completed")
}
