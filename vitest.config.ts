import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: [
      "apps/**/*.test.{ts,tsx}",
      "framework/**/*.test.{ts,tsx}",
      "erp/**/*.test.{ts,tsx}",
      "extensions/**/*.test.{ts,tsx}",
      "tests/**/*.test.{ts,tsx}",
    ],
    setupFiles: ["./tooling/load-env.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    exclude: ["vendor/**", "**/node_modules/**", ".auto/**"],
  },
})
