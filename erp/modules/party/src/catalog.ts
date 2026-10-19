import { DatabaseFailure } from "../../../../framework/foundation/mod.ts"
import { AuthorizationDenied } from "../../../../framework/modules/authorization/mod.ts"
import { defineActionCatalogEntry } from "../../../../framework/modules/catalog/mod.ts"
import { EventIdempotencyConflict } from "../../../../framework/modules/messaging/mod.ts"
import { PartyCapabilities } from "./capabilities.ts"
import { CreatePartyInput, Party } from "./contract.ts"
import { PartyCreatedEvent } from "./events.ts"

export const PartyCreateAction = defineActionCatalogEntry({
  kind: "DomainAction",
  id: "party.create",
  version: 1,
  owningDomain: "party",
  title: "Create party",
  description: "Create a tenant-scoped Party master record.",
  stability: "PUBLIC",
  compatibilityRange: { minimumVersion: 1, maximumVersion: 1 },
  inputSchema: CreatePartyInput,
  outputSchema: Party,
  errorSchemas: [AuthorizationDenied, DatabaseFailure, EventIdempotencyConflict],
  requiredCapability: PartyCapabilities.partyCreate,
  scope: ["tenant"],
  idempotency: "unsupported",
  transactionSemantics: "local_atomic",
  timeoutPolicy: { timeoutMs: 30_000 },
  retryPolicy: { maxAttempts: 1 },
  preconditions: ["authorized"],
  effects: ["party_created"],
  compensation: { kind: "none", recovery: "manual" },
})

export const PartyTypedActionCatalog = [PartyCreateAction] as const
export const PartyTypedEventCatalog = [PartyCreatedEvent] as const
