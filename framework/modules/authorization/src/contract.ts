import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { DatabaseFailure } from "../../../foundation/mod.ts"
import { Principal } from "../../auth/mod.ts"
import { Capability as CapabilitySchema } from "./capabilities.ts"

export const Capability = CapabilitySchema

export type Capability = Schema.Schema.Type<typeof Capability>

export const TenantMembershipStatus = Schema.Literals(["active", "suspended"])

export type TenantMembershipStatus = Schema.Schema.Type<typeof TenantMembershipStatus>

export const TenantMembership = Schema.Struct({
  userAccountId: Schema.String,
  tenantId: Schema.String,
  status: TenantMembershipStatus,
})

export type TenantMembership = Schema.Schema.Type<typeof TenantMembership>

export const AuthorizationInput = Schema.Struct({
  principal: Principal,
  tenantId: Schema.String,
  capability: Capability,
})

export const GrantCapabilityInput = Schema.Struct({
  userAccountId: Schema.String,
  tenantId: Schema.String,
  capability: Capability,
})

export const AddTenantMembershipInput = Schema.Struct({
  userAccountId: Schema.String,
  tenantId: Schema.String,
})

export const TenantMembershipInput = Schema.Struct({
  userAccountId: Schema.String,
  tenantId: Schema.String,
})

export const ListAccessibleTenantsInput = Schema.Struct({
  userAccountId: Schema.String,
})

export type ListAccessibleTenantsInput = Schema.Schema.Type<typeof ListAccessibleTenantsInput>

const TenantMembershipSearch = Schema.Trim.pipe(
  Schema.check(Schema.isPattern(/\S/)),
  Schema.check(Schema.isMaxLength(256)),
)

export const ListTenantMembershipsInput = Schema.Struct({
  tenantId: Schema.String,
  search: Schema.optionalKey(TenantMembershipSearch),
  status: Schema.optionalKey(TenantMembershipStatus),
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 }))),
})

export type ListTenantMembershipsInput = Schema.Schema.Type<typeof ListTenantMembershipsInput>

export const DirectCapabilityGrant = Schema.Struct({
  userAccountId: Schema.String,
  tenantId: Schema.String,
  capability: Capability,
  scope: Schema.Literal("tenant"),
})

export type DirectCapabilityGrant = Schema.Schema.Type<typeof DirectCapabilityGrant>

export const AuthorizationDecision = Schema.Struct({
  allowed: Schema.Literal(true),
  tenantId: Schema.String,
  capability: Capability,
  grant: Schema.Literal("membership"),
})

export interface AuthorizationService {
  readonly authorize: (
    input: Schema.Codec.Encoded<typeof AuthorizationInput>,
  ) => Effect.Effect<
    Schema.Schema.Type<typeof AuthorizationDecision>,
    import("./errors.ts").AuthorizationDenied | DatabaseFailure | Schema.SchemaError
  >
  readonly addMember: (
    input: Schema.Codec.Encoded<typeof AddTenantMembershipInput>,
  ) => Effect.Effect<
    TenantMembership,
    | import("./errors.ts").TenantMembershipAlreadyExists
    | import("./errors.ts").TenantMembershipUserAccountNotFound
    | DatabaseFailure
    | Schema.SchemaError
  >
  readonly getMember: (
    input: Schema.Codec.Encoded<typeof TenantMembershipInput>,
  ) => Effect.Effect<
    TenantMembership,
    import("./errors.ts").TenantMembershipNotFound | DatabaseFailure | Schema.SchemaError
  >
  readonly listMembers: (
    input: Schema.Codec.Encoded<typeof ListTenantMembershipsInput>,
  ) => Effect.Effect<readonly TenantMembership[], DatabaseFailure | Schema.SchemaError>
  readonly listAccessibleTenants: (
    input: Schema.Codec.Encoded<typeof ListAccessibleTenantsInput>,
  ) => Effect.Effect<readonly TenantMembership[], DatabaseFailure | Schema.SchemaError>
  readonly listDirectGrants: (
    input: Schema.Codec.Encoded<typeof TenantMembershipInput>,
  ) => Effect.Effect<
    readonly DirectCapabilityGrant[],
    import("./errors.ts").TenantMembershipNotFound | DatabaseFailure | Schema.SchemaError
  >
  readonly suspendMember: (
    input: Schema.Codec.Encoded<typeof TenantMembershipInput>,
  ) => Effect.Effect<
    TenantMembership,
    import("./errors.ts").TenantMembershipNotFound | DatabaseFailure | Schema.SchemaError
  >
  readonly activateMember: (
    input: Schema.Codec.Encoded<typeof TenantMembershipInput>,
  ) => Effect.Effect<
    TenantMembership,
    import("./errors.ts").TenantMembershipNotFound | DatabaseFailure | Schema.SchemaError
  >
  readonly removeMember: (
    input: Schema.Codec.Encoded<typeof TenantMembershipInput>,
  ) => Effect.Effect<
    void,
    import("./errors.ts").TenantMembershipNotFound | DatabaseFailure | Schema.SchemaError
  >
  readonly grant: (
    input: Schema.Codec.Encoded<typeof GrantCapabilityInput>,
  ) => Effect.Effect<
    void,
    | import("./errors.ts").CapabilityAlreadyGranted
    | import("./errors.ts").TenantMembershipNotFound
    | import("./errors.ts").TenantMembershipNotActive
    | DatabaseFailure
    | Schema.SchemaError
  >
}

export const AuthorizationService = Context.Service<AuthorizationService>(
  "RITSEI/AuthorizationService",
)
