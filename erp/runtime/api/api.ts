import * as Context from "effect/Context"
import * as HttpApi from "effect/http-api/HttpApi"
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint"
import * as HttpApiGroup from "effect/http-api/HttpApiGroup"
import * as HttpApiSchema from "effect/http-api/HttpApiSchema"
import * as OpenApi from "effect/http-api/OpenApi"
import * as Schema from "effect/Schema"

import {
  Capability,
  CapabilityCatalog,
  DirectCapabilityGrant,
  TenantMembership,
  TenantMembershipStatus,
} from "../../../framework/modules/authorization/mod.ts"
import {
  ApiErrors as errors,
  ApiForbidden,
  ApiServiceUnavailable,
  BearerAuth,
  BoundedArray,
  Email,
  NonEmptyString,
  RitseiApiId,
  ShortString,
  TenantHeaders as tenantHeaders,
  Uuid,
} from "../../../framework/modules/http/mod.ts"
import { UserAccount } from "../../../framework/modules/identity/mod.ts"
import { AccountingHttpGroup } from "../../modules/accounting/http.ts"
import { InventoryHttpGroup } from "../../modules/inventory/http.ts"
import { PartyHttpGroup } from "../../modules/party/http.ts"
import { ProcessHttpGroup } from "../../modules/process/http.ts"
import { ProcurementHttpGroup } from "../../modules/procurement/http.ts"
import { SalesHttpGroup } from "../../modules/sales/http.ts"
import type { RitseiRuntimeConfiguration } from "../config.ts"

export {
  ApiConflict,
  ApiForbidden,
  ApiNotFound,
  ApiServiceUnavailable,
  ApiUnauthorized,
  BearerAuth,
  CurrentPrincipal,
} from "../../../framework/modules/http/mod.ts"

export class CurrentRuntimeConfiguration extends Context.Service<
  CurrentRuntimeConfiguration,
  RitseiRuntimeConfiguration
>()("RITSEI/Http/CurrentRuntimeConfiguration") {}

const BoundedAuthArray = <S extends Schema.Constraint>(schema: S) =>
  Schema.Array(schema).check(Schema.isMaxLength(32))
const authSessionHeaders = { "x-tenant-id": Schema.optionalKey(Uuid) }
const CreatedUserAccount = UserAccount.pipe(HttpApiSchema.status(201))
const CreatedTenantMembership = TenantMembership.pipe(HttpApiSchema.status(201))
export const AuthProfile = Schema.Literals(["transitional-local", "oidc"])
const LocalAuthConfiguration = Schema.Struct({
  profile: Schema.Literal("transitional-local"),
  scopes: BoundedAuthArray(ShortString),
})
const OidcAuthConfiguration = Schema.Struct({
  profile: Schema.Literal("oidc"),
  issuerUrl: NonEmptyString,
  clientId: NonEmptyString,
  authorizationEndpoint: NonEmptyString,
  tokenEndpoint: NonEmptyString,
  redirectUri: NonEmptyString,
  scopes: BoundedAuthArray(ShortString),
})
export const AuthConfiguration = Schema.Union([LocalAuthConfiguration, OidcAuthConfiguration])
const AuthToken = Schema.String.check(Schema.isPattern(/\S/), Schema.isMaxLength(4_096))
export const AuthLoginResult = Schema.Struct({
  token: AuthToken,
  expiresAt: NonEmptyString,
})
export const AuthSession = Schema.Struct({
  user: UserAccount,
  memberships: BoundedArray(TenantMembership),
  activeTenant: Schema.NullOr(TenantMembership),
  capabilities: BoundedArray(Capability),
})

const Authentication = HttpApiGroup.make("Authentication").add(
  HttpApiEndpoint.get("config", "/auth/config", {
    success: AuthConfiguration,
    error: [ApiServiceUnavailable],
  }),
  HttpApiEndpoint.post("devLogin", "/auth/dev/login", {
    success: AuthLoginResult,
    error: [ApiForbidden, ApiServiceUnavailable],
  }),
  HttpApiEndpoint.get("session", "/auth/session", {
    headers: authSessionHeaders,
    success: AuthSession,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("logout", "/auth/logout", {
    error: errors,
  }).middleware(BearerAuth),
)

const Health = HttpApiGroup.make("Health").add(
  HttpApiEndpoint.get("health", "/health", {
    success: Schema.Struct({ status: Schema.Literal("ok") }),
  }),
)

const UserAccounts = HttpApiGroup.make("UserAccounts").add(
  HttpApiEndpoint.post("create", "/user-accounts", {
    headers: tenantHeaders,
    payload: Schema.Struct({ email: Email }),
    success: CreatedUserAccount,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.get("list", "/user-accounts", {
    headers: tenantHeaders,
    success: Schema.Array(UserAccount),
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.get("get", "/user-accounts/:id", {
    params: { id: Uuid },
    headers: tenantHeaders,
    success: UserAccount,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.patch("update", "/user-accounts/:id", {
    params: { id: Uuid },
    headers: tenantHeaders,
    payload: Schema.Struct({ email: Email }),
    success: UserAccount,
    error: errors,
  }).middleware(BearerAuth),
)

const Authorization = HttpApiGroup.make("Authorization").add(
  HttpApiEndpoint.post("addMember", "/tenant-memberships", {
    headers: tenantHeaders,
    payload: Schema.Struct({ userAccountId: Uuid }),
    success: CreatedTenantMembership,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.get("listMembers", "/tenant-memberships", {
    headers: tenantHeaders,
    query: {
      search: Schema.optionalKey(
        Schema.Trim.pipe(
          Schema.check(Schema.isPattern(/\S/)),
          Schema.check(Schema.isMaxLength(256)),
        ),
      ),
      status: Schema.optionalKey(TenantMembershipStatus),
      limit: Schema.optionalKey(
        Schema.NumberFromString.pipe(
          Schema.check(Schema.isInt()),
          Schema.check(Schema.isBetween({ minimum: 1, maximum: 200 })),
        ),
      ),
    },
    success: Schema.Array(TenantMembership),
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.get("getMember", "/tenant-memberships/:userAccountId", {
    params: { userAccountId: Uuid },
    headers: tenantHeaders,
    success: TenantMembership,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.get("listDirectGrants", "/tenant-memberships/:userAccountId/capabilities", {
    params: { userAccountId: Uuid },
    headers: tenantHeaders,
    success: Schema.Array(DirectCapabilityGrant),
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.get("listCapabilityDefinitions", "/capability-definitions", {
    headers: tenantHeaders,
    success: CapabilityCatalog,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("suspendMember", "/tenant-memberships/:userAccountId/suspend", {
    params: { userAccountId: Uuid },
    headers: tenantHeaders,
    success: TenantMembership,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("activateMember", "/tenant-memberships/:userAccountId/activate", {
    params: { userAccountId: Uuid },
    headers: tenantHeaders,
    success: TenantMembership,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.delete("removeMember", "/tenant-memberships/:userAccountId", {
    params: { userAccountId: Uuid },
    headers: tenantHeaders,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("grant", "/capabilities", {
    headers: tenantHeaders,
    payload: Schema.Struct({ userAccountId: Uuid, capability: Capability }),
    error: errors,
  }).middleware(BearerAuth),
)

export const RitseiApi = HttpApi.make(RitseiApiId)
  .add(
    Authentication,
    Health,
    UserAccounts,
    PartyHttpGroup,
    Authorization,
    SalesHttpGroup,
    InventoryHttpGroup,
    ProcurementHttpGroup,
    AccountingHttpGroup,
    ProcessHttpGroup,
  )
  .annotate(OpenApi.Title, "RITSEI API")
  .annotate(OpenApi.Version, "0.1.0")
  .annotate(OpenApi.Description, "Typed modular-monolith ERP API")
