import { spawnSync } from "node:child_process"

// Regenerates contracts and Panda output and type-checks the web app once per
// test run. Browser tests then bundle with `vite build` only: the generators
// rewrite files in place, so running them per test lets one worker's bundle
// read a module another worker is still writing.
export default function setup(): void {
  const output = spawnSync("pnpm", ["--dir", "apps/web", "run", "check"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  })
  if (output.status !== 0) {
    throw new Error(`apps/web check failed\n${output.stdout}${output.stderr}`)
  }
}
