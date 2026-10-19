import * as Context from "effect/Context"
import * as Schema from "effect/Schema"

import { defineEventCatalogEntry } from "../../catalog/mod.ts"
import type { MessagingService } from "../../messaging/mod.ts"

const NonEmptyString = Schema.String.check(Schema.isPattern(/\S/))

export const IdentityPrincipal = Schema.Struct({
  userAccountId: NonEmptyString,
  sessionId: NonEmptyString,
})
export type IdentityPrincipal = Schema.Schema.Type<typeof IdentityPrincipal>

export const UserAccountCreatedEventPayload = Schema.Struct({
  userAccountId: Schema.String.check(Schema.isUUID()),
  email: NonEmptyString,
})

export const UserAccountCreatedEvent = defineEventCatalogEntry({
  kind: "DomainEvent",
  id: "identity.user_account.created",
  version: 1,
  owningDomain: "identity",
  title: "User account created",
  description: "An Identity-owned user account was created for a tenant context.",
  stability: "PUBLIC",
  compatibilityRange: { minimumVersion: 1, maximumVersion: 1 },
  payloadSchema: UserAccountCreatedEventPayload,
  scope: ["tenant"],
  aggregateType: "identity.user_account",
  correlationFields: ["userAccountId"],
  filterableFields: ["userAccountId", "email"],
  occurredAtSemantics: "owner_commit_time",
  deliveryExpectation: "at_least_once",
  sensitivity: "business_internal_minimized",
})

export interface IdentityEventPublisher {
  readonly append: MessagingService["append"]
}

export const IdentityEventPublisher = Context.Service<IdentityEventPublisher>(
  "RITSEI/IdentityEventPublisher",
)

export interface IdentityAccountAuthorizer {
  readonly authorize: (input: {
    readonly principal: IdentityPrincipal
    readonly tenantId: string
  }) => import("effect/Effect").Effect<
    void,
    | import("./errors.ts").IdentityAuthorizationDenied
    | import("../../../foundation/mod.ts").DatabaseFailure
    | import("effect/Schema").SchemaError
  >
}

export const IdentityAccountAuthorizer = Context.Service<IdentityAccountAuthorizer>(
  "RITSEI/IdentityAccountAuthorizer",
)
