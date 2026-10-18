import { spawnSync } from "node:child_process"

import { commitSubjectError } from "./check-commit-message.ts"

const args = process.argv.slice(2)
const [base, head] = args

if (base === undefined || head === undefined || args.length !== 2) {
  console.error("usage: check-commit-range.ts <base-sha> <head-sha>")
  process.exit(2)
}

const zeroSha = /^0+$/u
const range = zeroSha.test(base) ? head : `${base}..${head}`
const result = spawnSync(
  "git",
  ["log", "--format=%H%x00%s", "--no-decorate", range],
  { encoding: "utf8" },
)

if (result.status !== 0) {
  const stderr = (result.stderr ?? "").trim()
  console.error(`Unable to inspect commit range: ${stderr}`)
  process.exit(1)
}

const commits = result.stdout.trimEnd().split(/\r?\n/u).filter(Boolean)
const failures = commits.flatMap((commit) => {
  const separator = commit.indexOf("\0")
  const sha = separator === -1 ? commit : commit.slice(0, separator)
  const subject = separator === -1 ? "" : commit.slice(separator + 1)
  const error = commitSubjectError(subject)
  return error === undefined ? [] : [`${sha}: ${error}`]
})

if (failures.length > 0) {
  console.error(failures.join("\n"))
  process.exit(1)
}

console.log(`Validated ${commits.length} commit subject${commits.length === 1 ? "" : "s"}.`)
