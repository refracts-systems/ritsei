/* oxlint-disable anti-slop/no-chained-type-assertions -- this facade re-exports the production module under the experiment's narrower public types, which TypeScript cannot relate without going through unknown */
import type * as Effect from "effect/Effect"
import type * as Layer from "effect/Layer"
import type * as ManagedRuntime from "effect/ManagedRuntime"
import type { ContextProviderComponent } from "solid-js"
import * as Production from "../../../shared/solid-effect"

// SAFETY: the experiment narrows the production context's types for its own examples.
export const RuntimeContext = Production.RuntimeContext as unknown as ContextProviderComponent<
  ManagedRuntime.ManagedRuntime<never, never>
>
export const MissingRuntimeContextError = Production.MissingRuntimeContextError
export const ActionInterruptedError = Production.ActionInterruptedError

// SAFETY: the experiment narrows the production runtime factory's types for its own examples.
export const createRuntime = Production.createRuntime as unknown as <R>(
  layer: Layer.Layer<R>,
) => ManagedRuntime.ManagedRuntime<R, never>

// SAFETY: the experiment narrows the production runner's types for its own examples.
export const runEffect = Production.runEffect as unknown as <A, E, R = never>(
  effect: Effect.Effect<A, E, R>,
) => AsyncIterable<A>

type SagaStep<R> = Effect.Effect<unknown, unknown, R>

type EffectAction<Args extends unknown[], A> = {
  (...args: Args): Promise<A>
  interrupt(): void
}

// SAFETY: the experiment narrows the production action's types for its own examples.
export const effectAction = Production.effectAction as unknown as <
  Args extends unknown[],
  A,
  R = never,
>(
  genFn: (...args: Args) => Generator<SagaStep<R>, A, never>,
) => EffectAction<Args, A>
