import * as Effect from "effect/Effect"

import { Database } from "../../../foundation/mod.ts"
import { AuthorizationService } from "./contract.ts"
import { makePostgresAuthorizationService } from "./postgres.ts"

export const makeAuthorizationService = Effect.gen(function* () {
  return makePostgresAuthorizationService(yield* Database)
})

export { AuthorizationService }
