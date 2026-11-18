import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { OnboardingService } from "./contract.ts"
import { makeOnboardingMemoryStore } from "./memory.ts"
import { makeOnboardingPostgresStore } from "./postgres.ts"
import { makeOnboardingServiceFromStore } from "./service.ts"

export const makeOnboardingService = makeOnboardingServiceFromStore(makeOnboardingPostgresStore())

export const OnboardingLive = Layer.effect(OnboardingService, makeOnboardingService)

export const makeOnboardingTestLayer = () =>
  Layer.effect(
    OnboardingService,
    makeOnboardingServiceFromStore(Effect.sync(makeOnboardingMemoryStore)),
  )
