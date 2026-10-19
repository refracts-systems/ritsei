import { defineConfig } from "vitest/config"

// Browser tests that use tests/frontend/browser.ts share one web build from the global setup.
const frontendTests = ["tests/frontend/**/*.test.{ts,tsx}", "apps/web/src/ui/accessibility.test.ts"]

export default defineConfig({
  test: {
    setupFiles: ["./tooling/load-env.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    exclude: ["vendor/**", "**/node_modules/**", ".auto/**"],
    projects: [
      {
        extends: true,
        test: {
          name: "repository",
          include: [
            "apps/**/*.test.{ts,tsx}",
            "foundation/**/*.test.{ts,tsx}",
            "modules/**/*.test.{ts,tsx}",
            "platform/**/*.test.{ts,tsx}",
            "runtime/**/*.test.{ts,tsx}",
            "tests/**/*.test.{ts,tsx}",
          ],
          exclude: frontendTests,
        },
      },
      {
        extends: true,
        test: {
          name: "frontend",
          include: frontendTests,
          globalSetup: ["./tests/frontend/global-setup.ts"],
        },
      },
    ],
  },
})
