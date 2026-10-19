import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: [
      "framework/modules/**/tests/**/*.test.{ts,tsx}",
      "erp/modules/**/tests/**/*.test.{ts,tsx}",
      "framework/foundation/**/tests/**/*.test.{ts,tsx}",
      "framework/platform/**/tests/**/*.test.{ts,tsx}",
      "erp/runtime/**/*.test.{ts,tsx}",
      "tests/architecture/**/*.test.{ts,tsx}",
    ],
    setupFiles: ["./tooling/load-env.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    exclude: ["vendor/**", "**/node_modules/**", ".auto/**"],
  },
})
