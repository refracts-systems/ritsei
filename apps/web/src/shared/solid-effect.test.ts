import { assert, describe, it } from "@effect/vitest"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import {
  createComponent,
  createMemo,
  createRenderEffect,
  createRoot,
  type Element,
  flush,
} from "solid-js"
import {
  createRuntime,
  MissingRuntimeContextError,
  runEffect,
  RuntimeContext,
} from "./solid-effect.ts"

class TestService extends Context.Service<TestService, { readonly value: number }>()(
  "SolidEffectTestService",
) {}

const TestServiceLive = Layer.succeed(TestService, { value: 42 })

function mountRuntime<R>(layer: Layer.Layer<R>, children: () => Element) {
  let dispose = () => {}

  createRoot((rootDispose) => {
    dispose = rootDispose
    const runtime = createRuntime(layer)
    const provider = createComponent(RuntimeContext, {
      value: runtime,
      get children() {
        return children()
      },
    })
    createRenderEffect(
      () => {
        let output: unknown = provider
        while (typeof output === "function") {
          output = (output as () => unknown)()
        }
        return output
      },
      () => {},
    )
  })
  flush()

  return dispose
}

describe("Solid 2 × Effect production bridge", () => {
  it("fails fast when a runtime provider is missing", () => {
    assert.throws(() => {
      createRoot(() => {
        const source = createMemo(() => runEffect(Effect.succeed(1)))
        source()
      })
    }, MissingRuntimeContextError)
  })

  it.effect("resolves the Effect R channel from the scoped runtime", () =>
    Effect.promise(async () => {
      let source: AsyncIterable<number> | undefined
      const dispose = mountRuntime(TestServiceLive, () => {
        source = runEffect(Effect.map(TestService, (service) => service.value))
        return null
      })
      const result = await source![Symbol.asyncIterator]().next()
      assert.deepStrictEqual(result, { done: false, value: 42 })
      dispose()
    }),
  )

  it.effect("disposes the Layer scope with the Solid owner", () =>
    Effect.promise(async () => {
      let released = false
      const layer = Layer.effect(
        TestService,
        Effect.acquireRelease(Effect.succeed({ value: 42 }), () =>
          Effect.sync(() => {
            released = true
          }),
        ),
      )
      let source: AsyncIterable<number> | undefined
      const dispose = mountRuntime(layer, () => {
        source = runEffect(Effect.map(TestService, (service) => service.value))
        return null
      })
      assert.deepStrictEqual(await source![Symbol.asyncIterator]().next(), {
        done: false,
        value: 42,
      })
      dispose()
      await new Promise((resolve) => setTimeout(resolve, 0))
      assert.isTrue(released)
    }),
  )

  it.effect("awaits fiber interruption when the async source closes", () =>
    Effect.promise(async () => {
      let interrupted = false
      let source: AsyncIterable<never> | undefined
      const dispose = mountRuntime(Layer.empty, () => {
        source = runEffect(
          Effect.never.pipe(
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                interrupted = true
              }),
            ),
          ),
        )
        return null
      })
      const iterator = source![Symbol.asyncIterator]()
      const pending = iterator.next()
      await new Promise((resolve) => setTimeout(resolve, 0))
      const closed = await iterator.return?.()
      assert.deepStrictEqual(closed, { done: true, value: undefined })
      assert.isTrue(interrupted)
      await pending
      dispose()
    }),
  )
})
