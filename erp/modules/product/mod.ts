export { ProductCapabilities } from "./src/capabilities.ts"
export {
  CreateProductInput,
  GetProductInput,
  ListProductsInput,
  Product,
  ProductService,
  ProductType,
  UnitOfMeasure,
} from "./src/contract.ts"
export type {
  Product as ProductRecord,
  ProductService as ProductServiceContract,
  ProductType as ProductTypeValue,
} from "./src/contract.ts"
export { ProductAlreadyExists, ProductNotFound } from "./src/errors.ts"
export { makeProductService, makeProductTestLayer, ProductLive } from "./src/layers.ts"
export { ProductModule } from "./manifest.ts"
