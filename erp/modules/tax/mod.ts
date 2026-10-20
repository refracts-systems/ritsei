export { TaxCapabilities } from "./src/capabilities.ts"
export {
  ComputeTaxInput,
  CreateTaxCodeInput,
  DetermineTaxCodesInput,
  ListTaxCodesInput,
  ProductTaxDefault,
  SetProductTaxDefaultInput,
  taxOn,
  TaxCode,
  TaxComputation,
  TaxDirection,
  TaxRate,
  TaxService,
} from "./src/contract.ts"
export type {
  TaxCode as TaxCodeRecord,
  TaxComputation as TaxComputationType,
  TaxService as TaxServiceContract,
} from "./src/contract.ts"
export { TaxCodeAlreadyExists, TaxCodeNotFound, TaxProductNotFound } from "./src/errors.ts"
export { makeTaxService, makeTaxTestLayer, TaxLive } from "./src/layers.ts"
export { TaxModule } from "./manifest.ts"
