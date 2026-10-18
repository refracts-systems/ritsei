import * as Layer from "effect/Layer"

import {
  FinancialOperationService,
  FinancialOperationServiceLive,
  makeFinancialOperationService,
} from "./financial-operations.ts"
import { FinancialStagingEvidencePostgresLive } from "./financial-staging-evidence.ts"
import { AccountingService, makeAccountingService, makeAccountingTestLayer } from "./service.ts"

/** Named production composition for the Accounting control-plane service. */
export const AccountingLive = Layer.effect(AccountingService, makeAccountingService).pipe(
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
