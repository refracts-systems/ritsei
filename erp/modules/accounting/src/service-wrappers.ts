import * as Effect from "effect/Effect"

import { AccountingService } from "./contract.ts"

export const withAccountingOperationNames = (service: AccountingService): AccountingService => ({
  configureLegalEntity: Effect.fn("AccountingService.configureLegalEntity")(
    (input: Parameters<typeof service.configureLegalEntity>[0]) =>
      service.configureLegalEntity(input),
  ),
  recordFinancialVerificationArtifact: Effect.fn(
    "AccountingService.recordFinancialVerificationArtifact",
  )((input: Parameters<typeof service.recordFinancialVerificationArtifact>[0]) =>
    service.recordFinancialVerificationArtifact(input),
  ),
  recordFinancialStagingEvidence: Effect.fn("AccountingService.recordFinancialStagingEvidence")(
    (input: Parameters<typeof service.recordFinancialStagingEvidence>[0]) =>
      service.recordFinancialStagingEvidence(input),
  ),
  listFinancialStagingEvidence: Effect.fn("AccountingService.listFinancialStagingEvidence")(
    (input: Parameters<typeof service.listFinancialStagingEvidence>[0]) =>
      service.listFinancialStagingEvidence(input),
  ),
  prepareTigerBeetleCutover: Effect.fn("AccountingService.prepareTigerBeetleCutover")(
    (input: Parameters<typeof service.prepareTigerBeetleCutover>[0]) =>
      service.prepareTigerBeetleCutover(input),
  ),
  approveTigerBeetleCutover: Effect.fn("AccountingService.approveTigerBeetleCutover")(
    (input: Parameters<typeof service.approveTigerBeetleCutover>[0]) =>
      service.approveTigerBeetleCutover(input),
  ),
  activateTigerBeetleCutover: Effect.fn("AccountingService.activateTigerBeetleCutover")(
    (input: Parameters<typeof service.activateTigerBeetleCutover>[0]) =>
      service.activateTigerBeetleCutover(input),
  ),
  listAccountingConfigurations: Effect.fn("AccountingService.listAccountingConfigurations")(
    (input: Parameters<typeof service.listAccountingConfigurations>[0]) =>
      service.listAccountingConfigurations(input),
  ),
  listAccounts: Effect.fn("AccountingService.listAccounts")(
    (input: Parameters<typeof service.listAccounts>[0]) => service.listAccounts(input),
  ),
  listAccountingPeriods: Effect.fn("AccountingService.listAccountingPeriods")(
    (input: Parameters<typeof service.listAccountingPeriods>[0]) =>
      service.listAccountingPeriods(input),
  ),
  listRevenuePostingProfiles: Effect.fn("AccountingService.listRevenuePostingProfiles")(
    (input: Parameters<typeof service.listRevenuePostingProfiles>[0]) =>
      service.listRevenuePostingProfiles(input),
  ),
  listJournalEntries: Effect.fn("AccountingService.listJournalEntries")(
    (input: Parameters<typeof service.listJournalEntries>[0]) => service.listJournalEntries(input),
  ),
  createAccount: Effect.fn("AccountingService.createAccount")(
    (input: Parameters<typeof service.createAccount>[0]) => service.createAccount(input),
  ),
  configureRevenuePosting: Effect.fn("AccountingService.configureRevenuePosting")(
    (input: Parameters<typeof service.configureRevenuePosting>[0]) =>
      service.configureRevenuePosting(input),
  ),
  openPeriod: Effect.fn("AccountingService.openPeriod")(
    (input: Parameters<typeof service.openPeriod>[0]) => service.openPeriod(input),
  ),
  closePeriod: Effect.fn("AccountingService.closePeriod")(
    (input: Parameters<typeof service.closePeriod>[0]) => service.closePeriod(input),
  ),
  postRevenueForOrder: Effect.fn("AccountingService.postRevenueForOrder")(
    (input: Parameters<typeof service.postRevenueForOrder>[0]) =>
      service.postRevenueForOrder(input),
  ),
  reverseRevenueForOrder: Effect.fn("AccountingService.reverseRevenueForOrder")(
    (input: Parameters<typeof service.reverseRevenueForOrder>[0]) =>
      service.reverseRevenueForOrder(input),
  ),
  postJournal: Effect.fn("AccountingService.postJournal")(
    (input: Parameters<typeof service.postJournal>[0]) => service.postJournal(input),
  ),
})
