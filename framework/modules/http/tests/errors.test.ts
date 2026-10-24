import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { ReplicaConsistencyFailure } from "../../../foundation/mod.ts"
import {
  ApiConflict,
  ApiForbidden,
  ApiNotFound,
  ApiServiceUnavailable,
  BaseApiErrorPolicy,
  apiErrorMapping,
} from "../mod.ts"

class AuthorizationDenied extends Schema.TaggedError<AuthorizationDenied>()(
  "AuthorizationDenied",
  {},
) {}
class OrderNotFound extends Schema.TaggedError<OrderNotFound>()("OrderNotFound", {}) {}
class OrderLocked extends Schema.TaggedError<OrderLocked>()("OrderLocked", {}) {}
class DatabaseFailure extends Schema.TaggedError<DatabaseFailure>()("DatabaseFailure", {}) {}

const { toApiError, apiEffect } = apiErrorMapping({
  ...BaseApiErrorPolicy,
  OrderNotFound: "not_found",
  OrderLocked: "conflict",
})

describe("API error mapping", () => {
  it.effect("maps each policy kind to a stable transport error without detail", () =>
    Effect.gen(function* () {
      assert.instanceOf(toApiError(new AuthorizationDenied()), ApiForbidden)
      const notFound = toApiError(new OrderNotFound())
      assert.instanceOf(notFound, ApiNotFound)
      assert.strictEqual(notFound.code, "OrderNotFound")
      const conflict = toApiError(new OrderLocked())
      assert.instanceOf(conflict, ApiConflict)
      assert.strictEqual(conflict.code, "OrderLocked")
      const invalid = toApiError(yield* Effect.flip(Schema.decodeUnknownEffect(Schema.String)(1)))
      assert.instanceOf(invalid, ApiConflict)
      assert.strictEqual(invalid.code, "invalid_request")
      assert.instanceOf(toApiError(new DatabaseFailure()), ApiServiceUnavailable)
    }),
  )

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
      const error = yield* Effect.flip(apiEffect(Effect.fail(new OrderNotFound())))
      assert.instanceOf(error, ApiNotFound)
    }),
  )
})
