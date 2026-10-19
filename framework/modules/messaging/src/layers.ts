import * as Layer from "effect/Layer"
import { MessagingService } from "./contract.ts"
import { makeMessagingTestLayer } from "./memory.ts"
import { makePostgresMessagingService } from "./postgres.ts"

export const MessagingLive = Layer.effect(MessagingService, makePostgresMessagingService)
export { makeMessagingTestLayer }
