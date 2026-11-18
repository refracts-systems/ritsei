import { AxeBuilder } from "@axe-core/playwright"
import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import { spawnSync } from "node:child_process"
import { chromium } from "playwright"
import { createServer, preview } from "vite"

const experimentRoot = "apps/web/src/experiments/solid-effect"

const builtSolidEffect = Effect.gen(function* () {
  const output = yield* Effect.sync(() =>
    spawnSync("pnpm", ["--dir", experimentRoot, "build"], {
      encoding: "utf8",
      shell: process.platform === "win32",
    }),
  )

  assert.isTrue(output.status === 0, output.stdout + output.stderr)

  const server = yield* Effect.acquireRelease(
    Effect.promise(() =>
      preview({
        configFile: false,
        root: experimentRoot,
        build: { outDir: "dist" },
        preview: { host: "127.0.0.1", port: 0, strictPort: true },
      }),
    ),
    (server) =>
      Effect.promise(
        () =>
          new Promise<void>((resolve, reject) => {
            server.httpServer.close((error) => (error ? reject(error) : resolve()))
          }),
      ),
  )

  const address = server.httpServer.address()
  assert.isNotNull(address)
  assert.isNotString(address)

  if (!address || Predicate.isString(address)) {
    return yield* Effect.die("No preview TCP address")
  }

  const browser = yield* Effect.acquireRelease(
    Effect.promise(() => chromium.launch({ headless: true })),
    (browser) => Effect.promise(() => browser.close()),
  )

  const context = yield* Effect.acquireRelease(
    Effect.promise(() => browser.newContext({ viewport: { width: 1280, height: 900 } })),
    (context) => Effect.promise(() => context.close()),
  )

  const page = yield* Effect.promise(() => context.newPage())
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))

  return { page, errors, url: `http://127.0.0.1:${address.port}` }
})

it.effect(
  "proves effectAction cancellation, compensation, focus restoration, and accessibility",
  () =>
    Effect.gen(function* () {
      const { page, errors, url } = yield* builtSolidEffect
      yield* Effect.promise(async () => {
        await page.goto(url)
        await page.getByRole("button", { name: /Checkout/ }).click()
        await page.getByRole("heading", { name: "Checkout saga" }).waitFor()

        const placeOrder = page.getByRole("button", { name: /Place order/ })
        await placeOrder.focus()
        await placeOrder.click()
        await page.locator('li[aria-current="step"]', { hasText: "Charge card" }).waitFor()

        const cancel = page.getByRole("button", { name: "Cancel checkout" })
        await cancel.focus()
        await cancel.click()
        await page
          .getByText("Checkout cancelled — compensations ran, cart untouched", {
            exact: true,
          })
          .waitFor()
        assert.isTrue(
          await page
            .getByRole("button", { name: /Place order/ })
            .evaluate((element) => element === document.activeElement),
        )
        assert.isTrue(
          await page
            .getByText("chargeCard interrupted — voiding card authorization", {
              exact: true,
            })
            .isVisible(),
        )
        assert.isTrue(
          await page
            .getByText(/releaseReservation → .* released \(saga compensation\)/)
            .isVisible(),
        )

        await page.getByLabel("Simulate card decline").check()
        await page.getByRole("button", { name: /Place order/ }).click()
        await page.getByRole("alert").waitFor()
        assert.isTrue(await page.getByText(/Card declined for/).isVisible())
        assert.isTrue(
          await page
            .getByRole("button", { name: /Place order/ })
            .evaluate((element) => element === document.activeElement),
        )

        await page.emulateMedia({
          reducedMotion: "reduce",
          forcedColors: "active",
        })
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()
        assert.deepEqual(results.violations, [])
        assert.deepEqual(errors, [])
      })
    }),
  { timeout: 120_000 },
)

it.effect("serializes overlapping action recovery in the Solid client runtime", () =>
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(
      Effect.promise(async () => {
        const vite = await createServer({
          configFile: false,
          root: experimentRoot,
          server: { host: "127.0.0.1", port: 0, fs: { allow: [process.cwd()] } },
          plugins: [
            {
              name: "action-concurrency-test",
              resolveId: (id) =>
                id === "virtual:action-concurrency-test" ? "\0action-concurrency-test" : undefined,
              load: (id) =>
                id === "\0action-concurrency-test"
                  ? `
              import { createRoot } from "solid-js"
              import { Effect, Layer } from "effect"
              import { actionStep, createRuntime, effectAction } from "/src/solid-effect.ts"

              export async function exercise() {
                const started = Promise.withResolvers()
                const recovering = Promise.withResolvers()
                const finish = Promise.withResolvers()
                const events = []
                let dispose
                const run = createRoot((cleanup) => {
                  dispose = cleanup
                  const runtime = createRuntime(Layer.empty)
                  return effectAction(function* (name) {
                    if (name === "first") {
                      try {
                        yield* actionStep(Effect.sync(() => started.resolve()).pipe(Effect.andThen(Effect.never)))
                      } catch (error) {
                        yield* actionStep(Effect.promise(async () => {
                          events.push("recovery-start")
                          recovering.resolve()
                          await finish.promise
                          events.push("recovery-end")
                        }))
                        throw error
                      }
                    }
                    events.push(name)
                    return yield* actionStep(Effect.succeed(42))
                  }, runtime)
                })
                const first = run("first").then(() => "success", error => error.name)
                await started.promise
                const second = run("second").then(() => "success", error => error.name)
                await recovering.promise
                const third = run("third")
                const beforeRecovery = [...events]
                finish.resolve()
                const result = { beforeRecovery, first: await first, second: await second, third: await third, events }
                dispose()
                return result
              }
            `
                  : undefined,
            },
          ],
        })

        await vite.listen()

        return vite
      }),
      (vite) => Effect.promise(() => vite.close()),
    )

    const browser = yield* Effect.acquireRelease(
      Effect.promise(() => chromium.launch({ headless: true })),
      (browser) => Effect.promise(() => browser.close()),
    )

    const address = server.httpServer?.address()

    assert.isDefined(address)
    assert.isNotString(address)

    if (!address || Predicate.isString(address)) return yield* Effect.die("No dev server address")

    const page = yield* Effect.promise(() => browser.newPage())
    yield* Effect.promise(() => page.goto(`http://127.0.0.1:${address.port}/@vite/client`))
    yield* Effect.promise(() =>
      page.addScriptTag({
        type: "module",
        content: `import { exercise } from "/@id/virtual:action-concurrency-test";
        window.bridgeTestResult = exercise();`,
      }),
    )
    yield* Effect.promise(() => page.waitForFunction("window.bridgeTestResult !== undefined"))
    const result = yield* Effect.promise(() => page.evaluate("window.bridgeTestResult"))

    assert.deepEqual(result, {
      beforeRecovery: ["recovery-start"],
      first: "ActionInterruptedError",
      second: "ActionInterruptedError",
      third: 42,
      events: ["recovery-start", "recovery-end", "third"],
    })
  }),
)
