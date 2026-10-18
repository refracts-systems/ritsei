import { spawnSync } from "node:child_process"
import { lstatSync, readFileSync, statSync } from "node:fs"
import { readdir, readFile, stat } from "node:fs/promises"

import { evaluateFinancialManifest } from "../financial-gate.ts"
import { collectSourceFiles } from "../source-files.ts"
import { evaluateFrontendEvidence, frontendEvidence } from "./frontend-evidence.ts"
import {
  type Gate,
  type GateCommand,
  gateIds,
  type GateRequirement,
  gates,
  roadmapTracks,
} from "./registry.ts"
import { parsePassedTestFiles } from "./test-report.ts"

type GateResult = {
  readonly gate: Gate
  readonly passed: boolean
  readonly reason: string
}

const readText = async (path: string): Promise<string | undefined> => {
  try {
    return await readFile(path, "utf8")
  } catch {
    return undefined
  }
}

const readRequirement = async (requirement: GateRequirement): Promise<string | undefined> => {
  try {
    const info = await stat(requirement.path)
    if (info.isFile()) return await readFile(requirement.path, "utf8")
    if (!info.isDirectory()) return undefined

    const files = await collectSourceFiles(requirement.path)
    return files.map(({ source }) => source).join("\n")
  } catch {
    return undefined
  }
}

const markersPass = async (requirements: readonly GateRequirement[]): Promise<boolean> => {
  for (const requirement of requirements) {
    const text = await readRequirement(requirement)
    if (text === undefined) return false
    if (!(requirement.markers ?? []).every((marker) => text.includes(marker))) return false
  }
  return true
}

const gateTestFiles = (gate: Gate): readonly string[] => {
  if (
    (gate.commands ?? []).some((command) =>
      command.args[0] !== "task" || command.args[1] !== "test"
    )
  ) {
    throw new Error(`${gate.id} must use targeted pnpm run test commands`)
  }
  return (gate.commands ?? []).flatMap((command: GateCommand) => command.args.slice(2))
}

const collectTestFiles = (gates: readonly Gate[]) => {
  const filesByGate = new Map<string, readonly string[]>()
  const files = new Set<string>()
  for (const gate of gates) {
    const testFiles = gateTestFiles(gate)
    if (testFiles.length === 0) continue
    filesByGate.set(gate.id, testFiles)
    for (const file of testFiles) files.add(file)
  }
  return { filesByGate, files }
}

const testFilePassed = (passedFiles: ReadonlySet<string>, file: string) =>
  [...passedFiles].some((name) => name === file || name.endsWith(`/${file}`))

// ponytail: batch targeted Vitest gates; add per-command adapters if roadmap gates need other executables.
const testGateResults = async (gates: readonly Gate[]): Promise<Map<string, boolean>> => {
  const { filesByGate, files } = collectTestFiles(gates)
  if (files.size === 0) return new Map()

  const result = spawnSync(
    "pnpm",
    ["run", "test", "--reporter=json", ...files],
    {
      encoding: "utf8",
      shell: process.platform === "win32",
    },
  )
  const passedFiles = parsePassedTestFiles(result.stdout)
  return new Map(
    [...filesByGate].map(([id, testFiles]) => [
      id,
      result.status === 0 && testFiles.every((file) => testFilePassed(passedFiles, file)),
    ]),
  )
}

const readRoadmapFiles = async (): Promise<readonly string[]> => {
  const files: string[] = []
  for (const entry of await readdir("docs/roadmap", { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md") {
      files.push(`docs/roadmap/${entry.name}`)
    }
  }
  return files
}

const buildGateOwners = () => {
  const owners = new Map<string, string[]>()
  for (const track of roadmapTracks) {
    for (const gateId of track.gateIds) {
      owners.set(gateId, [...(owners.get(gateId) ?? []), track.id])
    }
  }
  return owners
}

const duplicateValues = (values: readonly string[]) =>
  values.filter((value, index) => values.indexOf(value) !== index)

const invalidRoadmapDocuments = async (): Promise<readonly string[]> => {
  const invalid: string[] = []
  for (const track of roadmapTracks) {
    const text = await readText(track.path)
    const markers = [`> **Track ID:** \`${track.id}\``, "## Measures", "## Stop conditions"]
    if (text !== undefined && markers.some((marker) => !text.includes(marker))) {
      invalid.push(track.path)
    }
  }
  return invalid
}

const validateRoadmapTracks = async () => {
  const roadmapFiles = await readRoadmapFiles()
  const registeredPaths = new Set(roadmapTracks.map((track) => track.path))
  const registeredGateIds = new Set(gateIds)
  const gateOwners = buildGateOwners()
  const duplicateGateOwners = [...gateOwners].filter(([, owners]) => owners.length > 1)
  const duplicateTrackIds = duplicateValues(roadmapTracks.map(({ id }) => id))
  const duplicateTrackPaths = duplicateValues(roadmapTracks.map(({ path }) => path))
  const failures = [
    ...roadmapFiles.filter((path) => !registeredPaths.has(path)).map((path) =>
      `unregistered roadmap file: ${path}`
    ),
    ...roadmapTracks.filter((track) => !roadmapFiles.includes(track.path)).map((track) =>
      `missing roadmap file: ${track.path}`
    ),
    ...roadmapTracks.flatMap((track) =>
      track.gateIds.filter((id) => !registeredGateIds.has(id)).map((id) =>
        `unknown roadmap gate: ${track.id}:${id}`
      )
    ),
    ...gateIds.filter((id) => id !== "roadmap.global-exit" && !gateOwners.has(id)).map((id) =>
      `unassigned roadmap gate: ${id}`
    ),
    ...duplicateGateOwners.map(([id, owners]) =>
      `roadmap gate ${id} has multiple owners: ${owners.join(", ")}`
    ),
    ...duplicateTrackIds.map((id) => `duplicate roadmap track ID: ${id}`),
    ...duplicateTrackPaths.map((path) => `duplicate roadmap track path: ${path}`),
    ...(await invalidRoadmapDocuments()).map((path) =>
      `roadmap document missing required metadata: ${path}`
    ),
  ]
  if (failures.length > 0) throw new Error(failures.join("\n"))
}

await validateRoadmapTracks()

const runDomainMeasure = async (): Promise<Map<string, boolean>> => {
  const output = spawnSync("tsx", ["tooling/domain-maturity/measure.ts"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  })
  const stdout = output.stdout
  const stderr = output.stderr
  if (output.status !== 0) console.error(stderr)
  const results = new Map<string, boolean>()
  for (const gate of gates) {
    if (gate.kind !== "domain" || gate.domain === undefined) continue
    results.set(
      gate.domain,
      output.status === 0 && new RegExp(`^PASS ${gate.domain} `, "m").test(stdout),
    )
  }
  return results
}

const readFinancialResults = async (): Promise<Map<string, boolean>> => {
  const manifestText = await readText(
    "docs/operations/financial-readiness-evidence-2026-08-18.json",
  )
  if (manifestText === undefined) throw new Error("Financial readiness evidence is missing")

  const evaluation = evaluateFinancialManifest(JSON.parse(manifestText))
  return new Map(evaluation.gates.map(({ gate, passes }) => [gate.id, passes]))
}

const frontendProofExists = (path: string): boolean => {
  try {
    const parts = path.split("/")
    for (let index = 1; index <= parts.length; index++) {
      if (lstatSync(parts.slice(0, index).join("/")).isSymbolicLink()) return false
    }
    return statSync(path).isFile() && readFileSync(path, "utf8").trim().length > 0
  } catch {
    return false
  }
}

const frontendResults = new Map<string, boolean>()
for (const [id, evidence] of Object.entries(frontendEvidence)) {
  frontendResults.set(
    id,
    evaluateFrontendEvidence(await readText(evidence.path), evidence.checks, frontendProofExists, {
      riskPolicy: evidence.riskPolicy,
      fileExists: frontendProofExists,
    }),
  )
}

const domainResults = await runDomainMeasure()
const financialResults = await readFinancialResults()
const executableGateResults = await testGateResults(gates)
const results = new Map<string, GateResult>()

for (const gate of gates) {
  const dependencies = gate.dependencies ?? []
  const dependenciesPassed = dependencies.every((id) => results.get(id)?.passed === true)
  if (gate.kind === "domain") {
    const passed = dependenciesPassed && domainResults.get(gate.domain!) === true
    results.set(gate.id, {
      gate,
      passed,
      reason: passed ? "domain-maturity measure passed" : "domain-maturity measure failed",
    })
    continue
  }
  if (gate.kind === "financial") {
    const passed = dependenciesPassed && financialResults.get(gate.financialId!) === true
    results.set(gate.id, {
      gate,
      passed,
      reason: passed ? "financial evidence accepted" : "financial evidence is incomplete",
    })
    continue
  }
  if (gate.kind === "markers") {
    const markers = dependenciesPassed && await markersPass(gate.requirements ?? [])
    const commands = markers
      && (gate.commands === undefined || gate.commands.length === 0
        || executableGateResults.get(gate.id) === true)
    const evidence = frontendResults.get(gate.id) ?? true
    const passed = markers && commands && evidence
    results.set(gate.id, {
      gate,
      passed,
      reason: !dependenciesPassed
        ? "dependent gates remain incomplete"
        : !markers
        ? "required evidence is missing"
        : !commands
        ? "required executable checks failed"
        : !evidence
        ? "frontend review evidence is blocked or incomplete"
        : (gate.commands?.length ?? 0) > 0
        ? "required evidence and executable checks passed"
        : "required implementation evidence is present",
    })
    continue
  }
  const passed = dependencies.length > 0 && dependenciesPassed
  results.set(gate.id, {
    gate,
    passed,
    reason: passed ? "all dependent gates passed" : "dependent gates remain incomplete",
  })
}

for (const result of results.values()) {
  console.log(`${result.passed ? "PASS" : "OPEN"} ${result.gate.id} — ${result.gate.title}`)
  if (!result.passed) console.log(`  ${result.reason}`)
}

const registeredCompleted = [...results.values()].filter((result) => result.passed).length
const globalGate = gates.find((gate) => gate.id === "roadmap.global-exit")!
const globalCompleted =
  globalGate.dependencies?.filter((id) => results.get(id)?.passed === true).length ?? 0
const globalRemaining = (globalGate.dependencies?.length ?? 0) - globalCompleted
const globalPassed = results.get(globalGate.id)?.passed === true
const level3 = gates.filter((gate) => gate.kind === "domain" && results.get(gate.id)?.passed).length
const processGates = gates.filter((gate) => gate.id.startsWith("process."))
const integrationGates = gates.filter((gate) => gate.id.startsWith("integration."))
const partialText = await readText("docs/roadmap/domain-maturity.md") ?? ""
const partialCommittedPackages = [...partialText.matchAll(/^\| `[^`]+`[^\n]*\bPARTIAL\b/gm)].length
const unknownText = await readText("docs/roadmap/erp-primitives.md") ?? ""
const openUnknownDecisions = [...unknownText.matchAll(/^\|[^\n]*\b`UNKNOWN`\b/gm)].length
const financialRemaining =
  gates.filter((gate) => gate.kind === "financial" && results.get(gate.id)?.passed !== true).length
const processRemaining = processGates.filter((gate) => results.get(gate.id)?.passed !== true).length
const integrationRemaining =
  integrationGates.filter((gate) => results.get(gate.id)?.passed !== true).length
const businessPackRemaining = roadmapTracks.find((track) => track.id === "packs")?.gateIds.filter(
  (id) => results.get(id)?.passed !== true,
).length ?? 0
const postgres19Remaining =
  roadmapTracks.find((track) => track.id === "postgres19")?.gateIds.filter(
    (id) => results.get(id)?.passed !== true,
  ).length ?? 0

console.log(`METRIC roadmap_tracks=${roadmapTracks.length}`)
console.log("METRIC unregistered_roadmap_tracks=0")
console.log("METRIC unassigned_roadmap_gates=0")
for (const track of roadmapTracks) {
  const trackCompleted = track.gateIds.filter((id) => results.get(id)?.passed === true).length
  console.log(`METRIC ${track.id}_gates_completed=${trackCompleted}`)
  console.log(`METRIC ${track.id}_gates_remaining=${track.gateIds.length - trackCompleted}`)
}
console.log(`METRIC registered_gates_completed=${registeredCompleted}`)
console.log(`METRIC registered_gates_remaining=${gates.length - registeredCompleted}`)
console.log(`METRIC roadmap_global_exit=${globalPassed ? "PASS" : "OPEN"}`)
console.log(`METRIC roadmap_exit_gates_completed=${globalCompleted}`)
console.log(`METRIC remaining_roadmap_exit_gates=${globalRemaining}`)
console.log(`METRIC level3_capabilities=${level3}`)
console.log(`METRIC partial_committed_packages=${partialCommittedPackages}`)
console.log(`METRIC open_unknown_decisions=${openUnknownDecisions}`)
console.log(`METRIC financial_activation_gates_remaining=${financialRemaining}`)
console.log(`METRIC process_studio_mechanical_gates_remaining=${processRemaining}`)
console.log(`METRIC integration_surface_gates_remaining=${integrationRemaining}`)
console.log(`METRIC business_pack_contract_gates_remaining=${businessPackRemaining}`)
console.log(`METRIC postgres19_capability_gates_remaining=${postgres19Remaining}`)
