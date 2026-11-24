import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import {
  builtApp,
  connectToTenant,
  mockLocalAuth,
  openedDialog,
  unauthorizedBody,
} from "./browser.ts"

it.effect(
  "builds the SPA, signs in, navigates, and changes theme",
  () =>
    Effect.gen(function* () {
      const { page, url, errors } = yield* builtApp
      yield* Effect.promise(async () => {
        await connectToTenant(
          page,
          url,
          "test-session",
          "01900000-0000-7000-8000-000000000010",
          "My work",
        )
        assert.equal(new URL(page.url()).pathname, "/")
        const before = await page.locator("main").evaluate((node) => getComputedStyle(node).color)
        await page.getByRole("button", { name: "Dark theme" }).click()
        assert.equal(
          await page.getByRole("button", { name: "Dark theme" }).getAttribute("aria-pressed"),
          "true",
        )
        assert.notEqual(
          await page.locator("main").evaluate((node) => getComputedStyle(node).color),
          before,
        )
        await page.getByRole("link", { name: "User accounts", exact: true }).click()
        await page.getByRole("heading", { name: "User accounts", exact: true }).waitFor()
        await page.goBack()
        await page.getByRole("heading", { name: "My work" }).waitFor()

        assert.isTrue(await page.getByRole("main").isVisible())
        assert.isTrue(await page.getByRole("link", { name: "RITSEI home" }).isVisible())
        assert.isTrue(await page.getByRole("navigation", { name: "Primary" }).isVisible())
        assert.isTrue(await page.getByRole("link", { name: "Access", exact: true }).isVisible())
        assert.equal(await page.title(), "RITSEI · Operational workspace")
        assert.equal(await page.locator("aside").count(), 0, "the shell has no sidebar")

        // Ctrl+K opens a palette of workspaces: it filters, and Enter goes to the first match.
        await page.keyboard.press("Control+k")
        const palette = await openedDialog(page, "Go to a workspace")
        assert.isTrue(
          await palette
            .getByRole("textbox", { name: "Filter workspaces" })
            .evaluate((element) => document.activeElement === element),
        )
        await palette.getByRole("textbox", { name: "Filter workspaces" }).fill("zzz")
        await palette.getByRole("status").waitFor()
        await palette.getByRole("textbox", { name: "Filter workspaces" }).fill("approv")
        assert.equal(await palette.getByRole("link").count(), 1)
        await page.keyboard.press("Enter")
        await page.getByRole("heading", { name: "Approvals", exact: true }).waitFor()
        assert.equal(new URL(page.url()).pathname, "/approvals")
        assert.equal(await page.getByRole("dialog").count(), 0)

        // On a phone the links sit behind a toggle, which Escape closes and returns focus to.
        const menuToggle = page.locator('button[aria-controls="primary-navigation"]')
        await page.setViewportSize({ width: 390, height: 844 })
        await page.waitForTimeout(50)
        assert.equal(await menuToggle.getAttribute("aria-expanded"), "false")
        assert.isFalse(
          await page.getByRole("link", { name: "User accounts", exact: true }).isVisible(),
        )

        await menuToggle.click()
        assert.equal(await menuToggle.getAttribute("aria-expanded"), "true")
        assert.isTrue(
          await page.getByRole("link", { name: "User accounts", exact: true }).isVisible(),
        )

        await page.keyboard.press("Escape")
        assert.equal(await menuToggle.getAttribute("aria-expanded"), "false")
        assert.isTrue(await menuToggle.evaluate((element) => document.activeElement === element))

        await page.setViewportSize({ width: 1280, height: 720 })
        await page.goto(`${url}/not-a-route`)
        await page.getByRole("heading", { name: "Page not found" }).waitFor()
        assert.deepEqual(errors, [])

        const stored = await page.evaluate(() =>
          JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]),
        )

        assert.notInclude(stored, "test-session")
        assert.notInclude(stored, "not-a-uuid")
      })
    }),
  { timeout: 120_000 },
)

it.effect(
  "switches tenants, logs out, and recovers from an expired session",
  () =>
    Effect.gen(function* () {
      const { page, url, errors } = yield* builtApp
      const firstTenant = "01900000-0000-7000-8000-000000000010"
      const secondTenant = "01900000-0000-7000-8000-000000000011"
      const sessionTenantHeaders: string[] = []
      yield* Effect.promise(async () => {
        await mockLocalAuth(page, "switch-session", firstTenant, {
          memberships: [
            {
              userAccountId: "01900000-0000-7000-8000-000000000001",
              tenantId: firstTenant,
              status: "active",
            },
            {
              userAccountId: "01900000-0000-7000-8000-000000000001",
              tenantId: secondTenant,
              status: "active",
            },
          ],
        })
        page.on("request", (request) => {
          if (new URL(request.url()).pathname === "/api/auth/session") {
            sessionTenantHeaders.push(request.headers()["x-tenant-id"] ?? "")
          }
        })
        let logoutAuthorization: string | undefined
        await page.route("**/api/auth/logout", (route) => {
          logoutAuthorization = route.request().headers().authorization

          return route.fulfill({ status: 204 })
        })

        await page.goto(url)
        await page.getByRole("button", { name: "Sign in locally", exact: true }).click()
        await page.getByRole("heading", { name: "My work", exact: true }).waitFor()
        const tenantSelect = page.getByRole("combobox", { name: "Active tenant", exact: true })

        const switched = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === "/api/auth/session" &&
            response.request().headers()["x-tenant-id"] === secondTenant,
        )

        await tenantSelect.selectOption(secondTenant)
        await switched
        assert.equal(await tenantSelect.inputValue(), secondTenant)
        assert.equal(sessionTenantHeaders.at(-1), secondTenant)

        const logoutResponse = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === "/api/auth/logout" && response.status() === 204,
        )

        await page.getByRole("button", { name: "Sign out", exact: true }).click()
        const dialog = await openedDialog(page, "Sign out of RITSEI?")
        await dialog.getByRole("button", { name: "Sign out", exact: true }).click()
        await logoutResponse
        assert.equal(logoutAuthorization, "Bearer switch-session")
        await page.getByRole("button", { name: "Sign in locally", exact: true }).waitFor()

        await page.getByRole("button", { name: "Sign in locally", exact: true }).click()
        await page.getByRole("heading", { name: "My work", exact: true }).waitFor()
        await page.route("**/api/user-accounts", (route) =>
          route.fulfill({
            status: 401,
            contentType: "application/json",
            body: JSON.stringify(unauthorizedBody()),
          }),
        )
        await page.getByRole("link", { name: "User accounts", exact: true }).click()
        await page.getByRole("button", { name: "Sign in locally", exact: true }).waitFor()
        assert.deepEqual(errors, [])
      })
    }),
  { timeout: 120_000 },
)

it.effect(
  "ignores delayed tenant switches after a newer selection or sign-out",
  () =>
    Effect.gen(function* () {
      const { page, url, errors } = yield* builtApp
      yield* Effect.promise(async () => {
        const first = "01900000-0000-7000-8000-000000000010"
        const second = "01900000-0000-7000-8000-000000000011"
        const third = "01900000-0000-7000-8000-000000000012"
        const userAccountId = "01900000-0000-7000-8000-000000000001"
        await mockLocalAuth(page, "race-session", first, {
          memberships: [first, second, third].map((tenantId) => ({
            userAccountId,
            tenantId,
            status: "active" as const,
          })),
        })
        let gate = Promise.withResolvers<void>()
        await page.route("**/api/auth/session", async (route) => {
          if (route.request().headers()["x-tenant-id"] === second) await gate.promise
          await route.fallback()
        })
        await page.route("**/api/auth/logout", (route) => route.fulfill({ status: 204 }))
        await page.goto(url)
        await page.getByRole("button", { name: "Sign in locally", exact: true }).click()
        await page.getByRole("heading", { name: "My work", exact: true }).waitFor()
        const tenant = page.getByRole("combobox", { name: "Active tenant", exact: true })

        const pendingSecond = () =>
          page.waitForRequest(
            (request) =>
              request.url().endsWith("/api/auth/session") &&
              request.headers()["x-tenant-id"] === second,
          )

        let started = pendingSecond()
        await tenant.selectOption(second)
        await started

        const thirdResponse = page.waitForResponse(
          (response) =>
            response.url().endsWith("/api/auth/session") &&
            response.request().headers()["x-tenant-id"] === third,
        )

        await tenant.selectOption(third)
        await thirdResponse
        await page.waitForFunction(
          (id) =>
            document.querySelector<HTMLSelectElement>('[aria-label="Active tenant"]')?.value === id,
          third,
        )

        const lateResponse = page.waitForResponse(
          (response) =>
            response.url().endsWith("/api/auth/session") &&
            response.request().headers()["x-tenant-id"] === second,
        )

        gate.resolve()
        await lateResponse

        const staleTenant = await page
          .waitForFunction(
            (id) =>
              document.querySelector<HTMLSelectElement>('[aria-label="Active tenant"]')?.value ===
              id,
            second,
            { timeout: 500 },
          )
          .then(
            () => true,
            () => false,
          )

        assert.isFalse(staleTenant)
        assert.equal(await tenant.inputValue(), third)

        gate = Promise.withResolvers<void>()
        started = pendingSecond()
        await tenant.selectOption(second)
        await started
        await page.getByRole("button", { name: "Sign out", exact: true }).click()
        await page
          .getByRole("dialog", { name: "Sign out of RITSEI?" })
          .getByRole("button", { name: "Sign out", exact: true })
          .click()
        await page.getByRole("button", { name: "Sign in locally", exact: true }).waitFor()

        const afterLogout = page.waitForResponse(
          (response) =>
            response.url().endsWith("/api/auth/session") &&
            response.request().headers()["x-tenant-id"] === second,
        )

        gate.resolve()
        await afterLogout

        const resurrected = await page
          .getByRole("heading", { name: "My work", exact: true })
          .waitFor({ timeout: 500 })
          .then(
            () => true,
            () => false,
          )

        assert.isFalse(resurrected)
        assert.deepEqual(errors, [])
      })
    }),
  { timeout: 120_000 },
)
