import * as Effect from "effect/Effect"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Result from "effect/Result"
import { createContext } from "solid-js"
import type { BrowserConnection, RequestFailure } from "./api.ts"

export type ApiScope = {
  readonly runtime: ManagedRuntime.ManagedRuntime<BrowserConnection, never>
  readonly lifetime: AbortSignal
  readonly tenantId: string
}
export const ApiRuntime = createContext<ApiScope>()

export async function runRequest<A>(
  scope: ApiScope,
  request: Effect.Effect<A, RequestFailure, BrowserConnection>,
  signal?: AbortSignal,
): Promise<A> {
  const result = await scope.runtime.runPromise(Effect.result(request), {
    signal: signal ? AbortSignal.any([scope.lifetime, signal]) : scope.lifetime,
  })
  if (Result.isFailure(result)) throw result.failure
  return result.success
}
