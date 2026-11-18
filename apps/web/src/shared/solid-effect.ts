/**
 * Solid 2 × Effect production bridge.
 *
 * Context path — a scoped `ManagedRuntime` is carried in Solid Context.
 * Effects requiring services also receive that runtime explicitly for type checking.
 * `createRuntime` ties the Layer scope to the Solid owner,
 * so service lifetime follows subtree lifetime instead of a global registry.
 *
 * Read path — `runEffect` adapts one Effect to Solid's AsyncIterable protocol.
 * When Solid supersedes or disposes a computation, its iterator is closed;
 * `return()` interrupts the Effect fiber and waits for its finalizers.
 *
 * Action path — `effectAction` runs each yielded Effect as one
 * interruptible Solid action step. Typed failures and interruption are thrown
 * back into the generator so workflow code can perform explicit compensation.
 * This bridge does not replace TanStack Query's server-state ownership or
 * backend authorization and transaction boundaries.
 */
import { Cause, Effect, Exit, Fiber, Layer, ManagedRuntime } from "effect"
import { action, createContext, onCleanup, useContext } from "solid-js"

type SolidEffectRuntime = ManagedRuntime.ManagedRuntime<never, never>

/**
 * The scoped Effect runtime used by the Solid application subtree.
 *
 * The context erases the provider's concrete service set so nested providers
 * can carry different `R` values through one Solid context. Effects requiring
 * services must receive a matching typed runtime explicitly.
 */
export const RuntimeContext = createContext<SolidEffectRuntime | null>(null)

/**
 * Raised when an Effect bridge is used outside a runtime provider.
 * This is a composition/configuration error, not a domain failure to recover
 * from at a feature boundary.
 */
export class MissingRuntimeContextError extends Error {
  constructor() {
    super("Solid Effect runtime is not provided by RuntimeContext")
    this.name = "MissingRuntimeContextError"
  }
}

/**
 * Builds a runtime whose Layer scope follows the current Solid owner.
 *
 * Call this during component setup, then pass the returned runtime to
 * `RuntimeContext`. Nested providers share the parent's Effect MemoMap without
 * becoming a global registry; their service overrides still remain subtree-
 * scoped. The runtime is disposed automatically when this owner unmounts.
 */
export function createRuntime<R>(layer: Layer.Layer<R>): ManagedRuntime.ManagedRuntime<R, never> {
  const parent = useContext(RuntimeContext)
  const runtime = ManagedRuntime.make(layer, parent ? { memoMap: parent.memoMap } : undefined)
  onCleanup(() => void runtime.dispose())

  return runtime
}

/** Resolve the nearest runtime at the boundary where the Effect is created. */
function resolveRuntime(): SolidEffectRuntime {
  const runtime = useContext(RuntimeContext)

  if (!runtime) throw new MissingRuntimeContextError()

  return runtime
}

/**
 * Capture the provider once for a read or action. A feature must not rebuild
 * the application environment with ad hoc `Effect.provide` calls here.
 */
function resolveFork<R>(runtime?: ManagedRuntime.ManagedRuntime<R, never>) {
  if (runtime) return <A, E>(effect: Effect.Effect<A, E, R>) => runtime.runFork(effect)

  const context = resolveRuntime()

  return <A, E>(effect: Effect.Effect<A, E, R>) =>
    // SAFETY: the public overloads allow an omitted runtime only for R = never.
    context.runFork(effect as Effect.Effect<A, E, never>)
}

/**
 * Adapts one Effect result to Solid's async-source protocol.
 *
 * A plain `Effect.runPromise` would let Solid discard stale results but could
 * not cancel the underlying work. The AsyncIterable boundary gives Solid a
 * lifecycle hook: supersession/disposal calls `return()`, which interrupts the
 * fiber and waits for its finalizers before the iterator closes.
 */
export function runEffect<A, E>(effect: Effect.Effect<A, E, never>): AsyncIterable<A>
export function runEffect<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  runtime: ManagedRuntime.ManagedRuntime<R, never>,
): AsyncIterable<A>
export function runEffect<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  runtime?: ManagedRuntime.ManagedRuntime<R, never>,
): AsyncIterable<A> {
  const fork = resolveFork(runtime)

  return {
    [Symbol.asyncIterator]() {
      const fiber = fork(effect)
      // Solid asks for one value from this source. These flags make repeated
      // reads and repeated disposal idempotent.
      let yielded = false
      let closed = false
      const done = { done: true, value: undefined } as const

      return {
        async next(): Promise<IteratorResult<A>> {
          if (yielded || closed) return done
          const exit = await Effect.runPromise(Fiber.await(fiber))

          if (closed) return done

          if (Exit.isSuccess(exit)) {
            yielded = true

            return { done: false, value: exit.value }
          }

          closed = true

          if (Exit.isFailure(exit)) {
            const cause = exit.cause

            if (Exit.hasInterrupts(exit)) return done
            throw Cause.squash(cause)
          }

          return done
        },
        // Solid calls return() when the flight is superseded or its owner is
        // disposed. Awaiting interruption keeps finalizer completion ordered
        // before the source is reported closed.
        async return(): Promise<IteratorResult<A>> {
          if (yielded || closed) return done
          closed = true
          await Effect.runPromise(Fiber.interrupt(fiber))

          return done
        },
      }
    },
  }
}

/**
 * Typed interruption delivered to an Effect action's generator.
 * Catch it when the workflow owns a compensating business command; do not
 * treat it as proof that a server-side commit was rolled back automatically.
 */
export class ActionInterruptedError extends Error {
  constructor() {
    super("Action interrupted")
    this.name = "ActionInterruptedError"
  }
}

// The generator keeps the workflow readable while the bridge owns fiber
// execution. `R` remains the shared service requirement for its yielded steps.
type SagaStep<R> = Effect.Effect<unknown, unknown, R>

/** Preserve the success type and forward injected failures to the action generator. */
export function* actionStep<A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Generator<Effect.Effect<A, E, R>, A, unknown> {
  // SAFETY: the runner resumes this iterator only with the successful value of this Effect.
  return (yield effect) as A
}

export interface EffectAction<Args extends unknown[], A> {
  (...args: Args): Promise<A>
  interrupt(): void
}

interface ActionFlight {
  fiber: Fiber.Fiber<unknown, unknown> | null
  cancelled: boolean
  recovering: boolean
  readonly settled: Promise<void>
}

/**
 * Runs each yielded Effect as an interruptible Solid action step.
 *
 * The Solid action owns optimistic presentation writes; Effect owns service
 * calls, typed failures, interruption, and resource finalizers. Action generators
 * use `yield* actionStep(effect)` to retain each step's success type and forward
 * injected failures to the generator's catch block. Compensation across
 * already-completed steps belongs in the generator's catch block.
 * Use for explicit workflows; TanStack Query remains the owner of shared
 * server-state caching and invalidation.
 */
export function effectAction<Args extends unknown[], A>(
  genFn: (...args: Args) => Generator<SagaStep<never>, A, never>,
): EffectAction<Args, A>
export function effectAction<Args extends unknown[], A, R>(
  genFn: (...args: Args) => Generator<SagaStep<R>, A, never>,
  runtime: ManagedRuntime.ManagedRuntime<R, never>,
): EffectAction<Args, A>
export function effectAction<Args extends unknown[], A, R>(
  genFn: (...args: Args) => Generator<SagaStep<R>, A, never>,
  runtime?: ManagedRuntime.ManagedRuntime<R, never>,
): EffectAction<Args, A> {
  const fork = resolveFork(runtime)
  let active: ActionFlight | undefined

  // Solid's action transaction provides the optimistic UI boundary; each
  // yielded Effect below provides the interruptible application step.
  const base = action(function* (flight: ActionFlight, ...args: Args) {
    const iterator = genFn(...args)
    let step = iterator.next()

    while (!step.done) {
      const fiber = fork(step.value)
      flight.fiber = fiber
      const exit: Exit.Exit<unknown, unknown> = yield Effect.runPromise(Fiber.await(fiber))

      if (flight.fiber === fiber) flight.fiber = null

      if (Exit.isSuccess(exit)) {
        // SAFETY: the saga generator is typed to receive the value of the step it yielded.
        step = iterator.next(exit.value as never)
      } else if (Exit.isFailure(exit)) {
        const cause = exit.cause
        // Recovery steps belong to this flight and must not be interrupted by
        // a later invocation while compensating already-completed work.
        flight.recovering = true

        if (Exit.hasInterrupts(exit)) {
          step = iterator.throw(new ActionInterruptedError())
        } else {
          step = iterator.throw(Cause.squash(cause))
        }
      }
    }

    return step.value
  })

  const cancel = (flight: ActionFlight) => {
    if (flight.cancelled) return
    flight.cancelled = true

    if (!flight.recovering && flight.fiber) void Effect.runPromise(Fiber.interrupt(flight.fiber))
  }

  // A replacement waits for interruption, finalizers, and compensation of
  // its predecessor before starting another workflow.
  const invoke = (...args: Args) => {
    const previous = active

    if (previous) cancel(previous)
    const completion = Promise.withResolvers<void>()

    const flight: ActionFlight = {
      fiber: null,
      cancelled: false,
      recovering: false,
      settled: completion.promise,
    }

    active = flight

    const run = async () => {
      if (previous) await previous.settled

      if (flight.cancelled) throw new ActionInterruptedError()

      return base(flight, ...args)
    }

    return run().finally(() => {
      flight.fiber = null

      if (active === flight) active = undefined
      completion.resolve()
    })
  }

  invoke.interrupt = () => {
    if (active) cancel(active)
  }

  return invoke
}
