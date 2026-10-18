import solid from "@solidjs/vite-plugin"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [solid()],
  resolve: { dedupe: ["solid-js"] },
  server: { port: 3007 },
  preview: { port: 3007 },
})
