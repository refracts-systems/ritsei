// HTTP adapter for this module (ADR-0094). Only the composition root imports this file.
import * as Effect from "effect/Effect"
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder"
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint"
import * as HttpApiGroup from "effect/http-api/HttpApiGroup"
import * as HttpApiSchema from "effect/http-api/HttpApiSchema"
import * as Schema from "effect/Schema"

import {
  ApiErrors,
  BaseApiErrorPolicy,
  BearerAuth,
  CurrentPrincipal,
  apiErrorMapping,
  moduleApi,
  ReadLimit,
  ShortString,
  TenantHeaders,
  Uuid,
} from "../../../framework/modules/http/mod.ts"
import {
  ApplyImportResult,
  ImportBatchSummary,
  ImportObjectKind,
  ImportRow,
  ImportRowStatus,
  MaxCsvCharacters,
  OnboardingService,
  StagedImport,
} from "./mod.ts"

export const OnboardingHttpGroup = HttpApiGroup.make("Onboarding").add(
  HttpApiEndpoint.post("stageImport", "/onboarding/imports", {
    headers: TenantHeaders,
    payload: Schema.Struct({
      sourceInstance: ShortString,
      sourceVersion: Schema.optionalKey(ShortString),
      objectKind: ImportObjectKind,
      mappingRevision: ShortString,
      csv: Schema.String.check(Schema.isMaxLength(MaxCsvCharacters)),
    }),
    success: StagedImport.pipe(HttpApiSchema.status(201)),
    error: ApiErrors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.get("getImport", "/onboarding/imports/:id", {
    params: { id: Uuid },
    headers: TenantHeaders,
    success: ImportBatchSummary,
    error: ApiErrors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.get("listImportRows", "/onboarding/imports/:id/rows", {
    params: { id: Uuid },
    headers: TenantHeaders,
    query: { status: Schema.optionalKey(ImportRowStatus), limit: ReadLimit },
    success: Schema.Array(ImportRow),
    error: ApiErrors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("rehearseImport", "/onboarding/imports/:id/rehearse", {
    params: { id: Uuid },
    headers: TenantHeaders,
    success: ImportBatchSummary,
    error: ApiErrors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("applyImport", "/onboarding/imports/:id/apply", {
    params: { id: Uuid },
    headers: TenantHeaders,
    success: ApplyImportResult,
    error: ApiErrors,
  }).middleware(BearerAuth),
)

const OnboardingHttpApi = moduleApi(OnboardingHttpGroup)

export const OnboardingHttpErrors = apiErrorMapping({
  ...BaseApiErrorPolicy,
  ImportFileInvalid: "conflict",
  UnsupportedMappingRevision: "conflict",
  ImportBatchNotFound: "not_found",
  ImportBatchNotRehearsed: "conflict",
  ImportBatchHasBlockingErrors: "conflict",
  SourceRecordMappedConcurrently: "conflict",
  PartyNotFound: "conflict",
  PartyRoleAlreadyAssigned: "conflict",
})

export const OnboardingHttpHandlers = HttpApiBuilder.group(
  OnboardingHttpApi,
  "Onboarding",
  (handlers) =>
    Effect.gen(function* () {
      const service = yield* OnboardingService

      return handlers
        .handle(
          "stageImport",
          Effect.fn("Http.Onboarding.stageImport")(function* ({ headers, payload }) {
            const principal = yield* CurrentPrincipal

            return yield* OnboardingHttpErrors.apiEffect(
              service.stage({ principal, tenantId: headers["x-tenant-id"], ...payload }),
            )
          }),
        )
        .handle(
          "getImport",
          Effect.fn("Http.Onboarding.getImport")(function* ({ headers, params }) {
            const principal = yield* CurrentPrincipal

            return yield* OnboardingHttpErrors.apiEffect(
              service.getBatch({ principal, tenantId: headers["x-tenant-id"], batchId: params.id }),
            )
          }),
        )
        .handle(
          "listImportRows",
          Effect.fn("Http.Onboarding.listImportRows")(function* ({ headers, params, query }) {
            const principal = yield* CurrentPrincipal

            return yield* OnboardingHttpErrors.apiEffect(
              service.listRows({
                principal,
                tenantId: headers["x-tenant-id"],
                batchId: params.id,
                ...query,
              }),
            )
          }),
        )
        .handle(
          "rehearseImport",
          Effect.fn("Http.Onboarding.rehearseImport")(function* ({ headers, params }) {
            const principal = yield* CurrentPrincipal

            return yield* OnboardingHttpErrors.apiEffect(
              service.rehearse({
                principal,
                tenantId: headers["x-tenant-id"],
                batchId: params.id,
              }),
            )
          }),
        )
        .handle(
          "applyImport",
          Effect.fn("Http.Onboarding.applyImport")(function* ({ headers, params }) {
            const principal = yield* CurrentPrincipal

            return yield* OnboardingHttpErrors.apiEffect(
              service.apply({ principal, tenantId: headers["x-tenant-id"], batchId: params.id }),
            )
          }),
        )
    }),
)
