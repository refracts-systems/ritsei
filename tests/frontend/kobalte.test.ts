import { AxeBuilder } from "@axe-core/playwright"
import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import type { Page } from "playwright"
import { builtApp, connectToTenant } from "./browser.ts"

const focusIsInsideDialog = (page: Page) =>
  page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)

// A dialog fades in; a contrast scan taken during the fade reads the half-transparent text.
const entranceFinished = (page: Page) =>
  page.evaluate(() =>
    Promise.all(document.getAnimations().map((animation) => animation.finished)).then(() => true),
  )

it.effect(
  "validates the RITSEI Kobalte dialog wrapper in the application",
  () =>
    Effect.gen(function* () {
      const { page, url, errors } = yield* builtApp
      yield* Effect.promise(async () => {
        await connectToTenant(
          page,
          url,
          "token",
          "018f0f2a-7b1d-7b1d-8b1d-7b1d7b1d7b1d",
          "User accounts",
        )

        // Opened from the keyboard, the dialog takes focus and keeps it.
        const trigger = page.getByRole("button", { name: "Sign out", exact: true })
        await trigger.focus()
        await page.keyboard.press("Enter")
        const dialog = page.getByRole("dialog", { name: "Sign out of RITSEI?" })
        await dialog.waitFor()
        assert.isTrue(await dialog.isVisible())
        assert.isNotNull(await dialog.getAttribute("aria-labelledby"))
        assert.isNotNull(await dialog.getAttribute("aria-describedby"))
        assert.isTrue(await focusIsInsideDialog(page))
        await page.keyboard.press("Tab")
        assert.isTrue(await focusIsInsideDialog(page))
        await page.keyboard.press("Shift+Tab")
        assert.isTrue(await focusIsInsideDialog(page))
        assert.deepEqual(
          (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations,
          [],
        )

        // Escape closes it and returns focus to the control that opened it.
        await page.keyboard.press("Escape")
        await dialog.waitFor({ state: "hidden" })
        await page.waitForFunction(() => document.activeElement?.textContent === "Sign out")
        assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Sign out")

        // It stays usable and accessible with reduced motion and forced colors.
        await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" })
        await trigger.click()
        await dialog.waitFor()
        assert.isTrue(await dialog.isVisible())
        assert.isTrue(await entranceFinished(page))
        assert.deepEqual(
          (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations,
          [],
        )
        await page.keyboard.press("Escape")
        await dialog.waitFor({ state: "hidden" })
        await page.emulateMedia({ reducedMotion: null, forcedColors: null })

        await trigger.click()
        await dialog.getByRole("button", { name: "Sign out", exact: true }).click()
        assert.isFalse(
          await page.getByRole("button", { name: "Sign out", exact: true }).isVisible(),
        )
        assert.isTrue(await page.getByRole("heading", { name: "Sign in to RITSEI" }).isVisible())
        assert.deepEqual(errors, [])
      })
    }),
  { timeout: 120_000 },
)
