import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  type ExternalActionCatalogEntry,
  type ExternalEventCatalogEntry,
  validateExternalActionDefinition,
} from "./contract.ts"
import { ExternalActionNotAllowlisted, ExternalPayloadInvalid } from "./errors.ts"
import { decodeExternalSchema } from "./schema.ts"

export type ExternalCatalogEntry = ExternalActionCatalogEntry | ExternalEventCatalogEntry

export type SimulateExternalActionInput = {
  readonly tenantId: string
  readonly action: ExternalActionCatalogEntry
  readonly input: unknown
}

export type ExternalSimulationResult = {
  readonly simulated: true
  readonly actionId: string
  readonly version: number
  readonly requiredScope: string
  readonly validatedInput: unknown
  readonly sideEffect: false
}

const Uuid = Schema.String.check(Schema.isUUID())

export const simulateWithoutSideEffect = (
  input: SimulateExternalActionInput,
): Effect.Effect<ExternalSimulationResult, ExternalActionNotAllowlisted | ExternalPayloadInvalid> =>
  Effect.gen(function*() {
    const identifier = typeof input.action?.id === "string" && input.action.id.trim() !== ""
      ? input.action.id.slice(0, 256)
      : "external-action"
    if (!Schema.is(Uuid)(input.tenantId)) {
      return yield* Effect.fail(
        new ExternalPayloadInvalid({
          boundary: "external.simulation.tenant",
          identifier,
        }),
      )
    }
    if (!validateExternalActionDefinition(input.action)) {
      return yield* Effect.fail(
        new ExternalPayloadInvalid({
          boundary: "external.catalog.action.definition",
          identifier,
        }),
      )
    }
    if (!input.action.allowlisted || input.action.stability !== "PUBLIC") {
      return yield* Effect.fail(
        new ExternalActionNotAllowlisted({
          tenantId: input.tenantId,
          actionId: input.action.id,
        }),
      )
    }
    const validatedInput = yield* decodeExternalSchema(input.action.inputSchema, input.input).pipe(
      Effect.mapError(() =>
        new ExternalPayloadInvalid({
          boundary: "external.simulation.input",
          identifier,
        })
      ),
    )
    return {
      simulated: true,
      actionId: input.action.id,
      version: input.action.version,
      requiredScope: input.action.requiredScope,
      validatedInput,
      sideEffect: false,
    }
  })
