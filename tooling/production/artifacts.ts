import { spawnSync } from "node:child_process"
import { copyFile, mkdir, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

// Keep gate comparisons portable: Windows `realpath` returns backslash-separated paths.
const toPosixPath = (value: string) => value.replace(/\\/gu, "/")

type ArtifactFile = {
  readonly path: string
  readonly size: number
  readonly sha256: string
}

type Artifact = {
  readonly id: string
  readonly kind: "node-bundle" | "migration-assets" | "vite-dist"
  readonly source: string
  readonly path: string
  readonly files: readonly ArtifactFile[]
}

const root = toPosixPath(resolve())
const revision = await run("git", ["rev-parse", "HEAD"])
const output = process.argv.slice(2)[0] ?? `deploy/artifacts/output/${revision}`
const outputPath = toPosixPath(await realpath(await ensureDirectory(output)))
if (!outputPath.startsWith(`${root}/deploy/artifacts/`)) {
  throw new Error("artifact output must remain under deploy/artifacts/")
}
await rm(outputPath, { recursive: true })
await mkdir(outputPath, { recursive: true })

const bundles = [
  ["api", "runtime/api/mod.ts"],
  ["worker", "runtime/worker/mod.ts"],
  ["migrator", "runtime/migrator/mod.ts"],
] as const
for (const [name, entrypoint] of bundles) {
  await run("pnpm", [
    "exec",
    "esbuild",
    entrypoint,
    "--bundle",
    "--platform=node",
    "--format=esm",
    `--outfile=${outputPath}/${name}.js`,
  ])
}

await copyTree("db/migrations", `${outputPath}/migrations`)
await run("pnpm", [
  "--filter",
  "@ritsei/web",
  "run",
  "build",
  "--outDir",
  `${outputPath}/frontend`,
])

const artifacts: Artifact[] = []
for (const [name, entrypoint] of bundles) {
  artifacts.push({
    id: name,
    kind: "node-bundle",
    source: entrypoint,
    path: relativeToRoot(`${outputPath}/${name}.js`),
    files: [await describeFile(`${outputPath}/${name}.js`)],
  })
}
artifacts.push({
  id: "migrations",
  kind: "migration-assets",
  source: "db/migrations",
  path: relativeToRoot(`${outputPath}/migrations`),
  files: await describeTree(`${outputPath}/migrations`),
})
artifacts.push({
  id: "frontend",
  kind: "vite-dist",
  source: "apps/web",
  path: relativeToRoot(`${outputPath}/frontend`),
  files: await describeTree(`${outputPath}/frontend`),
})

const manifest = {
  schemaVersion: 1,
  sourceRevision: revision,
  lockfile: {
    path: "pnpm-lock.yaml",
    sha256: await hashFile("pnpm-lock.yaml"),
  },
  toolchain: {
    node: await run("node", ["--version"]),
    esbuild: await run("pnpm", ["exec", "esbuild", "--version"]).then((v) =>
      v.split("\n").at(-1) ?? v
    ),
    frontend: "Vite via pnpm --filter @ritsei/web run build",
  },
  build: {
    commands: [
      "pnpm exec esbuild --bundle --platform=node --format=esm runtime/api/mod.ts",
      "pnpm exec esbuild --bundle --platform=node --format=esm runtime/worker/mod.ts",
      "pnpm exec esbuild --bundle --platform=node --format=esm runtime/migrator/mod.ts",
      "pnpm --filter @ritsei/web run build",
    ],
    migrations: "db/migrations is copied beside the migrator bundle",
  },
  artifacts,
  sourceOnlyCaveat:
    "Historical source-only tags remain source-only; this manifest describes the artifact-backed build path.",
}
await mkdir("deploy/artifacts", { recursive: true })
await writeFile(
  "deploy/artifacts/manifest.json",
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
)
console.log(JSON.stringify({ sourceRevision: revision, artifactRoot: relativeToRoot(outputPath) }))

async function run(command: string, args: readonly string[]): Promise<string> {
  const result = spawnSync(command, [...args], {
    encoding: "utf8",
    // pnpm resolves through pnpm.cmd on Windows, so it needs a shell there;
    // git resolves natively.
    shell: process.platform === "win32" && (command === "pnpm" || command === "npx"),
  })
  const stdout = (result.stdout ?? "").trim()
  if (result.status !== 0) {
    const stderr = (result.stderr ?? "").trim()
    throw new Error(`${command} ${args.join(" ")} failed: ${stderr || stdout}`)
  }
  return stdout
}

async function ensureDirectory(path: string): Promise<string> {
  await mkdir(path, { recursive: true })
  return path
}

async function copyTree(source: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true })
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourcePath = `${source}/${entry.name}`
    const destinationPath = `${destination}/${entry.name}`
    if (entry.isDirectory()) {
      await copyTree(sourcePath, destinationPath)
    } else if (entry.isFile()) {
      await copyFile(sourcePath, destinationPath)
    }
  }
}

async function describeTree(directory: string, relative = ""): Promise<ArtifactFile[]> {
  const files: ArtifactFile[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`
    const child = relative === "" ? entry.name : `${relative}/${entry.name}`
    if (entry.isDirectory()) {
      files.push(...await describeTree(path, child))
    } else if (entry.isFile()) {
      files.push({
        path: child,
        size: (await stat(path)).size ?? 0,
        sha256: await hashFile(path),
      })
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path))
}

async function describeFile(path: string): Promise<ArtifactFile> {
  return {
    path: path.slice(path.lastIndexOf("/") + 1),
    size: (await stat(path)).size ?? 0,
    sha256: await hashFile(path),
  }
}

async function hashFile(path: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await readFile(path))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function relativeToRoot(path: string): string {
  if (!path.startsWith(`${root}/`)) throw new Error(`path is outside repository: ${path}`)
  return path.slice(root.length + 1)
}
