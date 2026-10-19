import * as Context from "effect/Context"
import * as Schema from "effect/Schema"

import { defineEventCatalogEntry } from "../../../../framework/modules/module/mod.ts"
import type { MessagingService } from "../../../../framework/modules/messaging/mod.ts"

const Uuid = Schema.String.check(Schema.isUUID())

export const PartyCreatedEventPayload = Schema.Struct({
  partyId: Uuid,
  kind: Schema.Literals(["person", "organization"]),
})

export const PartyCreatedEvent = defineEventCatalogEntry({
  kind: "DomainEvent",
  id: "party.created",
  version: 1,
  owningDomain: "party",
  title: "Party created",
  description: "A Party-owned tenant party was created.",
  stability: "PUBLIC",
  compatibilityRange: { minimumVersion: 1, maximumVersion: 1 },
  payloadSchema: PartyCreatedEventPayload,
  scope: ["tenant"],
  aggregateType: "party.party",
  correlationFields: ["partyId"],
  filterableFields: ["partyId", "kind"],
  occurredAtSemantics: "owner_commit_time",
  deliveryExpectation: "at_least_once",
  sensitivity: "business_internal_minimized",
})

export interface PartyEventPublisher {
  readonly append: MessagingService["append"]
}

export const PartyEventPublisher = Context.Service<PartyEventPublisher>(
  "RITSEI/PartyEventPublisher",
)
