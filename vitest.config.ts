import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: [
      "apps/**/*.test.{ts,tsx}",
      "foundation/**/*.test.{ts,tsx}",
      "modules/**/*.test.{ts,tsx}",
      "platform/**/*.test.{ts,tsx}",
      "runtime/**/*.test.{ts,tsx}",
      "tests/**/*.test.{ts,tsx}",
    ],
    globalSetup: ["./tooling/frontend/global-setup.ts"],
    setupFiles: ["./tooling/load-env.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    exclude: ["vendor/**", "**/node_modules/**", ".auto/**"],
  },
})
