// Deny by default: a tenant administrator must grant each capability before it takes effect.
export const ProductCapabilities = {
  productRead: "product.product.read",
  productCreate: "product.product.create",
} as const
