import * as Data from "effect/Data"

/**
 * Pure derivations for the Alchemy instance keys of phase 3 class C (SAL-CUST-1, SAL-PRICE-1,
 * SAL-QUOT-3). A key is an instance address, not a table row id. Every key starts with the tenant
 * id, a fixed-length UUID, so a value containing `/` cannot collide with another tenant's key.
 */

/** The email as PostgreSQL stores it (`customers_email_normalization_check`). */
export const canonicalEmail = (email: string) => email.trim().toLowerCase()

/** One customer per tenant and canonical email (`customers_tenant_email_key`). */
export const customerKey = (tenantId: string, email: string) =>
  `${tenantId}/customer/${canonicalEmail(email)}`

/**
 * One price list per tenant and name (`price_lists_tenant_name_key`). The name is already trimmed
 * by the input schema and compares exactly, case included, so it is not normalized again.
 */
export const priceListKey = (tenantId: string, name: string) => `${tenantId}/price-list/${name}`

/** One order per tenant and quotation (the lookup `convertQuotation` runs under the lock). */
export const quotationOrderKey = (tenantId: string, quotationId: string) =>
  `${tenantId}/quotation-order/${quotationId}`

export type QuotationConversion = Data.TaggedEnum<{
  /** An order already came from this quotation: return it, whatever the quotation's state now. */
  Existing: {}
  /** An accepted quotation with no order yet: create the order. */
  Convert: {}
  InvalidState: { readonly status: "draft" | "sent" | "rejected" | "expired" }
}>

export const QuotationConversion = Data.taggedEnum<QuotationConversion>()

/** SAL-QUOT-3: the existing-order check comes before the state check. */
export const decideQuotationConversion = (
  hasOrder: boolean,
  status: "draft" | "sent" | "accepted" | "rejected" | "expired",
): QuotationConversion => {
  if (hasOrder) return QuotationConversion.Existing()

  return status === "accepted"
    ? QuotationConversion.Convert()
    : QuotationConversion.InvalidState({ status })
}
