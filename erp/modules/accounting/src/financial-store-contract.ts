import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Predicate from "effect/Predicate"

const NonEmptyString = Schema.String.check(Schema.isPattern(/\S/))
const TrimmedNonEmptyString = Schema.String.check(
  Schema.makeFilter((value) => /\S/.test(value) && value === value.trim(), {
    expected: "a trimmed nonblank string",
  }),
)
const InstantString = Schema.String.check(
  Schema.makeFilter(
    (value) =>
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
      !Number.isNaN(Date.parse(value)),
    { expected: "an ISO-8601 UTC instant" },
  ),
)
const PositiveInt = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 0x7fffffff }))
const ScanLimit = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 8188 }))
const NonNegativeInt = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 0x7fffffff }))
const MinorAmount = Schema.String.check(
  Schema.makeFilter(
    (value) => /^(0|[1-9][0-9]*)$/.test(value) && BigInt(value) <= (1n << 128n) - 1n,
    { expected: "a non-negative unsigned 128-bit minor amount" },
  ),
)
const PositiveMinorAmount = Schema.String.check(
  Schema.makeFilter((value) => /^[1-9][0-9]*$/.test(value) && BigInt(value) <= (1n << 128n) - 1n, {
    expected: "a positive unsigned 128-bit minor amount",
  }),
)
const Uuidv7 = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
)

export const FinancialStoreAuthority = Schema.Literals(["postgresql", "tigerbeetle"])
export type FinancialStoreAuthority = Schema.Schema.Type<typeof FinancialStoreAuthority>

export const FINANCIAL_STAGING_EVIDENCE_CANONICALIZATION_VERSION = 1 as const

/** A store-derived boundary. It is not a wall-clock timestamp or an operation identity. */
export const FinancialStoreWatermark = Schema.Struct({
  authority: FinancialStoreAuthority,
  scope: TrimmedNonEmptyString,
  value: TrimmedNonEmptyString,
  snapshotRef: TrimmedNonEmptyString,
  consistency: Schema.Literals(["bounded", "snapshot"]),
  capturedAt: InstantString,
})
export type FinancialStoreWatermark = Schema.Schema.Type<typeof FinancialStoreWatermark>

export const FinancialStoreWatermarkInput = Schema.Struct({
  scope: TrimmedNonEmptyString,
  maxRecords: ScanLimit,
})
export type FinancialStoreWatermarkInput = Schema.Schema.Type<typeof FinancialStoreWatermarkInput>

export class FinancialStoreObservationFailure extends Schema.TaggedError<FinancialStoreObservationFailure>()(
  "FinancialStoreObservationFailure",
  {
    scope: TrimmedNonEmptyString,
    reason: Schema.Literals([
      "unavailable",
      "unsupported",
      "incomplete",
      "invalid_fact",
      "invalid_watermark",
    ]),
  },
) {}

export interface FinancialStoreWatermarkCollectorService {
  readonly collect: (
    input: unknown,
  ) => Effect.Effect<FinancialStoreWatermark, FinancialStoreObservationFailure | Schema.SchemaError>
}

export const FinancialStoreWatermarkCollector =
  Context.Service<FinancialStoreWatermarkCollectorService>(
    "RITSEI/FinancialStoreWatermarkCollector",
  )

export const FinancialStoreInventoryRequest = Schema.Struct({
  scope: TrimmedNonEmptyString,
  maxRecords: ScanLimit,
  watermark: FinancialStoreWatermark,
}).check(
  Schema.makeFilter((input) => input.scope === input.watermark.scope, {
    expected: "inventory scope must match the watermark scope",
  }),
)
export type FinancialStoreInventoryRequest = Schema.Schema.Type<
  typeof FinancialStoreInventoryRequest
>

export const FinancialStoreAccountObservation = Schema.Struct({
  accountRef: NonEmptyString,
  currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
  mappingVersion: NonNegativeInt,
  debitsPendingMinor: MinorAmount,
  debitsPostedMinor: MinorAmount,
  creditsPendingMinor: MinorAmount,
  creditsPostedMinor: MinorAmount,
  observedAt: NonEmptyString,
})
export type FinancialStoreAccountObservation = Schema.Schema.Type<
  typeof FinancialStoreAccountObservation
>

export const FinancialStoreTransferObservation = Schema.Struct({
  transferRef: NonEmptyString,
  debitAccountRef: NonEmptyString,
  creditAccountRef: NonEmptyString,
  amountMinor: PositiveMinorAmount,
  currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
  mappingVersion: NonNegativeInt,
  status: Schema.Literals(["accepted", "pending", "voided"]),
  observedAt: NonEmptyString,
}).check(
  Schema.makeFilter((transfer) => transfer.debitAccountRef !== transfer.creditAccountRef, {
    expected: "financial store transfer accounts must be distinct",
  }),
)
export type FinancialStoreTransferObservation = Schema.Schema.Type<
  typeof FinancialStoreTransferObservation
>

export const FinancialStoreInventory = Schema.Struct({
  authority: FinancialStoreAuthority,
  scope: TrimmedNonEmptyString,
  watermark: FinancialStoreWatermark,
  accounts: Schema.Array(FinancialStoreAccountObservation),
  transfers: Schema.Array(FinancialStoreTransferObservation),
}).check(
  Schema.makeFilter(
    (inventory) =>
      inventory.authority === inventory.watermark.authority &&
      inventory.scope === inventory.watermark.scope,
    { expected: "inventory authority and scope must match its watermark" },
  ),
)
export type FinancialStoreInventory = Schema.Schema.Type<typeof FinancialStoreInventory>

export interface FinancialStoreInventoryScannerService {
  readonly scan: (
    input: unknown,
  ) => Effect.Effect<FinancialStoreInventory, FinancialStoreObservationFailure | Schema.SchemaError>
}

export const FinancialStoreInventoryScanner =
  Context.Service<FinancialStoreInventoryScannerService>("RITSEI/FinancialStoreInventoryScanner")

export type FinancialStoreObservationProvider = Readonly<{
  readonly authority: FinancialStoreAuthority
  readonly collector: FinancialStoreWatermarkCollectorService
  readonly scanner: FinancialStoreInventoryScannerService
}>

export interface FinancialStoreObservationRegistryService {
  readonly collect: (
    authority: FinancialStoreAuthority,
    input: unknown,
  ) => Effect.Effect<FinancialStoreWatermark, FinancialStoreObservationFailure | Schema.SchemaError>
  readonly scan: (
    authority: FinancialStoreAuthority,
    input: unknown,
  ) => Effect.Effect<FinancialStoreInventory, FinancialStoreObservationFailure | Schema.SchemaError>
}

export const FinancialStoreObservationRegistry =
  Context.Service<FinancialStoreObservationRegistryService>(
    "RITSEI/FinancialStoreObservationRegistry",
  )

const observationScope = (input: unknown) =>
  Predicate.isObjectOrArray(input) && "scope" in input && Predicate.isString(input.scope)
    ? input.scope
    : "observation-registry"

export const makeFinancialStoreObservationRegistry = (
  providers: readonly FinancialStoreObservationProvider[],
): FinancialStoreObservationRegistryService => {
  const byAuthority = new Map(providers.map((provider) => [provider.authority, provider]))
  return {
    collect: (authority, input) => {
      const provider = byAuthority.get(authority)
      return provider === undefined
        ? Effect.fail(
            new FinancialStoreObservationFailure({
              scope: observationScope(input),
              reason: "unsupported",
            }),
          )
        : provider.collector.collect(input)
    },
    scan: (authority, input) => {
      const provider = byAuthority.get(authority)
      return provider === undefined
        ? Effect.fail(
            new FinancialStoreObservationFailure({
              scope: observationScope(input),
              reason: "unsupported",
            }),
          )
        : provider.scanner.scan(input)
    },
  }
}

export const makeFinancialStoreObservationRegistryLayer = (
  providers: readonly FinancialStoreObservationProvider[],
) =>
  Layer.succeed(FinancialStoreObservationRegistry, makeFinancialStoreObservationRegistry(providers))

export type FinancialStoreInventoryMismatch = Readonly<{
  readonly kind:
    | "authority_mismatch"
    | "scope_mismatch"
    | "watermark_mismatch"
    | "duplicate_account"
    | "missing_account"
    | "unexpected_account"
    | "account_mismatch"
    | "duplicate_transfer"
    | "missing_transfer"
    | "unexpected_transfer"
    | "transfer_mismatch"
  readonly key: string
  readonly detail: string
}>

export type FinancialStoreInventoryComparison = Readonly<{
  readonly ok: boolean
  readonly mismatches: readonly FinancialStoreInventoryMismatch[]
}>

const duplicateKeys = <A>(values: readonly A[], key: (value: A) => string) => {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(key(value), (counts.get(key(value)) ?? 0) + 1)
  return new Set(
    counts
      .entries()
      .filter(([, count]) => count > 1)
      .map(([value]) => value),
  )
}

const accountValue = (account: FinancialStoreAccountObservation) =>
  JSON.stringify([
    account.accountRef,
    account.currency,
    account.mappingVersion,
    account.debitsPendingMinor,
    account.debitsPostedMinor,
    account.creditsPendingMinor,
    account.creditsPostedMinor,
    account.observedAt,
  ])

const transferValue = (transfer: FinancialStoreTransferObservation) =>
  JSON.stringify([
    transfer.transferRef,
    transfer.debitAccountRef,
    transfer.creditAccountRef,
    transfer.amountMinor,
    transfer.currency,
    transfer.mappingVersion,
    transfer.status,
    transfer.observedAt,
  ])

const accountKey = (account: FinancialStoreAccountObservation) =>
  `${account.accountRef}:${account.currency}:${account.mappingVersion}`

const transferKey = (transfer: FinancialStoreTransferObservation) => transfer.transferRef

const canonicalValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (!Predicate.isObjectOrArray(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalValue(child)]),
  )
}

const canonicalJson = (value: unknown) => JSON.stringify(canonicalValue(value)) ?? ""

const canonicalArray = (values: readonly unknown[]) =>
  [...values]
    .map(canonicalValue)
    .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)))

/** Canonical provider facts for hashes and exact same-boundary comparisons. */
export const canonicalizeFinancialStoreFacts = (
  input: Pick<FinancialStoreInventory, "accounts" | "transfers">,
) =>
  JSON.stringify({
    accounts: canonicalArray(input.accounts),
    transfers: canonicalArray(input.transfers),
  })

export const hashFinancialStoreFacts = (
  input: Pick<FinancialStoreInventory, "accounts" | "transfers">,
) =>
  Effect.promise(async () => {
    const digest = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonicalizeFinancialStoreFacts(input)),
      ),
    )
    return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")
  })

export const hashFinancialStoreWatermarks = (
  source: FinancialStoreWatermark,
  target: FinancialStoreWatermark,
) =>
  Effect.promise(async () => {
    const digest = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(
          JSON.stringify({
            source: [
              source.authority,
              source.scope,
              source.value,
              source.snapshotRef,
              source.consistency,
            ],
            target: [
              target.authority,
              target.scope,
              target.value,
              target.snapshotRef,
              target.consistency,
            ],
          }),
        ),
      ),
    )
    return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")
  })

const appendInventoryBoundaryMismatches = (
  mismatches: FinancialStoreInventoryMismatch[],
  expected: FinancialStoreInventory,
  observed: FinancialStoreInventory,
) => {
  if (expected.authority !== observed.authority) {
    mismatches.push({
      kind: "authority_mismatch",
      key: "authority",
      detail: `${expected.authority}:${observed.authority}`,
    })
  }
  if (expected.scope !== observed.scope) {
    mismatches.push({
      kind: "scope_mismatch",
      key: "scope",
      detail: `${expected.scope}:${observed.scope}`,
    })
  }
  if (
    expected.watermark.value !== observed.watermark.value ||
    expected.watermark.snapshotRef !== observed.watermark.snapshotRef ||
    expected.watermark.consistency !== observed.watermark.consistency
  ) {
    mismatches.push({
      kind: "watermark_mismatch",
      key: "watermark",
      detail: "store-derived boundary differs",
    })
  }
}

const appendAccountMismatches = (
  mismatches: FinancialStoreInventoryMismatch[],
  expected: readonly FinancialStoreAccountObservation[],
  observed: readonly FinancialStoreAccountObservation[],
) => {
  const expectedDuplicates = duplicateKeys(expected, accountKey)
  const observedDuplicates = duplicateKeys(observed, accountKey)
  for (const key of [...new Set([...expectedDuplicates, ...observedDuplicates])].sort()) {
    mismatches.push({ kind: "duplicate_account", key, detail: "duplicate account reference" })
  }
  const expectedAccounts = new Map(expected.map((account) => [accountKey(account), account]))
  const observedAccounts = new Map(observed.map((account) => [accountKey(account), account]))
  for (const key of [...new Set([...expectedAccounts.keys(), ...observedAccounts.keys()])].sort()) {
    const expectedAccount = expectedAccounts.get(key)
    const observedAccount = observedAccounts.get(key)
    if (expectedAccount === undefined) {
      mismatches.push({ kind: "unexpected_account", key, detail: "observed only" })
    } else if (observedAccount === undefined) {
      mismatches.push({ kind: "missing_account", key, detail: "expected only" })
    } else if (accountValue(expectedAccount) !== accountValue(observedAccount)) {
      mismatches.push({ kind: "account_mismatch", key, detail: "balance or metadata" })
    }
  }
}

const appendTransferMismatches = (
  mismatches: FinancialStoreInventoryMismatch[],
  expected: readonly FinancialStoreTransferObservation[],
  observed: readonly FinancialStoreTransferObservation[],
) => {
  const expectedDuplicates = duplicateKeys(expected, transferKey)
  const observedDuplicates = duplicateKeys(observed, transferKey)
  for (const key of [...new Set([...expectedDuplicates, ...observedDuplicates])].sort()) {
    mismatches.push({ kind: "duplicate_transfer", key, detail: "duplicate transfer reference" })
  }
  const expectedTransfers = new Map(expected.map((transfer) => [transfer.transferRef, transfer]))
  const observedTransfers = new Map(observed.map((transfer) => [transfer.transferRef, transfer]))
  for (const key of [
    ...new Set([...expectedTransfers.keys(), ...observedTransfers.keys()]),
  ].sort()) {
    const expectedTransfer = expectedTransfers.get(key)
    const observedTransfer = observedTransfers.get(key)
    if (expectedTransfer === undefined) {
      mismatches.push({ kind: "unexpected_transfer", key, detail: "observed only" })
    } else if (observedTransfer === undefined) {
      mismatches.push({ kind: "missing_transfer", key, detail: "expected only" })
    } else if (transferValue(expectedTransfer) !== transferValue(observedTransfer)) {
      mismatches.push({ kind: "transfer_mismatch", key, detail: "identity, amount, or metadata" })
    }
  }
}

/**
 * Compares a complete bounded store inventory without treating a missing provider fact as safe.
 * The caller must separately authorize the watermark and submission fence used for the scan.
 */
export const compareFinancialStoreInventories = (
  expected: FinancialStoreInventory,
  observed: FinancialStoreInventory,
): FinancialStoreInventoryComparison => {
  const mismatches: FinancialStoreInventoryMismatch[] = []
  appendInventoryBoundaryMismatches(mismatches, expected, observed)
  appendAccountMismatches(mismatches, expected.accounts, observed.accounts)
  appendTransferMismatches(mismatches, expected.transfers, observed.transfers)
  return { ok: mismatches.length === 0, mismatches }
}

export const FinancialStagingMetric = Schema.Struct({
  name: NonEmptyString,
  value: Schema.Number.check(Schema.isFinite()),
  unit: NonEmptyString,
})
export type FinancialStagingMetric = Schema.Schema.Type<typeof FinancialStagingMetric>

export const FinancialStagingAlert = Schema.Struct({
  name: NonEmptyString,
  severity: Schema.Literals(["warning", "critical"]),
  reason: NonEmptyString,
  runbookRef: NonEmptyString,
  state: Schema.Literals(["fired", "resolved"]),
  delivered: Schema.Boolean,
  acknowledged: Schema.Boolean,
  ownerRef: Schema.NullOr(NonEmptyString),
})
export type FinancialStagingAlert = Schema.Schema.Type<typeof FinancialStagingAlert>

export const FinancialStagingCohort = Schema.Struct({
  cohortId: NonEmptyString,
  tenantId: Schema.String.check(Schema.isUUID()),
  legalEntityId: Schema.String.check(Schema.isUUID()),
  ownerPrincipalId: NonEmptyString,
  approvalAuthorityRef: NonEmptyString,
  abortAuthorityRef: NonEmptyString,
  deploymentRevision: NonEmptyString,
  plannedScenarioIds: Schema.Array(NonEmptyString),
  maxOperationCount: PositiveInt,
})
export type FinancialStagingCohort = Schema.Schema.Type<typeof FinancialStagingCohort>

/** Provider-neutral backup/restore result; backup commands and restore targets stay behind adapters. */
export const FinancialBackupRestoreEvidence = Schema.Struct({
  authority: FinancialStoreAuthority,
  backupId: NonEmptyString,
  backupSourceRef: NonEmptyString,
  restoreId: NonEmptyString,
  restoreTargetRef: NonEmptyString,
  sourceWatermark: FinancialStoreWatermark,
  restoredWatermark: FinancialStoreWatermark,
  comparison: Schema.Literals(["match", "mismatch", "incomplete"]),
  startedAt: InstantString,
  completedAt: InstantString,
})
  .check(
    Schema.makeFilter(
      (evidence) =>
        evidence.authority === evidence.sourceWatermark.authority &&
        evidence.authority === evidence.restoredWatermark.authority,
      { expected: "backup and restore watermarks must use the declared authority" },
    ),
  )
  .check(
    Schema.makeFilter(
      (evidence) => Date.parse(evidence.completedAt) >= Date.parse(evidence.startedAt),
      { expected: "backup restore completedAt at or after startedAt" },
    ),
  )
export type FinancialBackupRestoreEvidence = Schema.Schema.Type<
  typeof FinancialBackupRestoreEvidence
>

export const FinancialStagingTelemetryInput = Schema.Struct({
  tenantId: Schema.String.check(Schema.isUUID()),
  legalEntityId: Schema.String.check(Schema.isUUID()),
  cohortId: NonEmptyString,
  gateId: NonEmptyString,
  deploymentRevision: NonEmptyString,
})
export type FinancialStagingTelemetryInput = Schema.Schema.Type<
  typeof FinancialStagingTelemetryInput
>

export const FinancialStagingTelemetrySnapshot = Schema.Struct({
  metrics: Schema.Array(FinancialStagingMetric),
  alerts: Schema.Array(FinancialStagingAlert),
})
export type FinancialStagingTelemetrySnapshot = Schema.Schema.Type<
  typeof FinancialStagingTelemetrySnapshot
>

export class FinancialStagingTelemetryFailure extends Schema.TaggedError<FinancialStagingTelemetryFailure>()(
  "FinancialStagingTelemetryFailure",
  {
    scope: NonEmptyString,
    reason: Schema.Literals(["unavailable", "incomplete", "invalid"]),
  },
) {}

export interface FinancialStagingTelemetryService {
  readonly collect: (
    input: unknown,
  ) => Effect.Effect<
    FinancialStagingTelemetrySnapshot,
    FinancialStagingTelemetryFailure | Schema.SchemaError
  >
}

export const FinancialStagingTelemetry = Context.Service<FinancialStagingTelemetryService>(
  "RITSEI/FinancialStagingTelemetry",
)

/** Provider-neutral, append-oriented envelope for one externally captured staging gate result. */
export const FinancialStagingEvidence = Schema.Struct({
  recordId: Uuidv7,
  schemaVersion: PositiveInt,
  gateId: NonEmptyString,
  cohort: FinancialStagingCohort,
  tenantId: Schema.String.check(Schema.isUUID()),
  legalEntityId: Schema.String.check(Schema.isUUID()),
  operatorPrincipalId: NonEmptyString,
  deploymentRevision: NonEmptyString,
  providerIdentityRef: NonEmptyString,
  endpointRefs: Schema.Array(NonEmptyString),
  failureScenarioIds: Schema.Array(NonEmptyString),
  operationIds: Schema.Array(NonEmptyString),
  transferIds: Schema.Array(NonEmptyString),
  leaseGenerations: Schema.Array(Schema.String.check(Schema.isPattern(/^(0|[1-9][0-9]*)$/))),
  watermarks: Schema.Array(FinancialStoreWatermark),
  backupRestore: Schema.Array(FinancialBackupRestoreEvidence),
  metrics: Schema.Array(FinancialStagingMetric),
  alerts: Schema.Array(FinancialStagingAlert),
  startedAt: InstantString,
  completedAt: InstantString,
  result: Schema.Literals(["pass", "fail"]),
  mismatchCount: NonNegativeInt,
  orphanCount: NonNegativeInt,
})
  .check(
    Schema.makeFilter(
      (evidence) =>
        evidence.tenantId === evidence.cohort.tenantId &&
        evidence.legalEntityId === evidence.cohort.legalEntityId &&
        evidence.deploymentRevision === evidence.cohort.deploymentRevision,
      { expected: "staging evidence scope must match its cohort" },
    ),
  )
  .check(
    Schema.makeFilter(
      (evidence) => Date.parse(evidence.completedAt) >= Date.parse(evidence.startedAt),
      { expected: "completedAt at or after startedAt" },
    ),
  )
  .check(
    Schema.makeFilter(
      (evidence) =>
        evidence.operationIds.length <= evidence.cohort.maxOperationCount &&
        evidence.failureScenarioIds.every((scenario) =>
          evidence.cohort.plannedScenarioIds.includes(scenario),
        ),
      { expected: "staging evidence must stay within its approved cohort bounds" },
    ),
  )
  .check(
    Schema.makeFilter(
      (evidence) =>
        evidence.result !== "pass" || (evidence.mismatchCount === 0 && evidence.orphanCount === 0),
      { expected: "passing staging evidence must have zero mismatches and orphans" },
    ),
  )
export type FinancialStagingEvidence = Schema.Schema.Type<typeof FinancialStagingEvidence>

const evidenceKeys = [
  "recordId",
  "schemaVersion",
  "gateId",
  "cohort",
  "tenantId",
  "legalEntityId",
  "operatorPrincipalId",
  "deploymentRevision",
  "providerIdentityRef",
  "endpointRefs",
  "failureScenarioIds",
  "operationIds",
  "transferIds",
  "leaseGenerations",
  "watermarks",
  "backupRestore",
  "metrics",
  "alerts",
  "startedAt",
  "completedAt",
  "result",
  "mismatchCount",
  "orphanCount",
] as const

const unorderedEvidenceKeys = new Set([
  "endpointRefs",
  "failureScenarioIds",
  "operationIds",
  "transferIds",
  "leaseGenerations",
  "watermarks",
  "backupRestore",
  "metrics",
  "alerts",
])

/** Canonical form for hashing; capture ordering and nested property ordering cannot change identity. */
export const canonicalizeFinancialStagingEvidence = (evidence: FinancialStagingEvidence) =>
  JSON.stringify(
    evidenceKeys.map((key) => [
      key,
      unorderedEvidenceKeys.has(key)
        ? canonicalArray(evidence[key] as readonly unknown[])
        : canonicalValue(evidence[key]),
    ]),
  )

export const hashFinancialStagingEvidence = (evidence: FinancialStagingEvidence) =>
  Effect.promise(async () => {
    const digest = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonicalizeFinancialStagingEvidence(evidence)),
      ),
    )
    return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")
  })
