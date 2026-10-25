import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import type { DatabaseFailure } from "../../../../framework/foundation/mod.ts"
import { Principal } from "../../../../framework/modules/auth/mod.ts"
import type { AuthorizationDenied } from "../../../../framework/modules/authorization/mod.ts"
import type { AccountingLegalEntityNotFound, ChartTemplateNotFound } from "../../accounting/mod.ts"

const Uuid = Schema.String.check(Schema.isUUID())

export const SetupInput = Schema.Struct({
  principal: Principal,
  tenantId: Uuid,
  legalEntityId: Uuid,
})

export const SetupResult = Schema.Struct({
  /** The chart template applied and how many of its accounts the tenant now has. */
  chart: Schema.Struct({ template: Schema.String, accounts: Schema.Int }),
  /** The PPN tax codes, and whether this run created each one. */
  taxCodes: Schema.Array(Schema.Struct({ code: Schema.String, created: Schema.Boolean })),
})

export type SetupResult = Schema.Schema.Type<typeof SetupResult>

/**
 * Sets a legal entity up for Indonesian trading (ADR-0111, stage A): the Indonesian chart with its
 * posting rules, and the PPN tax codes. Running it again changes nothing that exists.
 */
export interface LocalizationIdService {
  readonly setup: (
    input: Schema.Codec.Encoded<typeof SetupInput>,
  ) => Effect.Effect<
    SetupResult,
    | AccountingLegalEntityNotFound
    | ChartTemplateNotFound
    | AuthorizationDenied
    | DatabaseFailure
    | Schema.SchemaError
  >
}

export const LocalizationIdService = Context.Service<LocalizationIdService>(
  "RITSEI/LocalizationIdService",
)
