// Deny by default: a tenant administrator must grant each capability before it takes effect.
export const SettlementCapabilities = {
  paymentTermConfigure: "settlement.payment_term.configure",
  paymentReceive: "settlement.payment.receive",
  paymentMake: "settlement.payment.make",
  reportRead: "settlement.report.read",
  bankStatementImport: "settlement.bank_statement.import",
  bankStatementReconcile: "settlement.bank_statement.reconcile",
} as const
