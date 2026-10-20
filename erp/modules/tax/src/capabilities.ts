// Deny by default: a tenant administrator must grant each capability before it takes effect.
export const TaxCapabilities = {
  taxCodeRead: "tax.tax_code.read",
  taxCodeCreate: "tax.tax_code.create",
  productTaxConfigure: "tax.product_tax.configure",
} as const
