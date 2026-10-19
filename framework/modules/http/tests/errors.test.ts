import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"

import { ReplicaConsistencyFailure } from "../../../foundation/mod.ts"
import {
  ApiConflict,
  ApiForbidden,
  ApiNotFound,
  ApiServiceUnavailable,
  BaseApiErrorPolicy,
  makeApiErrorMapping,
} from "../mod.ts"

const { toApiError, apiEffect } = makeApiErrorMapping({
  ...BaseApiErrorPolicy,
  OrderNotFound: "not_found",
  OrderLocked: "conflict",
})

describe("API error mapping", () => {
  it("maps each policy kind to a stable transport error without detail", () => {
    assert.instanceOf(toApiError({ _tag: "AuthorizationDenied" }), ApiForbidden)
    const notFound = toApiError({ _tag: "OrderNotFound" })
    assert.instanceOf(notFound, ApiNotFound)
    assert.strictEqual(notFound.code, "OrderNotFound")
    const conflict = toApiError({ _tag: "OrderLocked" })
    assert.instanceOf(conflict, ApiConflict)
    assert.strictEqual(conflict.code, "OrderLocked")
    const invalid = toApiError({ _tag: "SchemaError" })
    assert.instanceOf(invalid, ApiConflict)
    assert.strictEqual(invalid.code, "invalid_request")
    assert.instanceOf(toApiError({ _tag: "DatabaseFailure" }), ApiServiceUnavailable)
  })

  it("separates invalid consistency tokens from unavailable replicas", () => {
    for (const reason of [
      "invalid_token",
      "expired_token",
      "tenant_mismatch",
      "placement_mismatch",
    ] as const) {
      const error = toApiError(new ReplicaConsistencyFailure({ reason }))
      assert.instanceOf(error, ApiConflict)
      assert.strictEqual(error.code, "invalid_consistency_token")
    }
    assert.instanceOf(
      toApiError(new ReplicaConsistencyFailure({ reason: "timeout" })),
      ApiServiceUnavailable,
    )
  })

  it.effect("maps failures of an effect", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(apiEffect(Effect.fail({ _tag: "OrderNotFound" as const })))
      assert.instanceOf(error, ApiNotFound)
    }),
  )
})
