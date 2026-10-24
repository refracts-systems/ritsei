import * as Layer from "effect/Layer"

import {
  FinancialOperationService,
  FinancialOperationServiceLive,
  makeFinancialOperationService,
} from "./financial-operations.ts"
import { FinancialStagingEvidencePostgresLive } from "./financial-staging-evidence.ts"
import { GeneralLedgerService } from "./general-ledger-contract.ts"
import { makeGeneralLedgerPostgresStore } from "./general-ledger-postgres.ts"
import { makeGeneralLedgerServiceFromStore } from "./general-ledger-service.ts"
import { AccountingService, makeAccountingService, makeAccountingTestLayer } from "./service.ts"

/** The Accounting control-plane service with its requirements left to the composition root. */
export const AccountingServiceLive = Layer.effect(AccountingService, makeAccountingService)

/** Named production composition for the Accounting control-plane service. */
export const AccountingLive = AccountingServiceLive.pipe(
  Layer.provide(FinancialStagingEvidencePostgresLive),
)

/** Named production composition for financial operation submission/reconciliation. */
export const FinancialOperationsLive = FinancialOperationServiceLive

export const AccountingPostgresLive = AccountingLive
export const FinancialOperationsPostgresLive = FinancialOperationsLive

export const makeAccountingTestLive = makeAccountingTestLayer

export const makeFinancialOperationsTestLive = () =>
  Layer.effect(FinancialOperationService, makeFinancialOperationService)

export { makeAccountingService, makeAccountingTestLayer }

export { FinancialOperationServiceLive }

/** The general ledger over PostgreSQL; requires Database, Authorization, and Numbering. */
export const makeGeneralLedgerService = makeGeneralLedgerServiceFromStore(
  makeGeneralLedgerPostgresStore(),
)

export const GeneralLedgerLive = Layer.effect(GeneralLedgerService, makeGeneralLedgerService)
