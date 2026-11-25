export {
  InsightsService,
  Kpi,
  Kpis,
  KpisInput,
  KpiStatus,
  Period,
  UndeliveredKpi,
} from "./src/contract.ts"

export type {
  InsightsService as InsightsServiceContract,
  Kpis as KpisType,
} from "./src/contract.ts"

export { InsightsLive, makeInsightsService } from "./src/layers.ts"

export { InsightsModule } from "./manifest.ts"
