/** Compatibility facade for the engine-independent financial ledger port. */
export { FinancialLedgerPort, makeFinancialLedgerTestLayer } from "./financial-ledger.ts"
export type {
  CreateExecutionAccountInput,
  FinancialAccountConstraint,
  FinancialBalanceOutcome,
  FinancialExecutionOutcome,
  FinancialJournalLine,
  FinancialLedgerAuthority,
  GetFinancialBalanceInput,
  PostFinancialJournalInput,
} from "./financial-ledger.ts"
