import { spawnSync } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { TestProject } from "vitest/node"

declare module "vitest" {
  export interface ProvidedContext {
    readonly webOutDir: string
  }
}

// Build the web app once per run. Building it in every browser test regenerated contracts and
// Panda output concurrently and starved parallel workers past their timeouts.
export default async function setup(project: TestProject) {
  const outDir = await mkdtemp(join(tmpdir(), "ritsei-web-"))
  const isWindows = process.platform === "win32"

  const output = spawnSync(
    "pnpm",
    ["--dir", "apps/web", "build", "--outDir", isWindows ? `"${outDir}"` : outDir],
    { encoding: "utf8", shell: isWindows },
  )

  if (output.status !== 0) {
    await rm(outDir, { recursive: true })
    throw new Error(`Web build failed:\n${output.stdout}${output.stderr}`)
  }

  project.provide("webOutDir", outDir)

  return () => rm(outDir, { recursive: true })
}
