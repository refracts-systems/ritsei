import * as Layer from "effect/Layer"

import { AuthService } from "./contract.ts"
import { makeAuthService } from "./service.ts"

export const AuthLive = Layer.effect(AuthService, makeAuthService)

export { makeMemoryAuthLayer as makeAuthTestLayer } from "./memory.ts"
