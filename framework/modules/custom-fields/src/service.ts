import { and, asc, eq, sql } from "drizzle-orm"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"

import { customFieldDefinitions, customFieldValues } from "../../../../db/schema/custom-fields.ts"
import { Database, isDatabaseConstraint } from "../../../foundation/mod.ts"
import {
  CustomFieldPoints,
  CustomFieldService,
  type CustomFieldDefinition,
  type CustomFieldValues,
  DefineFieldInput,
  DocumentValuesInput,
  ListFieldsInput,
  SetValuesInput,
} from "./contract.ts"
import {
  CustomFieldAlreadyDefined,
  CustomFieldDocumentTypeNotReleased,
  CustomFieldNotDefined,
  CustomFieldRequired,
  CustomFieldValueInvalid,
} from "./errors.ts"
import { mismatch } from "./values.ts"

const toDefinition = (row: typeof customFieldDefinitions.$inferSelect): CustomFieldDefinition => ({
  id: row.id,
  tenantId: row.tenantId,
  documentType: row.documentType,
  key: row.key,
  label: row.label,
  kind: row.kind,
  required: row.required,
  choices: row.choices,
  position: row.position,
})

export const makeCustomFieldService = Effect.gen(function* () {
  const database = yield* Database
  const points = yield* CustomFieldPoints

  const definitionsOf = (tenantId: string, documentType: string) =>
    database
      .query(
        (db) =>
          db
            .select()
            .from(customFieldDefinitions)
            .where(
              and(
                eq(customFieldDefinitions.tenantId, tenantId),
                eq(customFieldDefinitions.documentType, documentType),
              ),
            )
            .orderBy(asc(customFieldDefinitions.position), asc(customFieldDefinitions.key)),
        "custom_fields.definition.list",
      )
      .pipe(Effect.map((rows) => rows.map(toDefinition)))

  const valuesOf = (tenantId: string, documentType: string, documentId: string) =>
    database
      .query(
        (db) =>
          db
            .select({ key: customFieldValues.key, value: customFieldValues.value })
            .from(customFieldValues)
            .where(
              and(
                eq(customFieldValues.tenantId, tenantId),
                eq(customFieldValues.documentType, documentType),
                eq(customFieldValues.documentId, documentId),
              ),
            ),
        "custom_fields.value.list",
      )
      .pipe(
        Effect.map((rows): CustomFieldValues => {
          const values: Record<string, string | boolean | null> = {}

          for (const row of rows) {
            if (Predicate.isString(row.value) || Predicate.isBoolean(row.value)) {
              values[row.key] = row.value
            }
          }

          return values
        }),
      )

  const defineField = Effect.fn("CustomFieldService.defineField")(function* (
    input: Schema.Codec.Encoded<typeof DefineFieldInput>,
  ) {
    const decoded = yield* Schema.decodeUnknownEffect(DefineFieldInput)(input)

    if (!points.allows(decoded.documentType)) {
      return yield* Effect.fail(
        new CustomFieldDocumentTypeNotReleased({
          tenantId: decoded.tenantId,
          documentType: decoded.documentType,
        }),
      )
    }

    const choices = decoded.kind === "choice" ? [...new Set(decoded.choices ?? [])] : null

    if (decoded.kind === "choice" && (choices?.length ?? 0) === 0) {
      return yield* Effect.fail(
        new CustomFieldValueInvalid({
          tenantId: decoded.tenantId,
          documentType: decoded.documentType,
          key: decoded.key,
          expected: "at least one choice for a choice field",
        }),
      )
    }

    const rows = yield* database
      .query(
        (db) =>
          db
            .insert(customFieldDefinitions)
            .values({
              tenantId: decoded.tenantId,
              documentType: decoded.documentType,
              key: decoded.key,
              label: decoded.label.trim(),
              kind: decoded.kind,
              required: decoded.required ?? false,
              choices,
              position: sql`coalesce((
                select max(${customFieldDefinitions.position}) + 1
                from ${customFieldDefinitions}
                where ${customFieldDefinitions.tenantId} = ${decoded.tenantId}
                  and ${customFieldDefinitions.documentType} = ${decoded.documentType}
              ), 0)`,
            })
            .returning(),
        "custom_fields.definition.create",
      )
      .pipe(
        Effect.mapError((error) =>
          isDatabaseConstraint(error, "custom_field_definitions_key", "23505")
            ? new CustomFieldAlreadyDefined({
                tenantId: decoded.tenantId,
                documentType: decoded.documentType,
                key: decoded.key,
              })
            : error,
        ),
      )

    return toDefinition(rows[0]!)
  })

  const listFields = Effect.fn("CustomFieldService.listFields")(function* (
    input: Schema.Codec.Encoded<typeof ListFieldsInput>,
  ) {
    const decoded = yield* Schema.decodeUnknownEffect(ListFieldsInput)(input)

    return yield* definitionsOf(decoded.tenantId, decoded.documentType)
  })

  const getValues = Effect.fn("CustomFieldService.getValues")(function* (
    input: Schema.Codec.Encoded<typeof DocumentValuesInput>,
  ) {
    const decoded = yield* Schema.decodeUnknownEffect(DocumentValuesInput)(input)

    return yield* valuesOf(decoded.tenantId, decoded.documentType, decoded.documentId)
  })

  const setValues = Effect.fn("CustomFieldService.setValues")(function* (
    input: Schema.Codec.Encoded<typeof SetValuesInput>,
  ) {
    const decoded = yield* Schema.decodeUnknownEffect(SetValuesInput)(input)
    const { tenantId, documentType, documentId } = decoded
    const definitions = yield* definitionsOf(tenantId, documentType)
    const byKey = new Map(definitions.map((definition) => [definition.key, definition]))
    const current = yield* valuesOf(tenantId, documentType, documentId)

    for (const [key, value] of Object.entries(decoded.values)) {
      const definition = byKey.get(key)

      if (definition === undefined) {
        return yield* Effect.fail(new CustomFieldNotDefined({ tenantId, documentType, key }))
      }

      const expected = value === null ? undefined : mismatch(definition, value)

      if (expected !== undefined) {
        return yield* Effect.fail(
          new CustomFieldValueInvalid({ tenantId, documentType, key, expected }),
        )
      }
    }

    const merged = { ...current, ...decoded.values }

    // A required field needs a value after the write, so a new required field blocks edits of
    // documents that lack it until it is filled in.
    for (const definition of definitions) {
      if (definition.required && (merged[definition.key] ?? null) === null) {
        return yield* Effect.fail(
          new CustomFieldRequired({ tenantId, documentType, key: definition.key }),
        )
      }
    }

    yield* database.transaction(async (tx) => {
      for (const [key, value] of Object.entries(decoded.values)) {
        if (value === null) {
          await tx
            .delete(customFieldValues)
            .where(
              and(
                eq(customFieldValues.tenantId, tenantId),
                eq(customFieldValues.documentType, documentType),
                eq(customFieldValues.documentId, documentId),
                eq(customFieldValues.key, key),
              ),
            )
        } else {
          await tx
            .insert(customFieldValues)
            .values({ tenantId, documentType, documentId, key, value })
            .onConflictDoUpdate({
              target: [
                customFieldValues.tenantId,
                customFieldValues.documentType,
                customFieldValues.documentId,
                customFieldValues.key,
              ],
              set: { value, updatedAt: new Date() },
            })
        }
      }
    }, "custom_fields.value.set")

    return yield* valuesOf(tenantId, documentType, documentId)
  })

  return { defineField, listFields, getValues, setValues } satisfies CustomFieldService
})

export const CustomFieldsLive = Layer.effect(CustomFieldService, makeCustomFieldService)

/** Points from a fixed list of document types, for the runtime and for tests. */
export const customFieldPointsOf = (documentTypes: Iterable<string>) => {
  const released = new Set(documentTypes)

  return Layer.succeed(CustomFieldPoints, { allows: (type) => released.has(type) })
}
