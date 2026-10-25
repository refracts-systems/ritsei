import type * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import { Principal } from "../../auth/mod.ts"
import {
  AuthorizationService,
  type CapabilityType,
  scopedCommand,
} from "../../authorization/mod.ts"
import {
  CustomFieldKey,
  CustomFieldKind,
  CustomFieldService,
  CustomFieldValues,
} from "./contract.ts"

const Uuid = Schema.String.check(Schema.isUUID())
const Scoped = { principal: Principal, tenantId: Uuid }
const Label = Schema.String.check(Schema.isPattern(/\S/), Schema.isMaxLength(80))

export const OwnerDefineFieldInput = Schema.Struct({
  ...Scoped,
  key: CustomFieldKey,
  label: Label,
  kind: CustomFieldKind,
  required: Schema.optionalKey(Schema.Boolean),
  choices: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMinLength(1))),
})

export const OwnerListFieldsInput = Schema.Struct(Scoped)

export const OwnerDocumentInput = Schema.Struct({ ...Scoped, documentId: Uuid })

export const OwnerSetValuesInput = Schema.Struct({
  ...Scoped,
  documentId: Uuid,
  values: CustomFieldValues,
})

export interface OwnerCustomFieldsOptions<E> {
  /** The document type the owner released, for example `sales.customer`. */
  readonly documentType: string
  /** Gates changing the definitions (deny by default). */
  readonly configure: CapabilityType
  /** Gates reading definitions and values: the owner's own read capability. */
  readonly read: CapabilityType
  /** Gates writing values: the owner's own write capability. */
  readonly write: CapabilityType
  /** Fails with the owner's not-found error when the document does not exist. */
  readonly exists: (tenantId: string, documentId: string) => Effect.Effect<unknown, E>
}

export type OwnerCustomFields<E> = Effect.Success<ReturnType<typeof makeOwnerCustomFields<E>>>

/**
 * The layer of one released document type's custom field operations, built from the owner's options.
 * The owner's service tag carries the operations; the options effect brings the owner's own
 * requirements, such as its database, to the composition root.
 */
export const ownerCustomFieldsLayer = <E, R>(
  tag: Context.Service<OwnerCustomFields<E>, OwnerCustomFields<E>>,
  options: Effect.Effect<OwnerCustomFieldsOptions<E>, never, R>,
) => Layer.effect(tag, Effect.flatMap(options, makeOwnerCustomFields<E>))

/**
 * The custom field operations of one released document type: the owner's authorization and
 * existence check wrapped around the framework's definitions and values (ADR-0109).
 */
const makeOwnerCustomFields = <E>(options: OwnerCustomFieldsOptions<E>) =>
  Effect.gen(function* () {
    const authorization = yield* AuthorizationService
    const fields = yield* CustomFieldService
    const authorized = scopedCommand(authorization)
    const documentType = options.documentType

    return {
      defineField: Effect.fn("OwnerCustomFields.defineField")(function* (
        input: Schema.Codec.Encoded<typeof OwnerDefineFieldInput>,
      ) {
        const { principal: _principal, ...decoded } = yield* authorized(
          OwnerDefineFieldInput,
          options.configure,
        )(input)

        return yield* fields.defineField({ ...decoded, documentType })
      }),
      listFields: Effect.fn("OwnerCustomFields.listFields")(function* (
        input: Schema.Codec.Encoded<typeof OwnerListFieldsInput>,
      ) {
        const decoded = yield* authorized(OwnerListFieldsInput, options.read)(input)

        return yield* fields.listFields({ tenantId: decoded.tenantId, documentType })
      }),
      getValues: Effect.fn("OwnerCustomFields.getValues")(function* (
        input: Schema.Codec.Encoded<typeof OwnerDocumentInput>,
      ) {
        const decoded = yield* authorized(OwnerDocumentInput, options.read)(input)
        yield* options.exists(decoded.tenantId, decoded.documentId)

        return yield* fields.getValues({
          tenantId: decoded.tenantId,
          documentType,
          documentId: decoded.documentId,
        })
      }),
      setValues: Effect.fn("OwnerCustomFields.setValues")(function* (
        input: Schema.Codec.Encoded<typeof OwnerSetValuesInput>,
      ) {
        const decoded = yield* authorized(OwnerSetValuesInput, options.write)(input)
        yield* options.exists(decoded.tenantId, decoded.documentId)

        return yield* fields.setValues({
          tenantId: decoded.tenantId,
          documentType,
          documentId: decoded.documentId,
          values: decoded.values,
        })
      }),
    }
  })
