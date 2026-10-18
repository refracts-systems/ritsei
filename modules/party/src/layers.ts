import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { MessagingService } from "../../messaging/mod.ts"
import { PartyService } from "./contract.ts"
import { PartyEventPublisher } from "./events.ts"
import { makePartyMemoryStore } from "./memory.ts"
import { makePartyPostgresStore } from "./postgres.ts"
import { makePartyServiceFromStore } from "./service.ts"

export const makePartyService = makePartyServiceFromStore(makePartyPostgresStore)
export const PartyEventPublisherLive = Layer.effect(
  PartyEventPublisher,
  Effect.map(MessagingService, (messaging) => ({ append: messaging.append })),
)

export const PartyLive = Layer.effect(PartyService, makePartyService)

export const makePartyTestLayer = (validUserAccountIds?: ReadonlySet<string>) =>
  Layer.effect(
    PartyService,
    makePartyServiceFromStore(Effect.succeed(makePartyMemoryStore(validUserAccountIds))),
  )
