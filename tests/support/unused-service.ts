import * as Effect from "effect/Effect"
import { partial } from "./partial.ts"

/** A service stub for HTTP contract tests whose endpoints under test never call it. */
export const unusedService = <Service extends object>(name: string): Service =>
  new Proxy(partial<Service>({}), {
    get: (_, method) => () => Effect.die(new Error(`unexpected ${name} call: ${String(method)}`)),
  })
