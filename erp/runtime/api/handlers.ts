import * as Effect from "effect/Effect"
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder"
import * as Layer from "effect/Layer"
import * as Redacted from "effect/Redacted"

import { DatabaseFailure } from "../../../framework/foundation/mod.ts"
import {
  AuthService,
  ExternalProviderUnavailable,
  InvalidSessionToken,
} from "../../../framework/modules/auth/mod.ts"
import {
  AuthorizationCapabilities,
  AuthorizationService,
  CapabilityDefinitions,
} from "../../../framework/modules/authorization/mod.ts"
import {
  type ApiFailure,
  BaseApiErrorPolicy,
  apiErrorMapping,
} from "../../../framework/modules/http/mod.ts"
import {
  IdentityCapabilities,
  UserAccountNotFound,
  UserAccountService,
} from "../../../framework/modules/identity/mod.ts"
import { ErpHttpHandlers } from "../modules.gen.ts"
import {
  ApiConflict,
  ApiForbidden,
  ApiServiceUnavailable,
  ApiUnauthorized,
  BearerAuth,
  CurrentPrincipal,
  CurrentRuntimeConfiguration,
  RitseiApi,
} from "./api.ts"

// Transport policy for the framework routes composed here; each ERP module maps its own failures
// in its http.ts (ADR-0094).
const coreApiErrorPolicy = {
  ...BaseApiErrorPolicy,
  CapabilityAlreadyGranted: "conflict",
  IdentityAuthorizationDenied: "forbidden",
  TenantMembershipAlreadyExists: "conflict",
  TenantMembershipNotActive: "conflict",
  TenantMembershipNotFound: "not_found",
  TenantMembershipUserAccountNotFound: "not_found",
  UserAccountAlreadyExists: "conflict",
  UserAccountNotFound: "not_found",
} as const

export type CoreApiFailure = ApiFailure<typeof coreApiErrorPolicy>

const coreApiMapping = apiErrorMapping(coreApiErrorPolicy)
export const toCoreApiError = coreApiMapping.toApiError
const coreApiEffect = coreApiMapping.apiEffect

const AuthenticationHandlers = HttpApiBuilder.group(RitseiApi, "Authentication", (handlers) =>
  Effect.gen(function* () {
    const auth = yield* AuthService
    const userAccounts = yield* UserAccountService
    const authorization = yield* AuthorizationService
    const configuration = yield* CurrentRuntimeConfiguration
    return handlers
      .handle("config", () => {
        const authentication = configuration.authentication
        if (authentication?.profile === "oidc") {
          return Effect.succeed({
            profile: "oidc" as const,
            issuerUrl: authentication.issuerUrl,
            clientId: authentication.clientId,
            authorizationEndpoint: authentication.authorizationEndpoint,
            tokenEndpoint: authentication.tokenEndpoint,
            redirectUri: authentication.redirectUri,
            scopes: authentication.scopes,
          })
        }
        if (authentication?.profile === "transitional-local") {
          return Effect.succeed({ profile: "transitional-local" as const, scopes: [] as const })
        }
        return Effect.fail(new ApiServiceUnavailable({ code: "service_unavailable" }))
      })
      .handle("devLogin", () => {
        const authentication = configuration.authentication
        if (authentication?.profile !== "transitional-local") {
          return Effect.fail(new ApiForbidden({ code: "forbidden" }))
        }
        const account =
          authentication.userAccountId === undefined &&
          authentication.userAccountEmail !== undefined
            ? Effect.map(userAccounts.list(), (accounts) =>
                accounts.find((candidate) => candidate.email === authentication.userAccountEmail),
              )
            : Effect.succeed(undefined)
        return Effect.gen(function* () {
          const resolved = yield* account
          const userAccountId = authentication.userAccountId ?? resolved?.id
          if (userAccountId === undefined) {
            return yield* Effect.fail(new ApiForbidden({ code: "forbidden" }))
          }
          return yield* auth.issueSession({ userAccountId, ttlSeconds: 3_600 })
        }).pipe(
          Effect.map(({ token, session }) => ({ token, expiresAt: session.expiresAt })),
          Effect.mapError((error) =>
            error instanceof ApiForbidden
              ? error
              : new ApiServiceUnavailable({ code: "service_unavailable" }),
          ),
        )
      })
      .handle("session", (request) =>
        Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          const userAccount = yield* userAccounts.getById(principal.userAccountId)
          const memberships = yield* authorization.listAccessibleTenants({
            userAccountId: principal.userAccountId,
          })
          const requestedTenantId = request.headers["x-tenant-id"]
          const activeTenant =
            requestedTenantId === undefined
              ? (memberships[0] ?? null)
              : (memberships.find((membership) => membership.tenantId === requestedTenantId) ??
                null)
          if (requestedTenantId !== undefined && activeTenant === null) {
            return yield* Effect.fail(new ApiForbidden({ code: "forbidden" }))
          }
          const grants =
            activeTenant === null
              ? []
              : yield* authorization.listDirectGrants({
                  userAccountId: principal.userAccountId,
                  tenantId: activeTenant.tenantId,
                })
          return {
            user: userAccount,
            memberships,
            activeTenant,
            capabilities: grants.map((grant) => grant.capability),
          }
        }).pipe(
          Effect.mapError((error) =>
            error instanceof UserAccountNotFound
              ? new ApiUnauthorized({ code: "unauthorized" })
              : error instanceof ApiForbidden
                ? error
                : error instanceof DatabaseFailure
                  ? new ApiServiceUnavailable({ code: "service_unavailable" })
                  : new ApiConflict({ code: "invalid_request" }),
          ),
        ),
      )
      .handle("logout", () =>
        Effect.gen(function* () {
          const principal = yield* CurrentPrincipal
          yield* auth
            .revoke(principal.sessionId)
            .pipe(
              Effect.catch((error) =>
                error instanceof InvalidSessionToken
                  ? Effect.succeed(undefined)
                  : Effect.fail(error),
              ),
            )
        }).pipe(
          Effect.mapError((error) =>
            error instanceof DatabaseFailure
              ? new ApiServiceUnavailable({ code: "service_unavailable" })
              : new ApiUnauthorized({ code: "unauthorized" }),
          ),
        ),
      )
  }),
)

export const BearerAuthLive = Layer.effect(
  BearerAuth,
  Effect.gen(function* () {
    const auth = yield* AuthService
    return {
      bearer: (effect, options) =>
        Effect.provideServiceEffect(
          effect,
          CurrentPrincipal,
          auth
            .authenticate(Redacted.value(options.credential))
            .pipe(
              Effect.mapError((error) =>
                error instanceof DatabaseFailure || error instanceof ExternalProviderUnavailable
                  ? new ApiServiceUnavailable({ code: "service_unavailable" })
                  : new ApiUnauthorized({ code: "unauthorized" }),
              ),
            ),
        ),
    }
  }),
)

export const HealthHandlers = HttpApiBuilder.group(RitseiApi, "Health", (handlers) =>
  handlers.handle("health", () => Effect.succeed({ status: "ok" as const })),
)

export const UserAccountHandlers = HttpApiBuilder.group(RitseiApi, "UserAccounts", (handlers) =>
  Effect.gen(function* () {
    const authorization = yield* AuthorizationService
    const userAccounts = yield* UserAccountService
    return handlers
      .handle(
        "create",
        Effect.fn("Http.UserAccounts.create")(function* ({ headers, payload }) {
          const principal = yield* CurrentPrincipal
          return yield* coreApiEffect(
            Effect.gen(function* () {
              const userAccount = yield* userAccounts.createForTenant({
                principal,
                tenantId: headers["x-tenant-id"],
                ...payload,
              })
              yield* authorization.addMember({
                userAccountId: userAccount.id,
                tenantId: headers["x-tenant-id"],
              })
              return userAccount
            }),
          )
        }),
      )
      .handle(
        "list",
        Effect.fn("Http.UserAccounts.list")(function* ({ headers }) {
          const principal = yield* CurrentPrincipal
          return yield* coreApiEffect(
            Effect.gen(function* () {
              yield* authorization.authorize({
                principal,
                tenantId: headers["x-tenant-id"],
                capability: IdentityCapabilities.userAccountRead,
              })
              const members = yield* authorization.listMembers({
                tenantId: headers["x-tenant-id"],
                limit: 200,
              })
              return yield* userAccounts.getByIds(members.map((member) => member.userAccountId))
            }),
          )
        }),
      )
      .handle(
        "get",
        Effect.fn("Http.UserAccounts.get")(function* ({ headers, params }) {
          const principal = yield* CurrentPrincipal
          return yield* coreApiEffect(
            Effect.gen(function* () {
              yield* authorization.authorize({
                principal,
                tenantId: headers["x-tenant-id"],
                capability: IdentityCapabilities.userAccountRead,
              })
              yield* authorization.getMember({
                userAccountId: params.id,
                tenantId: headers["x-tenant-id"],
              })
              return yield* userAccounts.getById(params.id)
            }),
          )
        }),
      )
      .handle(
        "update",
        Effect.fn("Http.UserAccounts.update")(function* ({ headers, params, payload }) {
          const principal = yield* CurrentPrincipal
          return yield* coreApiEffect(
            Effect.gen(function* () {
              yield* authorization.authorize({
                principal,
                tenantId: headers["x-tenant-id"],
                capability: IdentityCapabilities.userAccountUpdate,
              })
              yield* authorization.getMember({
                userAccountId: params.id,
                tenantId: headers["x-tenant-id"],
              })
              return yield* userAccounts.update({ id: params.id, email: payload.email })
            }),
          )
        }),
      )
  }),
)

export const AuthorizationHandlers = HttpApiBuilder.group(RitseiApi, "Authorization", (handlers) =>
  Effect.gen(function* () {
    const authorization = yield* AuthorizationService
    const authorize = (
      principal: typeof CurrentPrincipal.Service,
      tenantId: string,
      capability: string,
    ) => authorization.authorize({ principal, tenantId, capability })
    return handlers
      .handle(
        "addMember",
        Effect.fn("Http.Authorization.addMember")(function* ({ headers, payload }) {
          const principal = yield* CurrentPrincipal
          return yield* coreApiEffect(
            Effect.gen(function* () {
              yield* authorize(
                principal,
                headers["x-tenant-id"],
                AuthorizationCapabilities.tenantMembershipAdd,
              )
              return yield* authorization.addMember({
                userAccountId: payload.userAccountId,
                tenantId: headers["x-tenant-id"],
              })
            }),
          )
        }),
      )
      .handle(
        "listMembers",
        Effect.fn("Http.Authorization.listMembers")(function* ({ headers, query }) {
          const principal = yield* CurrentPrincipal
          return yield* coreApiEffect(
            Effect.gen(function* () {
              yield* authorize(
                principal,
                headers["x-tenant-id"],
                AuthorizationCapabilities.tenantMembershipRead,
              )
              return yield* authorization.listMembers({
                tenantId: headers["x-tenant-id"],
                ...query,
              })
            }),
          )
        }),
      )
      .handle(
        "getMember",
        Effect.fn("Http.Authorization.getMember")(function* ({ headers, params }) {
          const principal = yield* CurrentPrincipal
          return yield* coreApiEffect(
            Effect.gen(function* () {
              yield* authorize(
                principal,
                headers["x-tenant-id"],
                AuthorizationCapabilities.tenantMembershipRead,
              )
              return yield* authorization.getMember({
                userAccountId: params.userAccountId,
                tenantId: headers["x-tenant-id"],
              })
            }),
          )
        }),
      )
      .handle(
        "listDirectGrants",
        Effect.fn("Http.Authorization.listDirectGrants")(function* ({ headers, params }) {
          const principal = yield* CurrentPrincipal
          return yield* coreApiEffect(
            Effect.gen(function* () {
              yield* authorize(
                principal,
                headers["x-tenant-id"],
                AuthorizationCapabilities.tenantMembershipRead,
              )
              yield* authorize(
                principal,
                headers["x-tenant-id"],
                AuthorizationCapabilities.capabilityGrant,
              )
              return yield* authorization.listDirectGrants({
                userAccountId: params.userAccountId,
                tenantId: headers["x-tenant-id"],
              })
            }),
          )
        }),
      )
      .handle(
        "listCapabilityDefinitions",
        Effect.fn("Http.Authorization.listCapabilityDefinitions")(function* ({ headers }) {
          const principal = yield* CurrentPrincipal
          return yield* coreApiEffect(
            Effect.gen(function* () {
              yield* authorize(
                principal,
                headers["x-tenant-id"],
                AuthorizationCapabilities.capabilityGrant,
              )
              return CapabilityDefinitions
            }),
          )
        }),
      )
      .handle(
        "suspendMember",
        Effect.fn("Http.Authorization.suspendMember")(function* ({ headers, params }) {
          const principal = yield* CurrentPrincipal
          return yield* coreApiEffect(
            Effect.gen(function* () {
              yield* authorize(
                principal,
                headers["x-tenant-id"],
                AuthorizationCapabilities.tenantMembershipSuspend,
              )
              return yield* authorization.suspendMember({
                userAccountId: params.userAccountId,
                tenantId: headers["x-tenant-id"],
              })
            }),
          )
        }),
      )
      .handle(
        "activateMember",
        Effect.fn("Http.Authorization.activateMember")(function* ({ headers, params }) {
          const principal = yield* CurrentPrincipal
          return yield* coreApiEffect(
            Effect.gen(function* () {
              yield* authorize(
                principal,
                headers["x-tenant-id"],
                AuthorizationCapabilities.tenantMembershipActivate,
              )
              return yield* authorization.activateMember({
                userAccountId: params.userAccountId,
                tenantId: headers["x-tenant-id"],
              })
            }),
          )
        }),
      )
      .handle(
        "removeMember",
        Effect.fn("Http.Authorization.removeMember")(function* ({ headers, params }) {
          const principal = yield* CurrentPrincipal
          return yield* coreApiEffect(
            Effect.gen(function* () {
              yield* authorize(
                principal,
                headers["x-tenant-id"],
                AuthorizationCapabilities.tenantMembershipRemove,
              )
              return yield* authorization.removeMember({
                userAccountId: params.userAccountId,
                tenantId: headers["x-tenant-id"],
              })
            }),
          )
        }),
      )
      .handle(
        "grant",
        Effect.fn("Http.Authorization.grant")(function* ({ headers, payload }) {
          const principal = yield* CurrentPrincipal
          return yield* coreApiEffect(
            Effect.gen(function* () {
              yield* authorize(
                principal,
                headers["x-tenant-id"],
                AuthorizationCapabilities.capabilityGrant,
              )
              return yield* authorization.grant({
                userAccountId: payload.userAccountId,
                tenantId: headers["x-tenant-id"],
                capability: payload.capability,
              })
            }),
          )
        }),
      )
  }),
)
export const ApiHandlers = Layer.mergeAll(
  AuthenticationHandlers,
  HealthHandlers,
  UserAccountHandlers,
  AuthorizationHandlers,
  ...ErpHttpHandlers,
)
