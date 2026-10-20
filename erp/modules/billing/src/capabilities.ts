// Deny by default: a tenant administrator must grant each capability before it takes effect.
export const BillingCapabilities = {
  customerInvoiceCreate: "billing.customer_invoice.create",
  creditNoteCreate: "billing.credit_note.create",
  supplierBillCreate: "billing.supplier_bill.create",
  documentRead: "billing.document.read",
  settlementApply: "billing.settlement.apply",
} as const
