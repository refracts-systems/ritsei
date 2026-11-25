import * as Schema from "effect/Schema"

import { defineEventCatalogEntry } from "../../../../framework/modules/module/mod.ts"

const Uuid = Schema.String.check(Schema.isUUID())

export const SituationEventPayload = Schema.Struct({
  situationId: Uuid,
  type: Schema.String,
  severity: Schema.Literals(["low", "medium", "high"]),
  escalationLevel: Schema.Int,
})

const situationEvent = (name: "opened" | "escalated" | "resolved", description: string) =>
  defineEventCatalogEntry({
    kind: "DomainEvent",
    id: `situations.situation.${name}`,
    version: 1,
    owningDomain: "situations",
    title: `Situation ${name}`,
    description,
    stability: "PUBLIC",
    compatibilityRange: { minimumVersion: 1, maximumVersion: 1 },
    payloadSchema: SituationEventPayload,
    scope: ["tenant"],
    aggregateType: "situation",
    correlationFields: ["situationId"],
    filterableFields: ["situationId"],
    occurredAtSemantics: "owner_commit_time",
    deliveryExpectation: "at_least_once",
    sensitivity: "business_internal_minimized",
  })

export const SituationOpenedEvent = situationEvent(
  "opened",
  "A situation needing a person was opened.",
)

export const SituationEscalatedEvent = situationEvent(
  "escalated",
  "An untaken situation was escalated to the next role.",
)

export const SituationResolvedEvent = situationEvent(
  "resolved",
  "The cause of a situation is gone, so it was resolved.",
)

export const SituationsTypedEventCatalog = [
  SituationOpenedEvent,
  SituationEscalatedEvent,
  SituationResolvedEvent,
] as const
