import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as HttpApi from "effect/http-api/HttpApi"
import type * as HttpApiGroup from "effect/http-api/HttpApiGroup"
import * as HttpApiMiddleware from "effect/http-api/HttpApiMiddleware"
import * as HttpApiSecurity from "effect/http-api/HttpApiSecurity"
import * as Schema from "effect/Schema"

import { ConsistencyToken, ReplicaConsistencyFailure } from "../../../foundation/mod.ts"
import type { Principal } from "../../auth/mod.ts"

export class CurrentPrincipal extends Context.Service<CurrentPrincipal, Principal>()(
  "RITSEI/Http/CurrentPrincipal",
) {}

export class ApiUnauthorized extends Schema.TaggedError<ApiUnauthorized>()(
  "ApiUnauthorized",
  { code: Schema.Literal("unauthorized") },
  { httpApiStatus: 401 },
) {}
export class ApiForbidden extends Schema.TaggedError<ApiForbidden>()(
  "ApiForbidden",
  { code: Schema.Literal("forbidden") },
  { httpApiStatus: 403 },
) {}
export class ApiNotFound extends Schema.TaggedError<ApiNotFound>()(
  "ApiNotFound",
  { code: Schema.String },
  { httpApiStatus: 404 },
) {}
export class ApiConflict extends Schema.TaggedError<ApiConflict>()(
  "ApiConflict",
  { code: Schema.String },
  { httpApiStatus: 409 },
) {}
export class ApiServiceUnavailable extends Schema.TaggedError<ApiServiceUnavailable>()(
  "ApiServiceUnavailable",
  { code: Schema.Literal("service_unavailable") },
  { httpApiStatus: 503 },
) {}

export class BearerAuth extends HttpApiMiddleware.Service<
  BearerAuth,
  {
    provides: CurrentPrincipal
  }
>()("RITSEI/Http/BearerAuth", {
  error: [ApiUnauthorized, ApiServiceUnavailable],
  security: { bearer: HttpApiSecurity.bearer },
}) {}

/** The stable transport failures every protected endpoint may return. */
export const ApiErrors = [
  ApiUnauthorized,
  ApiForbidden,
  ApiNotFound,
  ApiConflict,
  ApiServiceUnavailable,
] as const

export const MaxApiTextLength = 4_096
export const MaxApiIdentifierLength = 256
export const MaxApiCollectionItems = 1_000
export const Uuid = Schema.String.check(Schema.isUUID())
export const NonEmptyString = Schema.String.check(
  Schema.isPattern(/\S/),
  Schema.isMaxLength(MaxApiTextLength),
)
export const ShortString = Schema.String.check(
  Schema.isPattern(/\S/),
  Schema.isMaxLength(MaxApiIdentifierLength),
)
export const Email = Schema.String.check(
  Schema.isPattern(/^[^\s@]+@[^\s@]+$/),
  Schema.isMaxLength(320),
)
export const CurrencyCode = Schema.String.check(Schema.isPattern(/^[A-Za-z]{3}$/))
export const PositiveInt = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: 2_147_483_647 }),
)
export const BoundedArray = <S extends Schema.Constraint>(schema: S) =>
  Schema.Array(schema).check(Schema.isMaxLength(MaxApiCollectionItems))
/** An optional `limit` query parameter between 1 and 200. */
export const ReadLimit = Schema.optionalKey(
  Schema.NumberFromString.pipe(
    Schema.check(Schema.isInt()),
    Schema.check(Schema.isBetween({ minimum: 1, maximum: 200 })),
  ),
)
export const TenantHeaders = { "x-tenant-id": Uuid }
export const ConsistencyHeaders = {
  ...TenantHeaders,
  "x-ritsei-consistency-token": Schema.optionalKey(ConsistencyToken),
}

/** The composed API's identifier; module groups are built against an API with the same id. */
export const RitseiApiId = "RITSEI"

/** A one-group API a module builds its handlers against; the composed API adds the same group. */
export const makeModuleApi = <const Group extends HttpApiGroup.Constraint>(group: Group) =>
  HttpApi.make(RitseiApiId).add(group)

export type ApiErrorKind =
  | "forbidden"
  | "not_found"
  | "conflict"
  | "invalid_request"
  | "service_unavailable"

/** Transport policy for framework-level failures that any module operation can raise. */
export const BaseApiErrorPolicy = {
  AuthorizationDenied: "forbidden",
  DatabaseFailure: "service_unavailable",
  EventIdempotencyConflict: "conflict",
  ReplicaConsistencyFailure: "service_unavailable",
  SchemaError: "invalid_request",
} as const satisfies Record<string, ApiErrorKind>

export type ApiFailure<Policy extends Record<string, ApiErrorKind>> =
  | ReplicaConsistencyFailure
  | { readonly _tag: Exclude<keyof Policy & string, "ReplicaConsistencyFailure"> }

/**
 * Builds a closed transport mapping for a module's routes: every failure tag must be listed, and
 * none exposes database or provider detail.
 */
const transportErrors = {
  forbidden: () => new ApiForbidden({ code: "forbidden" }),
  not_found: (tag: string) => new ApiNotFound({ code: tag }),
  invalid_request: () => new ApiConflict({ code: "invalid_request" }),
  service_unavailable: () => new ApiServiceUnavailable({ code: "service_unavailable" }),
  conflict: (tag: string) => new ApiConflict({ code: tag }),
} satisfies Record<ApiErrorKind, (tag: string) => unknown>

// A bad or mismatched token is the caller's to fix; any other replica failure is availability.
const invalidConsistencyTokenReasons = new Set<ReplicaConsistencyFailure["reason"]>([
  "invalid_token",
  "expired_token",
  "tenant_mismatch",
  "placement_mismatch",
])

export const makeApiErrorMapping = <const Policy extends Record<string, ApiErrorKind>>(
  policy: Policy,
) => {
  const toApiError = (error: ApiFailure<Policy>) => {
    if (!(error instanceof ReplicaConsistencyFailure)) {
      return transportErrors[policy[error._tag] as ApiErrorKind](error._tag)
    }
    return invalidConsistencyTokenReasons.has(error.reason)
      ? new ApiConflict({ code: "invalid_consistency_token" })
      : new ApiServiceUnavailable({ code: "service_unavailable" })
  }
  const apiEffect = <A, E extends ApiFailure<Policy>, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(Effect.mapError(toApiError))
  return { toApiError, apiEffect }
}
