import { readFile } from "node:fs/promises"

import { isMain } from "./entrypoint.ts"

const subjectPattern =
  /^(feat|fix|docs|refactor|perf|test|build|ci|chore|style|revert)(\([a-z0-9-]+\))?!?: [a-z][^\r\n]*$/u

export const isValidCommitSubject = (subject: string): boolean =>
  subjectPattern.test(subject) && subject.length <= 72 && !subject.endsWith(".")

export const commitSubjectError = (subject: string): string | undefined =>
  isValidCommitSubject(subject)
    ? undefined
    : [
        "Invalid commit subject.",
        "Expected <type>(<optional-scope>)!: <lowercase imperative summary>.",
        "Allowed types: feat, fix, docs, refactor, perf, test, build, ci, chore, style, revert.",
        "Keep the subject at most 72 characters and omit a trailing period.",
        "For breaking changes, add ! and a BREAKING CHANGE: footer.",
      ].join("\n")

if (isMain(import.meta.url)) {
  const [messagePath] = process.argv.slice(2)

  if (messagePath === undefined) {
    console.error("usage: check-commit-message.ts <commit-message-file>")
    process.exit(2)
  }

  const subject = (await readFile(messagePath, "utf8")).split(/\r?\n/u, 1)[0] ?? ""
  const error = commitSubjectError(subject)

  if (error !== undefined) {
    console.error(error)
    process.exit(1)
  }
}
