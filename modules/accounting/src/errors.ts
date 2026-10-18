import * as Schema from "effect/Schema"

const Uuid = Schema.String.check(Schema.isUUID())
const TrimmedNonEmptyString = Schema.String.check(
  Schema.makeFilter((value) => /\S/.test(value) && value === value.trim(), {
    expected: "a trimmed nonblank string",
  }),
)
const UpperTrimmedNonEmptyString = Schema.String.check(
  Schema.makeFilter(
    (value) => /\S/.test(value) && value === value.trim() && value === value.toUpperCase(),
    { expected: "a trimmed uppercase nonblank string" },
  ),
)

export class AccountingConfigurationAlreadyExists extends Schema.TaggedError<AccountingConfigurationAlreadyExists>()(
  "AccountingConfigurationAlreadyExists",
  {
    tenantId: Uuid,
    legalEntityId: Uuid,
  },
) {}
export class FinancialEngineActivated extends Schema.TaggedError<FinancialEngineActivated>()(
  "FinancialEngineActivated",
  {
    tenantId: Uuid,
    legalEntityId: Uuid,
  },
) {}
export class FinancialEngineCutoverBlocked extends Schema.TaggedError<FinancialEngineCutoverBlocked>()(
  "FinancialEngineCutoverBlocked",
  {
    tenantId: Uuid,
    legalEntityId: Uuid,
    reason: Schema.Literals([
      "activation_gates_pending",
      "not_prepared",
      "verification_mismatch",
      "unresolved_operations",
      "ledger_not_configured",
      "account_provisioning_failed",
    ]),
  },
) {}

export class FinancialVerificationArtifactNotFound extends Schema.TaggedError<FinancialVerificationArtifactNotFound>()(
  "FinancialVerificationArtifactNotFound",
  { tenantId: Uuid, artifactId: Uuid },
) {}
export class FinancialVerificationArtifactInvalid extends Schema.TaggedError<FinancialVerificationArtifactInvalid>()(
  "FinancialVerificationArtifactInvalid",
  {
    tenantId: Uuid,
    legalEntityId: Uuid,
    reason: Schema.Literals(["scope_mismatch", "incomplete", "mismatch", "stale", "unsigned"]),
  },
) {}

export class FinancialStagingEvidenceConflict extends Schema.TaggedError<FinancialStagingEvidenceConflict>()(
  "FinancialStagingEvidenceConflict",
  {
    tenantId: Uuid,
    recordId: Uuid,
    reason: Schema.Literal("different_content"),
  },
) {}
export class FinancialStagingEvidenceInvalid extends Schema.TaggedError<FinancialStagingEvidenceInvalid>()(
  "FinancialStagingEvidenceInvalid",
  {
    tenantId: Uuid,
    recordId: Uuid,
    reason: Schema.Literals([
      "scope_mismatch",
      "operator_mismatch",
      "hash_mismatch",
      "canonicalization_version",
      "stored_payload_invalid",
    ]),
  },
) {}

export class AccountingLegalEntityNotFound extends Schema.TaggedError<AccountingLegalEntityNotFound>()(
  "AccountingLegalEntityNotFound",
  {
    tenantId: Uuid,
    legalEntityId: Uuid,
  },
) {}
export class AccountAlreadyExists extends Schema.TaggedError<AccountAlreadyExists>()(
  "AccountAlreadyExists",
  {
    tenantId: Uuid,
    code: UpperTrimmedNonEmptyString,
  },
) {}
export class AccountNotFound extends Schema.TaggedError<AccountNotFound>()("AccountNotFound", {
  tenantId: Uuid,
}) {}
export class JournalReferenceAlreadyExists extends Schema.TaggedError<JournalReferenceAlreadyExists>()(
  "JournalReferenceAlreadyExists",
  {
    tenantId: Uuid,
    reference: TrimmedNonEmptyString,
  },
) {}
export class JournalIdempotencyConflict extends Schema.TaggedError<JournalIdempotencyConflict>()(
  "JournalIdempotencyConflict",
  {
    tenantId: Uuid,
    reference: TrimmedNonEmptyString,
  },
) {}
export class InvalidJournalLine extends Schema.TaggedError<InvalidJournalLine>()(
  "InvalidJournalLine",
  {
    index: Schema.Int,
  },
) {}
export class UnbalancedJournal extends Schema.TaggedError<UnbalancedJournal>()(
  "UnbalancedJournal",
  {
    debit: Schema.String,
    credit: Schema.String,
  },
) {}
export class RevenuePostingProfileAlreadyExists extends Schema.TaggedError<RevenuePostingProfileAlreadyExists>()(
  "RevenuePostingProfileAlreadyExists",
  { tenantId: Uuid, legalEntityId: Uuid },
) {}
export class InvalidRevenuePostingProfile extends Schema.TaggedError<InvalidRevenuePostingProfile>()(
  "InvalidRevenuePostingProfile",
  {
    tenantId: Uuid,
    legalEntityId: Uuid,
  },
) {}
export class AccountingPeriodOverlap extends Schema.TaggedError<AccountingPeriodOverlap>()(
  "AccountingPeriodOverlap",
  {
    tenantId: Uuid,
    legalEntityId: Uuid,
  },
) {}
export class AccountingPeriodNotFound extends Schema.TaggedError<AccountingPeriodNotFound>()(
  "AccountingPeriodNotFound",
  {
    tenantId: Uuid,
    legalEntityId: Uuid,
    periodId: Uuid,
  },
) {}
export class AccountingPeriodNotOpen extends Schema.TaggedError<AccountingPeriodNotOpen>()(
  "AccountingPeriodNotOpen",
  {
    tenantId: Uuid,
    legalEntityId: Uuid,
  },
) {}
export class FinancialOperationsPending extends Schema.TaggedError<FinancialOperationsPending>()(
  "FinancialOperationsPending",
  {
    tenantId: Uuid,
    legalEntityId: Uuid,
    periodId: Uuid,
  },
) {}
export class RevenuePostingProfileNotFound extends Schema.TaggedError<RevenuePostingProfileNotFound>()(
  "RevenuePostingProfileNotFound",
  {
    tenantId: Uuid,
    legalEntityId: Uuid,
  },
) {}
export class RevenueJournalNotFound extends Schema.TaggedError<RevenueJournalNotFound>()(
  "RevenueJournalNotFound",
  {
    tenantId: Uuid,
    legalEntityId: Uuid,
    orderId: Uuid,
  },
) {}
