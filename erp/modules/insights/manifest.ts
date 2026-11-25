import { defineModule } from "../../../framework/modules/module/mod.ts"

export const InsightsModule = defineModule({
  name: "insights",
  layer: "erp",
  dependsOn: ["accounting", "billing", "party", "sales", "settlement"],
  schemas: [],
  capabilities: {},
  actions: [],
  events: [],
  consumes: [],
  http: ["Insights"],
  pages: [],
})
