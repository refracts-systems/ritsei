export {
  AllocatedNumber,
  AllocateNumberInput,
  DocumentType,
  fiscalPeriodKey,
  NumberingService,
} from "./src/contract.ts"
export type {
  AllocatedNumber as AllocatedNumberType,
  NumberingService as NumberingServiceShape,
} from "./src/contract.ts"
export { makeNumberingTestLayer, NumberingLive } from "./src/layers.ts"
export { makePostgresNumberingService as makeNumberingService } from "./src/postgres.ts"
