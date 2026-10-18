import { spawnSync } from "node:child_process"
import { readdir, stat } from "node:fs/promises"

const testFilePattern = /\.(?:test|spec)\.(?:ts|tsx)$/
const sourceFilePattern = /\.(?:ts|tsx|js|jsx)$/
const broadTestTriggers = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "vitest.config.ts",
  "vitest.contract.config.ts",
])

const notFound = (cause: unknown) => (cause as NodeJS.ErrnoException).code === "ENOENT"

const normalizePath = (path: string) => path.replaceAll("\\", "/")
const isTestFile = (path: string) => testFilePattern.test(path)
const isSourceFile = (path: string) => sourceFilePattern.test(path)
const isExperiment = (path: string) => path.startsWith("apps/web/src/experiments/solid-effect/")

const gitFiles = async (args: readonly string[]): Promise<readonly string[]> => {
  const result = spawnSync("git", [...args], { encoding: "utf8" })

  if (result.status !== 0) {
    throw new Error(result.stderr ?? "")
  }

  return result.stdout.split("\n").map(normalizePath).filter(Boolean)
}

const changedFiles = async (provided: readonly string[]): Promise<readonly string[]> => {
  if (provided.length > 0) return [...new Set(provided.map(normalizePath))].toSorted()

  const [tracked, untracked] = await Promise.all([
    gitFiles(["diff", "--name-only", "--diff-filter=ACDMRT", "HEAD", "--"]),
    gitFiles(["ls-files", "--others", "--exclude-standard"]),
  ])
  return [...new Set([...tracked, ...untracked])].toSorted()
}

const collectTests = async (root: string): Promise<readonly string[]> => {
  const result: string[] = []

  const visit = async (directory: string): Promise<void> => {
    try {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = `${directory}/${entry.name}`
        if (isExperiment(path + "/")) continue
        if (entry.isDirectory()) await visit(path)
        else if (entry.isFile() && isTestFile(path)) result.push(path)
      }
    } catch (cause) {
      if (!notFound(cause)) throw cause
    }
  }

  await visit(root)
  return result.toSorted()
}

const run = (args: readonly string[], dryRun: boolean): void => {
  console.log(`$ ${args.join(" ")}`)
  if (dryRun) return

  // pnpm resolves through pnpm.cmd on Windows, so it needs a shell there;
  // every caller only spawns pnpm.
  const result = spawnSync(args[0]!, [...args.slice(1)], {
    stdio: "inherit",
    shell: process.platform === "win32",
  })

  if (result.status !== 0) process.exit(result.status ?? 1)
}

const args = [...process.argv.slice(2)]
const dryRun = args.includes("--dry-run")
const providedFiles = args.filter((arg) => arg !== "--dry-run")
const files = await changedFiles(providedFiles)

if (files.length === 0) {
  console.log("No changed files; skipped affected checks.")
  process.exit(0)
}

const packageNames = new Set<string>()
const appNames = new Set<string>()
const componentRoots = new Set<string>()
const tests = new Set<string>()
const relatedSources = new Set<string>()
let rootAppChanged = false
let fullSuite = false
let skillsChanged = false

for (const path of files) {
  if (isExperiment(path)) continue

  if (
    path === "AGENTS.md"
    || path === "tooling/check-agent-skills.ts"
    || path.startsWith(".agents/skills/")
  ) {
    skillsChanged = true
  }

  if (broadTestTriggers.has(path) || path.startsWith("db/") || path === "drizzle.config.ts") {
    fullSuite = true
    continue
  }

  if (path.startsWith("modules/")) {
    const match = path.match(/^modules\/([^/]+)\//)
    if (match === null) continue

    if (isTestFile(path)) tests.add(path)
    else if (isSourceFile(path) || path.includes("/tests/")) {
      packageNames.add(match[1]!)
      if (path.endsWith("/mod.ts")) relatedSources.add(path)
    }
    continue
  }

  if (
    path.startsWith("foundation/") || path.startsWith("platform/") || path.startsWith("runtime/")
  ) {
    if (isTestFile(path)) tests.add(path)
    else componentRoots.add(path.split("/")[0]!)
    continue
  }

  if (path.startsWith("apps/web/")) {
    appNames.add("web")
    for (const test of await collectTests("tests/frontend")) tests.add(test)
    continue
  }

  if (path.startsWith("apps/")) {
    if (isTestFile(path)) tests.add(path)
    else if (isSourceFile(path)) {
      const match = path.match(/^apps\/([^/]+)\//)
      if (match === null) rootAppChanged = true
      else appNames.add(match[1]!)
    }
    continue
  }

  if (path.startsWith("tooling/")) {
    if (isTestFile(path)) tests.add(path)
    else if (path === "tooling/load-env.ts") fullSuite = true
    else {
      for (const test of await collectTests("tests/architecture")) tests.add(test)
    }
    continue
  }

  if (path.startsWith("tests/") && isTestFile(path)) {
    tests.add(path)
    continue
  }

  if (path.startsWith("tests/")) fullSuite = true
}

for (const packageName of packageNames) {
  if (!relatedSources.has(`modules/${packageName}/mod.ts`)) {
    for (const path of await collectTests(`modules/${packageName}/tests`)) tests.add(path)
  }
}

for (const appName of appNames) {
  for (const path of await collectTests(`apps/${appName}`)) tests.add(path)
}

if (rootAppChanged) {
  for (const path of await collectTests("apps")) tests.add(path)
}

for (const root of componentRoots) {
  for (const path of await collectTests(root)) tests.add(path)
}

// Deleted tests can select a scope, but must never become Vitest file filters.
for (const test of tests) {
  try {
    await stat(test)
  } catch (cause) {
    if (!notFound(cause)) throw cause
    tests.delete(test)
  }
}

if (skillsChanged) await run(["pnpm", "run", "skills:check"], dryRun)

if (fullSuite) {
  console.log("Broad repository change; running the full test suite.")
  await run(["pnpm", "run", "test"], dryRun)
} else {
  if (relatedSources.size > 0) {
    console.log(
      `Public package change; running related tests for ${[...relatedSources].join(", ")}.`,
    )
    await run(["pnpm", "run", "test:related", ...[...relatedSources].toSorted()], dryRun)
  }

  if (tests.size > 0) {
    const scope = packageNames.size > 1
      ? `cross-package (${[...packageNames].toSorted().join(", ")})`
      : "affected"
    console.log(`Running ${scope} tests (${tests.size} files).`)
    await run(["pnpm", "run", "test", ...[...tests].toSorted()], dryRun)
  } else if (relatedSources.size === 0) {
    console.log("No affected tests; skipped Vitest.")
  }
}
