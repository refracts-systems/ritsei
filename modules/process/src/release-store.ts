import { and, eq } from "drizzle-orm"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"

import {
  processDeployments,
  processReleaseAudits,
  processReleases,
} from "../../../db/schema/process.ts"
import {
  Database,
  DatabaseFailure,
  type DrizzleTransaction,
  isDatabaseConstraint,
  uuidv7,
} from "../../../foundation/mod.ts"
import { ProcessReleaseValidation } from "./catalog-release.ts"
import { ProcessEnvironment } from "./runtime.ts"

const Uuid = Schema.String.check(Schema.isUUID())
const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))
const NonEmptyString = Schema.String.check(Schema.isPattern(/\S/))

export const ProcessReleaseInput = Schema.Struct({
  tenantId: Uuid,
  validation: ProcessReleaseValidation,
  checksum: NonEmptyString,
  approvedBy: NonEmptyString,
  approvalReason: NonEmptyString,
  releasedBy: NonEmptyString,
})
export type ProcessReleaseInput = Schema.Schema.Type<typeof ProcessReleaseInput>

export const ProcessDeploymentInput = Schema.Struct({
  tenantId: Uuid,
  releaseId: Uuid,
  environment: ProcessEnvironment,
  deployedBy: NonEmptyString,
  promotionReason: NonEmptyString,
})
export type ProcessDeploymentInput = Schema.Schema.Type<typeof ProcessDeploymentInput>

export const ProcessReleaseArtifact = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  definitionId: Uuid,
  definitionVersion: PositiveInt,
  catalogVersion: PositiveInt,
  checksum: NonEmptyString,
  status: Schema.Literals(["RELEASED"]),
  approvedBy: NonEmptyString,
  releasedBy: NonEmptyString,
  approvalReason: NonEmptyString,
  createdAt: NonEmptyString,
})
export type ProcessReleaseArtifact = Schema.Schema.Type<typeof ProcessReleaseArtifact>

export const ProcessDeployment = Schema.Struct({
  id: Uuid,
  tenantId: Uuid,
  releaseId: Uuid,
  environment: ProcessEnvironment,
  deployedBy: NonEmptyString,
  promotionReason: NonEmptyString,
  createdAt: NonEmptyString,
})
export type ProcessDeployment = Schema.Schema.Type<typeof ProcessDeployment>

export class ProcessReleaseConflict extends Schema.TaggedError<ProcessReleaseConflict>()(
  "ProcessReleaseConflict",
  {
    tenantId: Uuid,
    definitionId: Uuid,
    definitionVersion: PositiveInt,
  },
) {}

export class ProcessDeploymentConflict extends Schema.TaggedError<ProcessDeploymentConflict>()(
  "ProcessDeploymentConflict",
  {
    tenantId: Uuid,
    releaseId: Uuid,
    environment: ProcessEnvironment,
  },
) {}

export class ProcessReleaseNotFound extends Schema.TaggedError<ProcessReleaseNotFound>()(
  "ProcessReleaseNotFound",
  { tenantId: Uuid, releaseId: Uuid },
) {}

// immutable release artifacts are append-only and carry approval and release audit context.
// deployment binding is a separate append-only record so DEV, TEST, and PROD promotion stay explicit.
export interface ProcessReleaseStore {
  readonly release: (
    input: unknown,
  ) => Effect.Effect<
    ProcessReleaseArtifact,
    ProcessReleaseConflict | DatabaseFailure | Schema.SchemaError
  >
  readonly deploy: (
    input: unknown,
  ) => Effect.Effect<
    ProcessDeployment,
    ProcessDeploymentConflict | ProcessReleaseNotFound | DatabaseFailure | Schema.SchemaError
  >
}

export const ProcessReleaseStore = Context.Service<ProcessReleaseStore>(
  "RITSEI/ProcessReleaseStore",
)

const toRelease = (row: {
  readonly id: string
  readonly tenantId: string
  readonly definitionId: string
  readonly definitionVersion: number
  readonly catalogVersion: number
  readonly checksum: string
  readonly approvedBy: string
  readonly approvalReason: string
  readonly releasedBy: string
  readonly createdAt: Date
}): ProcessReleaseArtifact => ({
  id: row.id,
  tenantId: row.tenantId,
  definitionId: row.definitionId,
  definitionVersion: row.definitionVersion,
  catalogVersion: row.catalogVersion,
  checksum: row.checksum,
  status: "RELEASED",
  approvedBy: row.approvedBy,
  releasedBy: row.releasedBy,
  approvalReason: row.approvalReason,
  createdAt: row.createdAt.toISOString(),
})

const toDeployment = (row: {
  readonly id: string
  readonly tenantId: string
  readonly releaseId: string
  readonly environment: "DEV" | "TEST" | "PROD"
  readonly deployedBy: string
  readonly promotionReason: string
  readonly createdAt: Date
}): ProcessDeployment => ({ ...row, createdAt: row.createdAt.toISOString() })

const sameRelease = (release: ProcessReleaseArtifact, input: ProcessReleaseInput): boolean =>
  release.tenantId === input.tenantId
  && release.definitionId === input.validation.definitionId
  && release.definitionVersion === input.validation.definitionVersion
  && release.catalogVersion === input.validation.catalogVersion
  && release.checksum === input.checksum
  && release.approvedBy === input.approvedBy
  && release.approvalReason === input.approvalReason
  && release.releasedBy === input.releasedBy

type ReleaseRecord =
  | { readonly _tag: "Recorded"; readonly release: ProcessReleaseArtifact }
  | { readonly _tag: "Conflict" }

const recordRelease = async (
  transaction: DrizzleTransaction,
  input: ProcessReleaseInput,
): Promise<ReleaseRecord> => {
  const existingRows = await transaction.select().from(processReleases).where(and(
    eq(processReleases.tenantId, input.tenantId),
    eq(processReleases.definitionId, input.validation.definitionId),
    eq(processReleases.definitionVersion, input.validation.definitionVersion),
  )).for("update")
  const existing = existingRows[0]
  if (existing !== undefined) {
    const release = toRelease(existing)
    return sameRelease(release, input) ? { _tag: "Recorded", release } : { _tag: "Conflict" }
  }

  const rows = await transaction.insert(processReleases).values({
    id: uuidv7(),
    tenantId: input.tenantId,
    definitionId: input.validation.definitionId,
    definitionVersion: input.validation.definitionVersion,
    catalogVersion: input.validation.catalogVersion,
    checksum: input.checksum,
    references: input.validation.references,
    approvedBy: input.approvedBy,
    approvalReason: input.approvalReason,
    releasedBy: input.releasedBy,
  }).returning()
  const release = toRelease(rows[0]!)
  await transaction.insert(processReleaseAudits).values([
    {
      id: uuidv7(),
      tenantId: input.tenantId,
      releaseId: release.id,
      event: "approval",
      actorPrincipalId: input.approvedBy,
      environment: null,
      reason: input.approvalReason,
    },
    {
      id: uuidv7(),
      tenantId: input.tenantId,
      releaseId: release.id,
      event: "release",
      actorPrincipalId: input.releasedBy,
      environment: null,
      reason: "immutable release artifact created",
    },
  ])
  return { _tag: "Recorded", release }
}

type DeploymentRecord =
  | { readonly _tag: "Recorded"; readonly deployment: ProcessDeployment }
  | { readonly _tag: "Conflict" }
  | { readonly _tag: "MissingRelease" }

const recordDeployment = async (
  transaction: DrizzleTransaction,
  input: ProcessDeploymentInput,
): Promise<DeploymentRecord> => {
  const releaseRows = await transaction.select({ id: processReleases.id }).from(processReleases)
    .where(and(
      eq(processReleases.tenantId, input.tenantId),
      eq(processReleases.id, input.releaseId),
    )).for("update")
  if (releaseRows[0] === undefined) return { _tag: "MissingRelease" }

  const existingRows = await transaction.select().from(processDeployments).where(and(
    eq(processDeployments.tenantId, input.tenantId),
    eq(processDeployments.releaseId, input.releaseId),
    eq(processDeployments.environment, input.environment),
  )).for("update")
  const existing = existingRows[0]
  if (existing !== undefined) {
    const deployment = toDeployment(existing)
    return deployment.deployedBy === input.deployedBy
        && deployment.promotionReason === input.promotionReason
      ? { _tag: "Recorded", deployment }
      : { _tag: "Conflict" }
  }

  const rows = await transaction.insert(processDeployments).values({
    id: uuidv7(),
    tenantId: input.tenantId,
    releaseId: input.releaseId,
    environment: input.environment,
    deployedBy: input.deployedBy,
    promotionReason: input.promotionReason,
  }).returning()
  const deployment = toDeployment(rows[0]!)
  await transaction.insert(processReleaseAudits).values({
    id: uuidv7(),
    tenantId: input.tenantId,
    releaseId: input.releaseId,
    event: "deployment",
    actorPrincipalId: input.deployedBy,
    environment: input.environment,
    reason: input.promotionReason,
  })
  return { _tag: "Recorded", deployment }
}

export const makePostgresProcessReleaseStore = Effect.gen(function*() {
  const database = yield* Database
  return {
    release: (input: unknown) =>
      Effect.gen(function*() {
        const decoded = yield* Schema.decodeUnknownEffect(ProcessReleaseInput)(input)
        const result = yield* database.transaction(
          (transaction) => recordRelease(transaction, decoded),
          "process.release.create",
        ).pipe(Effect.result)
        if (Result.isSuccess(result)) {
          return result.success._tag === "Recorded" ? result.success.release : yield* Effect.fail(
            new ProcessReleaseConflict({
              tenantId: decoded.tenantId,
              definitionId: decoded.validation.definitionId,
              definitionVersion: decoded.validation.definitionVersion,
            }),
          )
        }
        if (isDatabaseConstraint(result.failure, "process_releases_tenant_definition_key")) {
          return yield* Effect.fail(
            new ProcessReleaseConflict({
              tenantId: decoded.tenantId,
              definitionId: decoded.validation.definitionId,
              definitionVersion: decoded.validation.definitionVersion,
            }),
          )
        }
        return yield* Effect.fail(result.failure)
      }),
    deploy: (input: unknown) =>
      Effect.gen(function*() {
        const decoded = yield* Schema.decodeUnknownEffect(ProcessDeploymentInput)(input)
        const result = yield* database.transaction(
          (transaction) => recordDeployment(transaction, decoded),
          "process.release.deploy",
        ).pipe(Effect.result)
        if (Result.isSuccess(result)) {
          if (result.success._tag === "Recorded") return result.success.deployment
          if (result.success._tag === "MissingRelease") {
            return yield* Effect.fail(
              new ProcessReleaseNotFound({
                tenantId: decoded.tenantId,
                releaseId: decoded.releaseId,
              }),
            )
          }
          return yield* Effect.fail(
            new ProcessDeploymentConflict({
              tenantId: decoded.tenantId,
              releaseId: decoded.releaseId,
              environment: decoded.environment,
            }),
          )
        }
        if (
          isDatabaseConstraint(result.failure, "process_deployments_tenant_release_environment_key")
        ) {
          return yield* Effect.fail(
            new ProcessDeploymentConflict({
              tenantId: decoded.tenantId,
              releaseId: decoded.releaseId,
              environment: decoded.environment,
            }),
          )
        }
        return yield* Effect.fail(result.failure)
      }),
  } satisfies ProcessReleaseStore
})

export const makeMemoryProcessReleaseStore = (): ProcessReleaseStore => {
  const releases = new Map<string, ProcessReleaseArtifact>()
  const deployments = new Map<string, ProcessDeployment>()
  return {
    release: (input) =>
      Effect.gen(function*() {
        const decoded = yield* Schema.decodeUnknownEffect(ProcessReleaseInput)(input)
        const key =
          `${decoded.tenantId}:${decoded.validation.definitionId}:${decoded.validation.definitionVersion}`
        const existing = releases.get(key)
        if (existing !== undefined) {
          if (sameRelease(existing, decoded)) return existing
          return yield* Effect.fail(
            new ProcessReleaseConflict({
              tenantId: decoded.tenantId,
              definitionId: decoded.validation.definitionId,
              definitionVersion: decoded.validation.definitionVersion,
            }),
          )
        }
        const release: ProcessReleaseArtifact = {
          id: uuidv7(),
          tenantId: decoded.tenantId,
          definitionId: decoded.validation.definitionId,
          definitionVersion: decoded.validation.definitionVersion,
          catalogVersion: decoded.validation.catalogVersion,
          checksum: decoded.checksum,
          status: "RELEASED",
          approvedBy: decoded.approvedBy,
          releasedBy: decoded.releasedBy,
          approvalReason: decoded.approvalReason,
          createdAt: new Date().toISOString(),
        }
        releases.set(key, release)
        return release
      }),
    deploy: (input) =>
      Effect.gen(function*() {
        const decoded = yield* Schema.decodeUnknownEffect(ProcessDeploymentInput)(input)
        const release = [...releases.values()].find((candidate) =>
          candidate.id === decoded.releaseId && candidate.tenantId === decoded.tenantId
        )
        if (release === undefined) {
          return yield* Effect.fail(
            new ProcessReleaseNotFound({
              tenantId: decoded.tenantId,
              releaseId: decoded.releaseId,
            }),
          )
        }
        const key = `${decoded.tenantId}:${decoded.releaseId}:${decoded.environment}`
        const existing = deployments.get(key)
        if (existing !== undefined) {
          if (
            existing.deployedBy === decoded.deployedBy
            && existing.promotionReason === decoded.promotionReason
          ) return existing
          return yield* Effect.fail(
            new ProcessDeploymentConflict({
              tenantId: decoded.tenantId,
              releaseId: decoded.releaseId,
              environment: decoded.environment,
            }),
          )
        }
        const deployment: ProcessDeployment = {
          id: uuidv7(),
          tenantId: decoded.tenantId,
          releaseId: decoded.releaseId,
          environment: decoded.environment,
          deployedBy: decoded.deployedBy,
          promotionReason: decoded.promotionReason,
          createdAt: new Date().toISOString(),
        }
        deployments.set(key, deployment)
        return deployment
      }),
  }
}
