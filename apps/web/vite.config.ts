import solid from "@solidjs/vite-plugin"
import { defineConfig } from "vite"

// Absolute so the build works regardless of the invoking directory:
// the repository root stays the CWD for scripted builds (see tooling scripts).
export default defineConfig({
  root: import.meta.dirname,
  plugins: [solid()],
  resolve: { dedupe: ["solid-js"] },
  server: {
    host: "127.0.0.1",
    // Development only. Production needs a same-origin /api reverse proxy.
    proxy: { "/api": { target: "http://127.0.0.1:8000", rewrite: (path) => path.slice(4) } },
  },
  build: { target: "es2022", sourcemap: false },
})
