import * as Schema from "effect/Schema"

import { Capability } from "./contract.ts"

export class AuthorizationDenied extends Schema.TaggedError<AuthorizationDenied>()(
  "AuthorizationDenied",
  {
    tenantId: Schema.String,
    capability: Capability,
  },
) {}

export class CapabilityAlreadyGranted extends Schema.TaggedError<CapabilityAlreadyGranted>()(
  "CapabilityAlreadyGranted",
  {
    userAccountId: Schema.String,
    tenantId: Schema.String,
    capability: Capability,
  },
) {}

export class TenantMembershipAlreadyExists extends Schema.TaggedError<TenantMembershipAlreadyExists>()(
  "TenantMembershipAlreadyExists",
  {
    userAccountId: Schema.String,
    tenantId: Schema.String,
  },
) {}

export class TenantMembershipNotFound extends Schema.TaggedError<TenantMembershipNotFound>()(
  "TenantMembershipNotFound",
  {
    userAccountId: Schema.String,
    tenantId: Schema.String,
  },
) {}

export class TenantMembershipNotActive extends Schema.TaggedError<TenantMembershipNotActive>()(
  "TenantMembershipNotActive",
  {
    userAccountId: Schema.String,
    tenantId: Schema.String,
  },
) {}

export class TenantMembershipUserAccountNotFound extends Schema.TaggedError<TenantMembershipUserAccountNotFound>()(
  "TenantMembershipUserAccountNotFound",
  {
    userAccountId: Schema.String,
  },
) {}
