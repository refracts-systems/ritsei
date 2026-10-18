import { DatabaseFailure } from "../../../foundation/mod.ts"
import { defineActionCatalogEntry } from "../../catalog/mod.ts"
import { EventIdempotencyConflict } from "../../messaging/mod.ts"
import { IdentityCapabilities } from "./capabilities.ts"
import { CreateUserAccountForTenantInput, UserAccount } from "./contract.ts"
import { IdentityAuthorizationDenied } from "./errors.ts"
import { UserAccountCreatedEvent } from "./events.ts"

export const IdentityCreateUserAccountAction = defineActionCatalogEntry({
  kind: "DomainAction",
  id: "identity.user_account.create",
  version: 1,
  owningDomain: "identity",
  title: "Create user account",
  description: "Create a global Identity user account under an authorized tenant context.",
  stability: "PUBLIC",
  compatibilityRange: { minimumVersion: 1, maximumVersion: 1 },
  inputSchema: CreateUserAccountForTenantInput,
  outputSchema: UserAccount,
  errorSchemas: [IdentityAuthorizationDenied, DatabaseFailure, EventIdempotencyConflict],
  requiredCapability: IdentityCapabilities.userAccountCreate,
  scope: ["tenant"],
  idempotency: "unsupported",
  transactionSemantics: "local_atomic",
  timeoutPolicy: { timeoutMs: 30_000 },
  retryPolicy: { maxAttempts: 1 },
  preconditions: ["authorized"],
  effects: ["user_account_created"],
  compensation: { kind: "none", recovery: "manual" },
})

export const IdentityTypedActionCatalog = [IdentityCreateUserAccountAction] as const
export const IdentityTypedEventCatalog = [UserAccountCreatedEvent] as const
