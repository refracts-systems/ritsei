import { spawnSync } from "node:child_process"
import { readFile } from "node:fs/promises"

const tag = process.argv.slice(2)[0]
  ?? process.env["RELEASE_TAG"]
  ?? process.env["GITHUB_REF_NAME"]

if (!tag || !/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(tag)) {
  throw new Error("release tag must match vX.Y.Z")
}

const runGit = async (...args: string[]) => {
  const result = spawnSync("git", args, { encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(
      (result.stderr ?? "").trim() || `git ${args.join(" ")} failed`,
    )
  }
  return result.stdout.trim()
}

const tagObjectType = await runGit("cat-file", "-t", `refs/tags/${tag}`)
if (tagObjectType !== "tag") {
  throw new Error(`${tag} must be an annotated tag`)
}

const target = await runGit("rev-parse", "--verify", `${tag}^{}`)
if ((await runGit("cat-file", "-t", target)) !== "commit") {
  throw new Error(`${tag} must target a commit`)
}

const expectedTarget = process.env["RELEASE_EXPECTED_TARGET"]
if (expectedTarget && target !== expectedTarget) {
  throw new Error(`${tag} targets ${target}, expected ${expectedTarget}`)
}

const releaseBaseRef = process.env["RELEASE_BASE_REF"]
if (releaseBaseRef !== undefined) {
  const base = await runGit("rev-parse", "--verify", releaseBaseRef)
  if (await runGit("merge-base", base, target) !== target) {
    throw new Error(`${tag} target ${target} is not contained in ${releaseBaseRef}`)
  }
}

const releaseNotes = `.github/release-notes/${tag}.md`
const notesRef = process.env["RELEASE_NOTES_REF"]
const notes = notesRef === undefined
  ? await readFile(releaseNotes, "utf8")
  : await runGit("show", `${notesRef}:${releaseNotes}`)

if (!notes.trim()) {
  throw new Error(`${releaseNotes} must not be empty`)
}
if (!notes.includes(`# RITSEI ${tag}`)) {
  throw new Error(`${releaseNotes} must identify ${tag}`)
}

for (const marker of ["pre-release", "source-only", "migration", "upgrade"]) {
  if (!notes.toLowerCase().includes(marker)) {
    throw new Error(`${releaseNotes} must mention ${marker}`)
  }
}

console.log(`release metadata check passed: ${tag} -> ${target} (${releaseNotes})`)
