import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import { AuthorizationService, GrantCapabilityInput } from "./contract.ts"
import { makeMemoryAuthorizationService } from "./memory.ts"
import {
  makeMemoryRelationshipEngine,
  makeRelationshipEngine,
  RelationshipEngine,
} from "./relationship.ts"
import { makeAuthorizationService } from "./service.ts"

export const AuthorizationLive = Layer.effect(AuthorizationService, makeAuthorizationService)
export const RelationshipLive = Layer.effect(RelationshipEngine, makeRelationshipEngine)

export const makeAuthorizationTestLayer = (
  initialGrants: ReadonlyArray<Schema.Schema.Type<typeof GrantCapabilityInput>> = [],
) =>
  Layer.merge(
    Layer.succeed(AuthorizationService, makeMemoryAuthorizationService(initialGrants)),
    Layer.succeed(RelationshipEngine, makeMemoryRelationshipEngine()),
  )
