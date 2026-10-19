import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { MessagingService } from "../../messaging/mod.ts"
import { UserAccountService } from "./contract.ts"
import { IdentityEventPublisher } from "./events.ts"
import { makeUserAccountMemoryStore } from "./memory.ts"
import { makeUserAccountPostgresStore } from "./postgres.ts"
import { makeUserAccountServiceFromStore } from "./service.ts"

export const IdentityEventPublisherLive = Layer.effect(
  IdentityEventPublisher,
  Effect.map(MessagingService, (messaging) => ({ append: messaging.append })),
)

export const makeUserAccountService = makeUserAccountServiceFromStore(makeUserAccountPostgresStore)
export const IdentityLive = Layer.effect(UserAccountService, makeUserAccountService)

export const makeUserAccountTestLayer = () =>
  Layer.effect(
    UserAccountService,
    makeUserAccountServiceFromStore(Effect.succeed(makeUserAccountMemoryStore())),
  )
