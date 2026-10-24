import { defineModule } from "../../../framework/modules/module/mod.ts"
import { SettlementCapabilities } from "./src/capabilities.ts"

export const SettlementModule = defineModule({
  name: "settlement",
  layer: "erp",
  dependsOn: ["accounting", "billing"],
  schemas: ["settlement"],
  capabilities: SettlementCapabilities,
  actions: [],
  events: [],
  consumes: [],
  http: ["Settlement"],
  pages: ["/settlement", "/settlement/:id"],
})
