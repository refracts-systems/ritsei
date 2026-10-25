import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import type { DatabaseFailure } from "../../../foundation/mod.ts"
import type {
  CustomFieldAlreadyDefined,
  CustomFieldDocumentTypeNotReleased,
  CustomFieldNotDefined,
  CustomFieldRequired,
  CustomFieldValueInvalid,
} from "./errors.ts"

const Uuid = Schema.String.check(Schema.isUUID())

/** `owner.document`, for example `sales.customer`; the owner released it for custom fields. */
export const CustomFieldDocumentType = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/),
)

export const CustomFieldKey = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_]{0,39}$/))

/** The closed set of kinds (ADR-0109): no formulas, no scripts, no cross-field logic. */
export const CustomFieldKind = Schema.Literals(["text", "number", "date", "boolean", "choice"])

export type CustomFieldKind = Schema.Schema.Type<typeof CustomFieldKind>

const Label = Schema.String.check(Schema.isPattern(/\S/), Schema.isMaxLength(80))

export const CustomFieldDefinition = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  documentType: CustomFieldDocumentType,
  key: CustomFieldKey,
  label: Label,
  kind: CustomFieldKind,
  required: Schema.Boolean,
  choices: Schema.NullOr(Schema.Array(Schema.String)),
  position: Schema.Int,
})

export type CustomFieldDefinition = Schema.Schema.Type<typeof CustomFieldDefinition>

/** A value is text, a boolean, or null to clear it; numbers and dates travel as exact strings. */
export const CustomFieldValue = Schema.NullOr(Schema.Union([Schema.String, Schema.Boolean]))

export type CustomFieldValue = Schema.Schema.Type<typeof CustomFieldValue>

export const CustomFieldValues = Schema.Record(CustomFieldKey, CustomFieldValue)

export type CustomFieldValues = Schema.Schema.Type<typeof CustomFieldValues>

export const DefineFieldInput = Schema.Struct({
  tenantId: Uuid,
  documentType: CustomFieldDocumentType,
  key: CustomFieldKey,
  label: Label,
  kind: CustomFieldKind,
  required: Schema.optionalKey(Schema.Boolean),
  choices: Schema.optionalKey(
    Schema.Array(Schema.String.check(Schema.isPattern(/\S/), Schema.isMaxLength(80))).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(50),
    ),
  ),
})

export const ListFieldsInput = Schema.Struct({
  tenantId: Uuid,
  documentType: CustomFieldDocumentType,
})

export const DocumentValuesInput = Schema.Struct({
  tenantId: Uuid,
  documentType: CustomFieldDocumentType,
  documentId: Uuid,
})

export const SetValuesInput = Schema.Struct({
  tenantId: Uuid,
  documentType: CustomFieldDocumentType,
  documentId: Uuid,
  /** Merged into the document's values; a null value clears that field. */
  values: CustomFieldValues,
})

type CommonFailure = DatabaseFailure | Schema.SchemaError

/**
 * Custom field definitions and values (ADR-0109). It does not authorize: the owner of the document
 * type does, and checks that the document exists, before calling it (see `ownerCustomFields`).
 */
export interface CustomFieldService {
  readonly defineField: (
    input: Schema.Codec.Encoded<typeof DefineFieldInput>,
  ) => Effect.Effect<
    CustomFieldDefinition,
    | CustomFieldAlreadyDefined
    | CustomFieldDocumentTypeNotReleased
    | CustomFieldValueInvalid
    | CommonFailure
  >
  readonly listFields: (
    input: Schema.Codec.Encoded<typeof ListFieldsInput>,
  ) => Effect.Effect<ReadonlyArray<CustomFieldDefinition>, CommonFailure>
  readonly getValues: (
    input: Schema.Codec.Encoded<typeof DocumentValuesInput>,
  ) => Effect.Effect<CustomFieldValues, CommonFailure>
  readonly setValues: (
    input: Schema.Codec.Encoded<typeof SetValuesInput>,
  ) => Effect.Effect<
    CustomFieldValues,
    CustomFieldNotDefined | CustomFieldRequired | CustomFieldValueInvalid | CommonFailure
  >
}

export const CustomFieldService = Context.Service<CustomFieldService>("RITSEI/CustomFieldService")

/** The document types whose owners released custom fields; the runtime builds it from manifests. */
export interface CustomFieldPoints {
  readonly allows: (documentType: string) => boolean
}

export const CustomFieldPoints = Context.Service<CustomFieldPoints>("RITSEI/CustomFieldPoints")
