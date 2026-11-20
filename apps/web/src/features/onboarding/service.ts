import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import {
  connectionTenant,
  decodeInput,
  decodeResponse,
  mutationRequest,
  querySuffix,
  RequestFailure,
  requestJson,
  responseMatches,
  routeWithId,
} from "../../shared/api.ts"
import {
  ApplyImportResult,
  ImportBatchSummary,
  ImportRow,
  ListImportRowsQuery,
  onboardingRoutes,
  partyMappingRevision,
  StagedImport,
  StagePartyImportInput,
} from "../../shared/contracts/generated/onboarding.ts"
import { Uuid } from "../../shared/schemas.ts"

const requestByteLimit = 1_048_576

export const stagePartyImport = Effect.fn("Frontend.Onboarding.stagePartyImport")(function* (
  file: File,
  sourceInstance: string,
) {
  if (file.size > requestByteLimit) {
    return yield* Effect.fail(
      new RequestFailure({ kind: "validation", code: "CsvRequestTooLarge" }),
    )
  }

  const csv = yield* Effect.tryPromise({
    try: async () =>
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer()),
    catch: () => new RequestFailure({ kind: "validation", code: "CsvUnreadable" }),
  })

  const input = {
    sourceInstance,
    objectKind: "party" as const,
    mappingRevision: partyMappingRevision,
    csv,
  }

  if (new TextEncoder().encode(JSON.stringify(input)).byteLength > requestByteLimit) {
    return yield* Effect.fail(
      new RequestFailure({ kind: "validation", code: "CsvRequestTooLarge" }),
    )
  }

  const payload = yield* decodeInput(StagePartyImportInput, input)
  const body = yield* mutationRequest(onboardingRoutes.stage, payload)
  const result = yield* decodeResponse(StagedImport, body, "unknown-outcome")
  const session = yield* connectionTenant

  if (!responseMatches(result.summary.batch, { tenantId: session.tenantId, sourceInstance })) {
    return yield* Effect.fail(new RequestFailure({ kind: "unknown-outcome" }))
  }

  return result
})

const checkBatch = Effect.fn("Frontend.Onboarding.checkBatch")(function* (
  summary: ImportBatchSummary,
  id: string,
  kind: "invalid-response" | "unknown-outcome",
) {
  const session = yield* connectionTenant

  if (!responseMatches(summary.batch, { id, tenantId: session.tenantId })) {
    return yield* Effect.fail(new RequestFailure({ kind }))
  }

  return summary
})

export const getImportBatch = Effect.fn("Frontend.Onboarding.getImportBatch")(function* (
  id: string,
) {
  const batchId = yield* decodeInput(Uuid, id)
  const body = yield* requestJson(routeWithId(onboardingRoutes.batch, batchId))
  const result = yield* decodeResponse(ImportBatchSummary, body)

  return yield* checkBatch(result, batchId, "invalid-response")
})

export const importRowPageSize = 50

export const listImportErrors = Effect.fn("Frontend.Onboarding.listImportErrors")(function* (
  id: string,
  afterRowNumber: number,
) {
  const batchId = yield* decodeInput(Uuid, id)

  const query = yield* decodeInput(ListImportRowsQuery, {
    status: "invalid",
    afterRowNumber,
    limit: importRowPageSize + 1,
  })

  const body = yield* requestJson(
    `${routeWithId(onboardingRoutes.rows, batchId)}${querySuffix(query)}`,
  )

  return yield* decodeResponse(
    Schema.Array(ImportRow).check(Schema.isMaxLength(importRowPageSize + 1)),
    body,
  )
})

export const rehearsePartyImport = Effect.fn("Frontend.Onboarding.rehearsePartyImport")(function* (
  id: string,
) {
  const batchId = yield* decodeInput(Uuid, id)
  const body = yield* mutationRequest(routeWithId(onboardingRoutes.rehearse, batchId))
  const result = yield* decodeResponse(ImportBatchSummary, body, "unknown-outcome")

  return yield* checkBatch(result, batchId, "unknown-outcome")
})

export const applyPartyImport = Effect.fn("Frontend.Onboarding.applyPartyImport")(function* (
  id: string,
) {
  const batchId = yield* decodeInput(Uuid, id)
  const body = yield* mutationRequest(routeWithId(onboardingRoutes.apply, batchId))
  const result = yield* decodeResponse(ApplyImportResult, body, "unknown-outcome")

  return yield* checkBatch(result.summary, batchId, "unknown-outcome")
})

export const importFailureMessages = {
  CsvRequestTooLarge:
    "The upload is too large. Split the CSV into smaller files and keep the same source instance.",
  CsvUnreadable: "Save the data as a UTF-8 CSV file and try again.",
  ImportFileInvalid:
    "Check that the CSV has the required headers, valid quoting, and 1 to 2,000 records.",
  UnsupportedMappingRevision: "Reload Data imports before staging the file again.",
  ImportBatchNotFound:
    "This batch is unavailable in this tenant. Check the link or start a new import.",
  ImportBatchNotRehearsed: "Run the simulation for this batch before applying.",
  ImportBatchHasBlockingErrors:
    "Reload the batch to see its row errors, then upload a corrected CSV.",
  SourceRecordMappedConcurrently:
    "Another import processed a record from this source. Reload the batch and apply again to resume.",
  PartyNotFound: "An existing Party record is unavailable. Reload the batch before resuming.",
  PartyRoleAlreadyAssigned: "A Party role was already assigned. Reload the batch before resuming.",
  EventIdempotencyConflict:
    "A Party command conflicted with an existing event. Reload the batch before resuming.",
} as const
