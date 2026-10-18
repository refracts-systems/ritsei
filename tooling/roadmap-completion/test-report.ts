const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

// A passed suite with no executed assertions (or with pending assertions) is not evidence.
export const parsePassedTestFiles = (text: string | undefined): ReadonlySet<string> => {
  try {
    const report: unknown = JSON.parse(text?.slice(text.indexOf("{")) ?? "")
    if (!isRecord(report) || !Array.isArray(report.testResults)) return new Set()
    const passed = new Set<string>()
    const seen = new Set<string>()
    for (const suite of report.testResults) {
      if (
        !isRecord(suite) ||
        typeof suite.name !== "string" ||
        suite.name.trim() === "" ||
        typeof suite.status !== "string" ||
        !Array.isArray(suite.assertionResults) ||
        !suite.assertionResults.every(
          (assertion: unknown) => isRecord(assertion) && typeof assertion.status === "string",
        )
      )
        return new Set()
      const name = suite.name.replaceAll("\\", "/")
      if (seen.has(name)) return new Set()
      seen.add(name)
      if (
        suite.status === "passed" &&
        suite.assertionResults.length > 0 &&
        suite.assertionResults.every((assertion) => assertion.status === "passed")
      )
        passed.add(name)
    }
    return passed
  } catch {
    return new Set()
  }
}
