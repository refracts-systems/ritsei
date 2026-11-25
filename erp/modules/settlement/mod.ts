export { bankStatementHeader, parseBankStatement } from "./src/bank-statement.ts"

export type { ParsedBankLine } from "./src/bank-statement.ts"

export { SettlementCapabilities } from "./src/capabilities.ts"

export {
  AgingInput,
  AgingReport,
  AllocatePaymentInput,
  Allocation,
  AssignPartyTermInput,
  BankLineMatch,
  BankReconciliation,
  BankReconciliationInput,
  BankStatement,
  CreatePaymentTermInput,
  CustomerStatement,
  ImportBankStatementInput,
  ListPaymentsInput,
  MakePaymentInput,
  MatchBankLineInput,
  NumberCandidate,
  NumberLookupInput,
  OverdueInput,
  OverdueReceivable,
  Payment,
  PaymentDirection,
  PaymentTerm,
  ReceivePaymentInput,
  ReverseBankMatchInput,
  SettlementService,
  SettlementSide,
  StatementEntry,
  StatementInput,
  Withholding,
} from "./src/contract.ts"

export type {
  AgingReport as AgingReportType,
  BankMatchFailure,
  BankReconciliation as BankReconciliationType,
  BankStatement as BankStatementType,
  CustomerStatement as CustomerStatementType,
  Payment as PaymentType,
  PaymentFailure,
  SettlementService as SettlementServiceContract,
} from "./src/contract.ts"

export {
  AllocationBeforePayment,
  AllocationExceedsPayment,
  AllocationMismatch,
  BankLineNotFound,
  BankMatchExceedsAvailable,
  BankMatchMismatch,
  BankMatchNotFound,
  InvalidBankStatement,
  InvalidWithholding,
  PaymentNotFound,
  PaymentTermAlreadyExists,
  PaymentTermNotFound,
} from "./src/errors.ts"

export { SettlementLive } from "./src/service.ts"

export { SettlementModule } from "./manifest.ts"
