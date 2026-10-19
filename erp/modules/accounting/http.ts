// HTTP adapter for this module (ADR-0094). Only the composition root imports this file.
import * as Effect from "effect/Effect"
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder"
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint"
import * as HttpApiGroup from "effect/http-api/HttpApiGroup"
import * as HttpApiSchema from "effect/http-api/HttpApiSchema"
import * as Schema from "effect/Schema"

import { FinancialMajorAmount } from "../../../framework/foundation/mod.ts"
import {
  ApiErrors as errors,
  BaseApiErrorPolicy,
  BearerAuth,
  BoundedArray,
  CurrencyCode,
  CurrentPrincipal,
  MaxApiCollectionItems,
  PositiveInt,
  ShortString,
  TenantHeaders as tenantHeaders,
  Uuid,
  makeApiErrorMapping,
  makeModuleApi,
} from "../../../framework/modules/http/mod.ts"
import {
  Account,
  AccountingConfiguration,
  AccountingPeriod,
  AccountingService,
  FINANCIAL_STAGING_EVIDENCE_CANONICALIZATION_VERSION,
  FinancialCutoverControl,
  FinancialOperation,
  FinancialOperationService,
  FinancialProjectionRebuildResult,
  FinancialReconciliationCheckpoint,
  FinancialStagingEvidence,
  FinancialStagingEvidenceRecord,
  FinancialVerificationArtifact,
  FinancialVerificationEvidence,
  JournalEntry,
  JournalLine,
  RevenuePostingProfile,
} from "./mod.ts"

const AccountingReadLimit = Schema.optionalKey(
  Schema.NumberFromString.pipe(
    Schema.check(Schema.isInt()),
    Schema.check(Schema.isBetween({ minimum: 1, maximum: 200 })),
  ),
)
const CreatedFinancialVerificationArtifact = FinancialVerificationArtifact.pipe(
  HttpApiSchema.status(201),
)
const FinancialStagingEvidenceAppendPayload = Schema.Struct({
  evidence: FinancialStagingEvidence,
  canonicalizationVersion: Schema.Literal(FINANCIAL_STAGING_EVIDENCE_CANONICALIZATION_VERSION),
  evidenceHash: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/), Schema.isMaxLength(64)),
})
const FinancialStagingEvidenceLookupQuery = Schema.Struct({
  legalEntityId: Schema.optionalKey(Uuid),
  gateId: Schema.optionalKey(ShortString),
  cohortId: Schema.optionalKey(ShortString),
  deploymentRevision: Schema.optionalKey(ShortString),
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: MaxApiCollectionItems })),
}).check(
  Schema.makeFilter(
    (query) =>
      query.gateId !== undefined ||
      query.cohortId !== undefined ||
      query.deploymentRevision !== undefined,
    { expected: "staging evidence lookup requires gate, cohort, or deployment scope" },
  ),
)
const FinancialStagingEvidenceList = BoundedArray(FinancialStagingEvidenceRecord)
const FiscalYearStartMonth = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 12 }))
const CreatedAccountingConfiguration = AccountingConfiguration.pipe(HttpApiSchema.status(201))
const CreatedAccount = Account.pipe(HttpApiSchema.status(201))
const CreatedJournal = JournalEntry.pipe(HttpApiSchema.status(201))
const CreatedRevenuePostingProfile = RevenuePostingProfile.pipe(HttpApiSchema.status(201))
const CreatedAccountingPeriod = AccountingPeriod.pipe(HttpApiSchema.status(201))
const CreatedFinancialOperation = FinancialOperation.pipe(HttpApiSchema.status(201))

export const AccountingHttpGroup = HttpApiGroup.make("Accounting").add(
  HttpApiEndpoint.get("listConfigurations", "/accounting/configurations", {
    headers: tenantHeaders,
    query: {
      legalEntityId: Schema.optionalKey(Uuid),
      limit: AccountingReadLimit,
    },
    success: BoundedArray(AccountingConfiguration),
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.get("listAccounts", "/accounting/accounts", {
    headers: tenantHeaders,
    query: {
      type: Schema.optionalKey(Account.fields.type),
      limit: AccountingReadLimit,
    },
    success: BoundedArray(Account),
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.get("listPeriods", "/accounting/periods", {
    headers: tenantHeaders,
    query: {
      legalEntityId: Schema.optionalKey(Uuid),
      status: Schema.optionalKey(AccountingPeriod.fields.status),
      limit: AccountingReadLimit,
    },
    success: BoundedArray(AccountingPeriod),
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.get("listRevenuePostingProfiles", "/accounting/revenue-posting-profiles", {
    headers: tenantHeaders,
    query: {
      legalEntityId: Schema.optionalKey(Uuid),
      limit: AccountingReadLimit,
    },
    success: BoundedArray(RevenuePostingProfile),
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.get("listJournals", "/accounting/journals", {
    headers: tenantHeaders,
    query: {
      status: Schema.optionalKey(Schema.Literals(["posted", "reversed"])),
      limit: AccountingReadLimit,
    },
    success: BoundedArray(JournalEntry),
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post(
    "prepareTigerBeetleCutover",
    "/accounting/legal-entities/:id/tigerbeetle/prepare",
    {
      params: { id: Uuid },
      headers: tenantHeaders,
      success: FinancialCutoverControl,
      error: errors,
    },
  ).middleware(BearerAuth),
  HttpApiEndpoint.post(
    "recordFinancialVerificationArtifact",
    "/accounting/financial-verification-artifacts",
    {
      headers: tenantHeaders,
      payload: FinancialVerificationEvidence,
      success: CreatedFinancialVerificationArtifact,
      error: errors,
    },
  ).middleware(BearerAuth),
  HttpApiEndpoint.post("recordFinancialStagingEvidence", "/accounting/financial-staging-evidence", {
    headers: tenantHeaders,
    payload: FinancialStagingEvidenceAppendPayload,
    success: FinancialStagingEvidenceRecord.pipe(HttpApiSchema.status(201)),
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.get("listFinancialStagingEvidence", "/accounting/financial-staging-evidence", {
    headers: tenantHeaders,
    query: FinancialStagingEvidenceLookupQuery,
    success: FinancialStagingEvidenceList,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post(
    "approveTigerBeetleCutover",
    "/accounting/legal-entities/:id/tigerbeetle/approve",
    {
      params: { id: Uuid },
      headers: tenantHeaders,
      payload: Schema.Struct({ evidenceArtifactId: Uuid }),
      success: FinancialCutoverControl,
      error: errors,
    },
  ).middleware(BearerAuth),
  HttpApiEndpoint.post(
    "activateTigerBeetleCutover",
    "/accounting/legal-entities/:id/tigerbeetle/activate",
    {
      params: { id: Uuid },
      headers: tenantHeaders,
      success: FinancialCutoverControl,
      error: errors,
    },
  ).middleware(BearerAuth),
  HttpApiEndpoint.post("configureLegalEntity", "/accounting/legal-entities/:id/configuration", {
    params: { id: Uuid },
    headers: tenantHeaders,
    payload: Schema.Struct({
      baseCurrency: CurrencyCode,
      precision: Schema.Literal(2),
      fiscalYearStartMonth: FiscalYearStartMonth,
      postingEnabled: Schema.Boolean,
      financialEngine: Schema.optionalKey(Schema.Literals(["postgresql", "tigerbeetle"])),
    }),
    success: CreatedAccountingConfiguration,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("createAccount", "/accounting/accounts", {
    headers: tenantHeaders,
    payload: Schema.Struct({
      code: ShortString,
      name: ShortString,
      type: Account.fields.type,
    }),
    success: CreatedAccount,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("postJournal", "/accounting/journals", {
    headers: tenantHeaders,
    payload: Schema.Struct({
      reference: ShortString,
      lines: BoundedArray(JournalLine),
    }),
    success: CreatedJournal,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("configureRevenuePosting", "/accounting/revenue-posting-profiles", {
    headers: tenantHeaders,
    payload: Schema.Struct({
      legalEntityId: Uuid,
      receivableAccountId: Uuid,
      revenueAccountId: Uuid,
    }),
    success: CreatedRevenuePostingProfile,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("openPeriod", "/accounting/periods", {
    headers: tenantHeaders,
    payload: Schema.Struct({
      legalEntityId: Uuid,
      startsOn: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)),
      endsOn: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)),
    }),
    success: CreatedAccountingPeriod,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("closePeriod", "/accounting/periods/:id/close", {
    params: { id: Uuid },
    headers: tenantHeaders,
    payload: Schema.Struct({ legalEntityId: Uuid }),
    success: AccountingPeriod,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("rebuildFinancialProjections", "/accounting/financial-projections/rebuild", {
    headers: tenantHeaders,
    payload: Schema.Struct({ legalEntityId: Uuid }),
    success: FinancialProjectionRebuildResult,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post(
    "reconcileFinancialCheckpoint",
    "/accounting/financial-reconciliation/checkpoints",
    {
      headers: tenantHeaders,
      payload: Schema.Struct({
        legalEntityId: Uuid,
        evidenceArtifactId: Schema.NullOr(Uuid),
      }),
      success: FinancialReconciliationCheckpoint,
      error: errors,
    },
  ).middleware(BearerAuth),
  HttpApiEndpoint.post("createFinancialJournalIntent", "/accounting/financial-operations", {
    headers: tenantHeaders,
    payload: Schema.Struct({
      legalEntityId: Uuid,
      operationId: ShortString,
      reference: ShortString,
      currency: CurrencyCode,
      mappingVersion: PositiveInt,
      lines: BoundedArray(JournalLine),
      correlationId: ShortString,
    }),
    success: CreatedFinancialOperation,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post("createFinancialRevenueIntent", "/accounting/financial-operations/revenue", {
    headers: tenantHeaders,
    payload: Schema.Struct({
      legalEntityId: Uuid,
      orderId: Uuid,
      commandId: ShortString,
      correlationId: ShortString,
      currency: CurrencyCode,
      mappingVersion: PositiveInt,
      amount: Schema.optionalKey(FinancialMajorAmount),
    }),
    success: CreatedFinancialOperation,
    error: errors,
  }).middleware(BearerAuth),
  HttpApiEndpoint.post(
    "createFinancialReversalIntent",
    "/accounting/financial-operations/reversals",
    {
      headers: tenantHeaders,
      payload: Schema.Struct({
        legalEntityId: Uuid,
        sourceJournalId: Uuid,
        operationId: ShortString,
        reference: ShortString,
        currency: CurrencyCode,
        mappingVersion: PositiveInt,
        correlationId: ShortString,
      }),
      success: CreatedFinancialOperation,
      error: errors,
    },
  ).middleware(BearerAuth),
)

const AccountingHttpApi = makeModuleApi(AccountingHttpGroup)

export const AccountingHttpErrors = makeApiErrorMapping({
  ...BaseApiErrorPolicy,
  SalesOrderInvalidState: "conflict",
  SalesOrderNotFound: "not_found",
  AccountAlreadyExists: "conflict",
  AccountNotFound: "not_found",
  AccountingConfigurationAlreadyExists: "conflict",
  AccountingLegalEntityNotFound: "not_found",
  AccountingPeriodNotFound: "not_found",
  AccountingPeriodNotOpen: "conflict",
  AccountingPeriodOverlap: "conflict",
  FinancialCurrencyMismatch: "conflict",
  FinancialEngineActivated: "conflict",
  FinancialEngineCutoverBlocked: "conflict",
  FinancialLedgerNotActivated: "conflict",
  FinancialLedgerNotConfigured: "service_unavailable",
  FinancialOperationConflict: "conflict",
  FinancialOperationInjectedFailure: "conflict",
  FinancialOperationNotFound: "not_found",
  FinancialOperationReconciliationConflict: "conflict",
  FinancialOperationsPending: "conflict",
  FinancialProjectionRebuildBlocked: "conflict",
  FinancialReconciliationCheckpointConflict: "conflict",
  FinancialReconciliationCheckpointEvidenceInvalid: "conflict",
  FinancialRevenueAmountMismatch: "conflict",
  FinancialReversalAlreadyExists: "conflict",
  FinancialReversalSourceNotFound: "not_found",
  FinancialReversalSourceNotPosted: "conflict",
  FinancialReversalSourceNotReady: "conflict",
  FinancialReversalSourceRequired: "conflict",
  FinancialSalesNotConfigured: "service_unavailable",
  FinancialStagingEvidenceConflict: "conflict",
  FinancialStagingEvidenceInvalid: "conflict",
  FinancialStoreObservationFailure: "service_unavailable",
  FinancialVerificationArtifactInvalid: "conflict",
  FinancialVerificationArtifactNotFound: "not_found",
  FinancialVerificationKeyGenerationFailure: "conflict",
  FinancialVerificationKeyNotFound: "not_found",
  FinancialVerificationSigningFailure: "conflict",
  FinancialVerificationVerificationFailure: "conflict",
  InvalidJournalLine: "conflict",
  InvalidRevenuePostingProfile: "conflict",
  JournalIdempotencyConflict: "conflict",
  JournalReferenceAlreadyExists: "conflict",
  RevenueJournalNotFound: "not_found",
  RevenuePostingProfileAlreadyExists: "conflict",
  RevenuePostingProfileNotFound: "not_found",
  TigerBeetleConfigurationFailure: "conflict",
  UnbalancedJournal: "conflict",
})
const coreApiEffect = AccountingHttpErrors.apiEffect

export const AccountingHttpHandlers = HttpApiBuilder.group(
  AccountingHttpApi,
  "Accounting",
  (handlers) =>
    Effect.gen(function* () {
      const accounting = yield* AccountingService
      const financialOperations = yield* FinancialOperationService
      return handlers
        .handle(
          "listConfigurations",
          Effect.fn("Http.Accounting.listConfigurations")(function* ({ headers, query }) {
            const principal = yield* CurrentPrincipal
            return yield* coreApiEffect(
              accounting.listAccountingConfigurations({
                principal,
                tenantId: headers["x-tenant-id"],
                ...query,
              }),
            )
          }),
        )
        .handle(
          "listAccounts",
          Effect.fn("Http.Accounting.listAccounts")(function* ({ headers, query }) {
            const principal = yield* CurrentPrincipal
            return yield* coreApiEffect(
              accounting.listAccounts({
                principal,
                tenantId: headers["x-tenant-id"],
                ...query,
              }),
            )
          }),
        )
        .handle(
          "listPeriods",
          Effect.fn("Http.Accounting.listPeriods")(function* ({ headers, query }) {
            const principal = yield* CurrentPrincipal
            return yield* coreApiEffect(
              accounting.listAccountingPeriods({
                principal,
                tenantId: headers["x-tenant-id"],
                ...query,
              }),
            )
          }),
        )
        .handle(
          "listRevenuePostingProfiles",
          Effect.fn("Http.Accounting.listRevenuePostingProfiles")(function* ({ headers, query }) {
            const principal = yield* CurrentPrincipal
            return yield* coreApiEffect(
              accounting.listRevenuePostingProfiles({
                principal,
                tenantId: headers["x-tenant-id"],
                ...query,
              }),
            )
          }),
        )
        .handle(
          "listJournals",
          Effect.fn("Http.Accounting.listJournals")(function* ({ headers, query }) {
            const principal = yield* CurrentPrincipal
            return yield* coreApiEffect(
              accounting.listJournalEntries({
                principal,
                tenantId: headers["x-tenant-id"],
                ...query,
              }),
            )
          }),
        )
        .handle(
          "prepareTigerBeetleCutover",
          Effect.fn("Http.Accounting.prepareTigerBeetleCutover")(function* ({ headers, params }) {
            const principal = yield* CurrentPrincipal
            return yield* coreApiEffect(
              accounting.prepareTigerBeetleCutover({
                principal,
                tenantId: headers["x-tenant-id"],
                legalEntityId: params.id,
              }),
            )
          }),
        )
        .handle(
          "recordFinancialVerificationArtifact",
          Effect.fn("Http.Accounting.recordFinancialVerificationArtifact")(function* ({
            headers,
            payload,
          }) {
            const principal = yield* CurrentPrincipal
            return yield* coreApiEffect(
              accounting.recordFinancialVerificationArtifact({
                principal,
                tenantId: headers["x-tenant-id"],
                evidence: payload,
              }),
            )
          }),
        )
        .handle(
          "recordFinancialStagingEvidence",
          Effect.fn("Http.Accounting.recordFinancialStagingEvidence")(function* ({
            headers,
            payload,
          }) {
            const principal = yield* CurrentPrincipal
            return yield* coreApiEffect(
              accounting.recordFinancialStagingEvidence({
                principal,
                tenantId: headers["x-tenant-id"],
                ...payload,
              }),
            )
          }),
        )
        .handle(
          "listFinancialStagingEvidence",
          Effect.fn("Http.Accounting.listFinancialStagingEvidence")(function* ({ headers, query }) {
            const principal = yield* CurrentPrincipal
            return yield* coreApiEffect(
              accounting.listFinancialStagingEvidence({
                principal,
                tenantId: headers["x-tenant-id"],
                ...query,
              }),
            )
          }),
        )
        .handle(
          "approveTigerBeetleCutover",
          Effect.fn("Http.Accounting.approveTigerBeetleCutover")(function* ({
            headers,
            params,
            payload,
          }) {
            const principal = yield* CurrentPrincipal
            return yield* coreApiEffect(
              accounting.approveTigerBeetleCutover({
                principal,
                tenantId: headers["x-tenant-id"],
                legalEntityId: params.id,
                ...payload,
              }),
            )
          }),
        )
        .handle(
          "activateTigerBeetleCutover",
          Effect.fn("Http.Accounting.activateTigerBeetleCutover")(function* ({ headers, params }) {
            const principal = yield* CurrentPrincipal
            return yield* coreApiEffect(
              accounting.activateTigerBeetleCutover({
                principal,
                tenantId: headers["x-tenant-id"],
                legalEntityId: params.id,
              }),
            )
          }),
        )
        .handle(
          "configureLegalEntity",
          Effect.fn("Http.Accounting.configureLegalEntity")(function* ({
            headers,
            params,
            payload,
          }) {
            const principal = yield* CurrentPrincipal
            return yield* coreApiEffect(
              accounting.configureLegalEntity({
                principal,
                tenantId: headers["x-tenant-id"],
                legalEntityId: params.id,
                ...payload,
              }),
            )
          }),
        )
        .handle(
          "createAccount",
          Effect.fn("Http.Accounting.createAccount")(function* ({ headers, payload }) {
            const principal = yield* CurrentPrincipal
            return yield* coreApiEffect(
              accounting.createAccount({ principal, tenantId: headers["x-tenant-id"], ...payload }),
            )
          }),
        )
        .handle(
          "postJournal",
          Effect.fn("Http.Accounting.postJournal")(function* ({ headers, payload }) {
            const principal = yield* CurrentPrincipal
            return yield* coreApiEffect(
              accounting.postJournal({ principal, tenantId: headers["x-tenant-id"], ...payload }),
            )
          }),
        )
        .handle(
          "configureRevenuePosting",
          Effect.fn("Http.Accounting.configureRevenuePosting")(function* ({ headers, payload }) {
            const principal = yield* CurrentPrincipal
            return yield* coreApiEffect(
              accounting.configureRevenuePosting({
                principal,
                tenantId: headers["x-tenant-id"],
                ...payload,
              }),
            )
          }),
        )
        .handle(
          "openPeriod",
          Effect.fn("Http.Accounting.openPeriod")(function* ({ headers, payload }) {
            const principal = yield* CurrentPrincipal
            return yield* coreApiEffect(
              accounting.openPeriod({
                principal,
                tenantId: headers["x-tenant-id"],
                ...payload,
              }),
            )
          }),
        )
        .handle(
          "closePeriod",
          Effect.fn("Http.Accounting.closePeriod")(function* ({ headers, params, payload }) {
            const principal = yield* CurrentPrincipal
            return yield* coreApiEffect(
              accounting.closePeriod({
                principal,
                tenantId: headers["x-tenant-id"],
                periodId: params.id,
                ...payload,
              }),
            )
          }),
        )
        .handle(
          "rebuildFinancialProjections",
          Effect.fn("Http.Accounting.rebuildFinancialProjections")(function* ({
            headers,
            payload,
          }) {
            const principal = yield* CurrentPrincipal
            return yield* coreApiEffect(
              financialOperations.rebuildFinancialProjections({
                principal,
                tenantId: headers["x-tenant-id"],
                ...payload,
              }),
            )
          }),
        )
        .handle(
          "reconcileFinancialCheckpoint",
          Effect.fn("Http.Accounting.reconcileFinancialCheckpoint")(function* ({
            headers,
            payload,
          }) {
            const principal = yield* CurrentPrincipal
            return yield* coreApiEffect(
              financialOperations.reconcileFinancialCheckpoint({
                principal,
                tenantId: headers["x-tenant-id"],
                ...payload,
              }),
            )
          }),
        )
        .handle(
          "createFinancialJournalIntent",
          Effect.fn("Http.Accounting.createFinancialJournalIntent")(function* ({
            headers,
            payload,
          }) {
            const principal = yield* CurrentPrincipal
            return yield* coreApiEffect(
              financialOperations.createJournalIntent({
                principal,
                tenantId: headers["x-tenant-id"],
                ...payload,
              }),
            )
          }),
        )
        .handle(
          "createFinancialRevenueIntent",
          Effect.fn("Http.Accounting.createFinancialRevenueIntent")(function* ({
            headers,
            payload,
          }) {
            const principal = yield* CurrentPrincipal
            return yield* coreApiEffect(
              financialOperations.createRevenueIntent({
                principal,
                tenantId: headers["x-tenant-id"],
                ...payload,
              }),
            )
          }),
        )
        .handle(
          "createFinancialReversalIntent",
          Effect.fn("Http.Accounting.createFinancialReversalIntent")(function* ({
            headers,
            payload,
          }) {
            const principal = yield* CurrentPrincipal
            return yield* coreApiEffect(
              financialOperations.createReversalIntent({
                principal,
                tenantId: headers["x-tenant-id"],
                ...payload,
              }),
            )
          }),
        )
    }),
)
