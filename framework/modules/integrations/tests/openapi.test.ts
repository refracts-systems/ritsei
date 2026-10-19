import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Result from "effect/Result"

import {
  ExternalActionNotAllowlisted,
  ExternalPayloadInvalid,
  validateOpenApiImport,
} from "../mod.ts"

const baseInput = {
  tenantId: "018f3f77-0c5a-7cc0-8b62-6a163d214123",
  connectorId: "payments",
  document: {
    openapi: "3.2.0" as const,
    info: { title: "Payments" },
    paths: { "/payments": { post: { operationId: "createPayment" } } },
  },
  operation: {
    operationId: "createPayment",
    method: "post" as const,
    path: "/payments",
    hasAuthentication: true,
    requiredScope: "payments:create",
    sideEffect: true,
    idempotencyKeyRequired: true,
  },
  version: 1,
  allowlisted: true,
}

it.effect("accepts an allowlisted OpenAPI 3.2.0 ExternalAction operation", () =>
  Effect.gen(function* () {
    const selected = yield* validateOpenApiImport(baseInput)
    assert.strictEqual(selected.kind, "ExternalAction")
    assert.strictEqual(selected.standard, "OpenAPI 3.2.0")
    assert.strictEqual(selected.requiredScope, "payments:create")
    assert.strictEqual(selected.allowlisted, true)
  }),
)

it.effect("rejects an unallowlisted operation and missing side-effect idempotency", () =>
  Effect.gen(function* () {
    const unallowlisted = yield* Effect.flip(
      validateOpenApiImport({
        ...baseInput,
        allowlisted: false,
      }),
    )
    const missingIdempotency = yield* Effect.flip(
      validateOpenApiImport({
        ...baseInput,
        operation: { ...baseInput.operation, idempotencyKeyRequired: false },
      }),
    )
    assert.instanceOf(unallowlisted, ExternalActionNotAllowlisted)
    assert.instanceOf(missingIdempotency, ExternalPayloadInvalid)
  }),
)

it.effect("keeps provider credentials outside the allowlisted operation result", () =>
  Effect.gen(function* () {
    const result = yield* validateOpenApiImport(baseInput)
    assert.isFalse("providerCredentials" in result)
  }),
)

it.effect("rejects an operation that is absent from the imported document", () =>
  Effect.gen(function* () {
    const result = yield* Effect.result(
      validateOpenApiImport({
        ...baseInput,
        operation: { ...baseInput.operation, operationId: "missingPayment" },
      }),
    )
    assert.isTrue(Result.isFailure(result))
  }),
)

it.effect("rejects paths containing whitespace", () =>
  Effect.gen(function* () {
    const result = yield* Effect.result(
      validateOpenApiImport({
        ...baseInput,
        document: {
          ...baseInput.document,
          paths: { "/payments ": { post: { operationId: "createPayment" } } },
        },
        operation: { ...baseInput.operation, path: "/payments " },
      }),
    )
    assert.isTrue(Result.isFailure(result))
  }),
)

it.effect("rejects an oversized document section", () =>
  Effect.gen(function* () {
    const result = yield* Effect.result(
      validateOpenApiImport({
        ...baseInput,
        document: { ...baseInput.document, paths: "x".repeat(512 * 1024 + 1) },
      }),
    )
    assert.isTrue(Result.isFailure(result))
  }),
)
