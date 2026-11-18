export { TaxCapabilities } from "./src/capabilities.ts"

export {
  AddTaxCodeRateInput,
  ComputeTaxInput,
  CreateTaxCodeInput,
  DetermineTaxCodesInput,
  ListTaxCodesInput,
  ProductTaxDefault,
  SetProductTaxDefaultInput,
  taxOn,
  TaxCode,
  TaxCodeRate,
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

export {
  TaxCodeAlreadyExists,
  TaxCodeNotFound,
  TaxCodeRateAlreadyExists,
  TaxProductNotFound,
} from "./src/errors.ts"

export { makeTaxService, makeTaxTestLayer, TaxLive } from "./src/layers.ts"

export { TaxModule } from "./manifest.ts"
